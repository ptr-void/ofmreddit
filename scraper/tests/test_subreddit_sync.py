import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from scraper.subreddit_sync import (
    CycleState,
    GoogleSheetStore,
    ScrapeResult,
    SheetState,
    SourceRow,
    activate_cycle_if_due,
    bootstrap_cycle_state,
    build_parser,
    compact_top_posts,
    detect_cta_titles,
    detect_verification_requirement,
    normalize_subreddit,
    parse_utc,
    select_sources,
    select_cycle_sources,
    utc_now,
)


class FakeWorksheet:
    def __init__(self, col_count=26, values=None):
        self.updates = []
        self.batch_updates = []
        self.col_count = col_count
        self.added_cols = []
        self.deleted_cols = []
        self.values = [list(row) for row in (values or [])]

    def update(self, **kwargs):
        self.updates.append(kwargs)

    def batch_update(self, data, **kwargs):
        self.batch_updates.append((data, kwargs))

    def add_cols(self, count):
        self.added_cols.append(count)
        self.col_count += count

    def get_all_values(self):
        return self.values

    def delete_columns(self, index):
        self.deleted_cols.append(index)
        self.col_count -= 1


class FakeWorkbook:
    def __init__(self, metadata=None):
        self.metadata = list(metadata or [])
        self.requests = []

    def fetch_sheet_metadata(self, params=None):
        return {"developerMetadata": self.metadata}

    def batch_update(self, body):
        self.requests.append(body)


class SubredditSyncTests(unittest.TestCase):
    def test_row_errors_are_reported_without_failing_batch_by_default(self):
        self.assertFalse(build_parser().parse_args([]).fail_on_row_error)
        self.assertTrue(build_parser().parse_args(["--fail-on-row-error"]).fail_on_row_error)

    def test_database_mirror_errors_are_recoverable_by_default(self):
        self.assertFalse(build_parser().parse_args([]).fail_on_db_error)
        self.assertTrue(build_parser().parse_args(["--fail-on-db-error"]).fail_on_db_error)

    def test_normalize_subreddit(self):
        self.assertEqual(normalize_subreddit("https://www.reddit.com/r/Test_Sub/"), "test_sub")
        self.assertEqual(normalize_subreddit("r/Test_Sub"), "test_sub")

    def test_utc_timestamp_round_trip(self):
        parsed = parse_utc("2026-08-31T06:10:29.459344Z")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.tzinfo, timezone.utc)

    def test_cta_detection_uses_requested_forms_and_maturity(self):
        now = time.time()
        posts = [
            SimpleNamespace(title="What do you think?", created_utc=now - 7200),
            SimpleNamespace(title="Would this work", created_utc=now - 7200),
            SimpleNamespace(title="plain caption", created_utc=now - 7200),
            SimpleNamespace(title="too new?", created_utc=now - 30),
            SimpleNamespace(title="removed?", created_utc=now - 7200, removed_by_category="moderator"),
        ]
        allowed, matches, sample = detect_cta_titles(posts, now_epoch=now)
        self.assertTrue(allowed)
        self.assertEqual(matches, 2)
        self.assertEqual(sample, 3)

    def test_cta_unknown_without_mature_posts(self):
        allowed, matches, sample = detect_cta_titles([])
        self.assertIsNone(allowed)
        self.assertEqual((matches, sample), (0, 0))

    def test_verification_requirement_detection_uses_rules_and_ignores_explicit_negative(self):
        self.assertTrue(detect_verification_requirement([
            "Rule 4: Creators must complete verification before posting.",
        ]))
        self.assertFalse(detect_verification_requirement([
            "No verification is required to post here.",
        ]))
        self.assertFalse(detect_verification_requirement(["Be respectful and follow Reddit rules."]))

    def test_compact_weekly_top_ten(self):
        posts = [
            SimpleNamespace(
                id=str(index), title=f"Post {index}", score=index, num_comments=index + 1,
                permalink=f"/r/test/comments/{index}", created_utc=1000 + index,
            )
            for index in range(12)
        ]
        compact = compact_top_posts(posts)
        self.assertEqual(len(compact), 10)
        self.assertEqual(compact[0]["rank"], 1)
        self.assertTrue(compact[0]["url"].startswith("https://www.reddit.com/"))
        json.dumps(compact)

    def test_selection_skips_fresh_success_and_rotates_checkpoint(self):
        sources = [SourceRow(2, "one"), SourceRow(3, "two"), SourceRow(4, "three")]
        states = {"two": SheetState(status="success", scraped_at=utc_now())}
        selected = select_sources(
            sources,
            states,
            stale_after=timedelta(days=7),
            maximum=2,
            force=False,
            start_after_row=2,
        )
        self.assertEqual([row.subreddit for row in selected], ["three", "one"])

    def test_selection_skips_recent_errors_and_fills_batch_with_later_rows(self):
        sources = [
            SourceRow(2, "broken-one"),
            SourceRow(3, "broken-two"),
            SourceRow(4, "next-one"),
            SourceRow(5, "next-two"),
        ]
        states = {
            "broken-one": SheetState(status="error", scraped_at=utc_now()),
            "broken-two": SheetState(status="error", scraped_at=utc_now()),
        }

        selected = select_sources(
            sources,
            states,
            stale_after=timedelta(days=7),
            retry_errors_after=timedelta(hours=24),
            maximum=2,
            force=False,
            start_after_row=1,
        )

        self.assertEqual([row.subreddit for row in selected], ["next-one", "next-two"])

    def test_selection_retries_error_after_cooldown(self):
        sources = [SourceRow(2, "broken"), SourceRow(3, "next")]
        states = {
            "broken": SheetState(status="error", scraped_at=utc_now() - timedelta(hours=25)),
        }

        selected = select_sources(
            sources,
            states,
            stale_after=timedelta(days=7),
            retry_errors_after=timedelta(hours=24),
            maximum=2,
            force=False,
            start_after_row=1,
        )

        self.assertEqual([row.subreddit for row in selected], ["broken", "next"])

    def test_complete_pass_attempts_each_row_once_in_ascending_order(self):
        started = datetime(2026, 8, 31, 0, 0, tzinfo=timezone.utc)
        sources = [SourceRow(2, "one"), SourceRow(3, "two"), SourceRow(4, "three")]
        states = {
            "one": SheetState(status="success", scraped_at=started + timedelta(minutes=1)),
            "two": SheetState(status="error", scraped_at=started + timedelta(minutes=2)),
            "three": SheetState(status="success", scraped_at=started - timedelta(minutes=1)),
        }

        selected = select_cycle_sources(
            sources,
            states,
            cycle_started_at=started,
            maximum=20,
        )

        self.assertEqual([row.subreddit for row in selected], ["three"])

    def test_resting_cycle_restarts_only_after_24_hour_deadline(self):
        completed = datetime(2026, 8, 31, 1, 0, tzinfo=timezone.utc)
        resting = CycleState(
            phase="resting",
            cycle_started_at=completed - timedelta(hours=2),
            cycle_completed_at=completed,
            next_cycle_at=completed + timedelta(hours=24),
        )

        before = activate_cycle_if_due(resting, now=completed + timedelta(hours=23, minutes=59))
        after = activate_cycle_if_due(resting, now=completed + timedelta(hours=24))

        self.assertEqual(before.phase, "resting")
        self.assertEqual(after.phase, "running")
        self.assertEqual(after.cycle_started_at, completed + timedelta(hours=24))

        restored = CycleState.from_payload(resting.to_payload())
        self.assertIsNotNone(restored)
        self.assertEqual(restored.next_cycle_at, resting.next_cycle_at)

    def test_bootstrap_adopts_recent_in_progress_rows(self):
        now = datetime(2026, 8, 31, 6, 0, tzinfo=timezone.utc)
        sources = [SourceRow(2, "one"), SourceRow(3, "two")]
        states = {
            "one": SheetState(status="success", scraped_at=now - timedelta(hours=2)),
            "two": SheetState(status="success", scraped_at=now - timedelta(minutes=5)),
        }

        cycle = bootstrap_cycle_state(sources, states, now=now)

        self.assertEqual(cycle.phase, "running")
        self.assertEqual(cycle.cycle_started_at, now - timedelta(hours=2))

    def test_cycle_state_is_persisted_as_invisible_spreadsheet_metadata(self):
        store = object.__new__(GoogleSheetStore)
        store.workbook = FakeWorkbook()
        state = CycleState(
            phase="running",
            cycle_started_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
        )

        store.save_cycle_state(state)

        request = store.workbook.requests[0]["requests"][0]["createDeveloperMetadata"]
        self.assertEqual(request["developerMetadata"]["location"], {"spreadsheet": True})
        self.assertEqual(request["developerMetadata"]["visibility"], "DOCUMENT")

        store.workbook = FakeWorkbook([{"metadataId": 42, "metadataKey": "ofmreddit_scraper_cycle_v1"}])
        store.save_cycle_state(state)
        update = store.workbook.requests[0]["requests"][0]["updateDeveloperMetadata"]
        self.assertEqual(update["dataFilters"][0]["developerMetadataLookup"]["metadataId"], 42)

    def test_ad_hoc_source_uses_non_sheet_row(self):
        source = SourceRow(0, "ad_hoc")
        self.assertEqual(source.sheet_row, 0)
        self.assertEqual(source.key, "ad_hoc")

    def test_sheet_writer_matches_name_and_never_uses_ad_hoc_sheet1_row(self):
        store = object.__new__(GoogleSheetStore)
        store.sheet1 = FakeWorksheet(
            col_count=5,
            values=[["Subreddit", "Link", "Verification", "Total Members", "Niche"], ["target"]],
        )
        store._sheet1_values = store.sheet1.values
        store._sheet1_headers = list(store.sheet1.values[0])
        result = ScrapeResult(
            subreddit="Target",
            source_row=0,
            scraped_at_utc="2026-08-30T00:00:00Z",
            subscribers=123,
            has_bot_bouncer=True,
        )

        store.write_results([result])

        self.assertEqual(store.sheet1.batch_updates, [])
        self.assertEqual(store.sheet1.col_count, 17)
        self.assertEqual(store.sheet1.added_cols, [12])

    def test_sheet1_writer_updates_members_and_scraped_verification_by_header(self):
        store = object.__new__(GoogleSheetStore)
        store.sheet1 = FakeWorksheet(
            col_count=5,
            values=[
                ["Subreddit", "Link", "Verification", "Total Members", "Niche"],
                ["target", "https://reddit.com/r/target", "", "", "general"],
            ],
        )
        store._sheet1_values = store.sheet1.values
        store._sheet1_headers = list(store.sheet1.values[0])
        result = ScrapeResult(
            subreddit="Target",
            source_row=2,
            scraped_at_utc="2026-09-01T00:00:00Z",
            subscribers=456,
            has_bot_bouncer=True,
            requires_verification=True,
            min_post_karma=12,
        )

        store.write_results([result])

        sheet1_ranges = {
            item["range"]
            for batch, _ in store.sheet1.batch_updates
            for item in batch
        }
        self.assertIn("C2", sheet1_ranges)
        self.assertIn("D2", sheet1_ranges)
        self.assertIn("F2", sheet1_ranges)
        self.assertIn("Q2", sheet1_ranges)

    def test_states_and_headers_use_only_the_consolidated_sheet1_table(self):
        store = object.__new__(GoogleSheetStore)
        store.sheet1 = FakeWorksheet(
            col_count=7,
            values=[
                ["Subreddit", "Link", "Verification", "Total Members", "Niche", "Scraped At UTC", "Sync Status"],
                ["target", "", "yes", "123", "general", "2026-09-02T00:00:00Z", "success"],
            ],
        )
        store._sheet1_values = store.sheet1.values
        store._sheet1_headers = list(store.sheet1.values[0])

        states = store.states()
        headers = store.ensure_headers()

        self.assertEqual(states["target"].status, "success")
        self.assertEqual(states["target"].scraped_at, datetime(2026, 9, 2, tzinfo=timezone.utc))
        self.assertIn("Min Post Karma", headers)
        self.assertIn("Sync Error", headers)
        self.assertEqual(store.sheet1.col_count, 17)


if __name__ == "__main__":
    unittest.main()
