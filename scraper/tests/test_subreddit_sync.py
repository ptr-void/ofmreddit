import json
import time
import unittest
from datetime import timedelta
from types import SimpleNamespace

from scraper.subreddit_sync import (
    GoogleSheetStore,
    ScrapeResult,
    SheetState,
    SourceRow,
    compact_top_posts,
    detect_cta_titles,
    normalize_subreddit,
    select_sources,
    utc_now,
)


class FakeWorksheet:
    def __init__(self, col_count=26):
        self.updates = []
        self.batch_updates = []
        self.col_count = col_count
        self.added_cols = []

    def update(self, **kwargs):
        self.updates.append(kwargs)

    def batch_update(self, data, **kwargs):
        self.batch_updates.append((data, kwargs))

    def add_cols(self, count):
        self.added_cols.append(count)
        self.col_count += count


class SubredditSyncTests(unittest.TestCase):
    def test_normalize_subreddit(self):
        self.assertEqual(normalize_subreddit("https://www.reddit.com/r/Test_Sub/"), "test_sub")
        self.assertEqual(normalize_subreddit("r/Test_Sub"), "test_sub")

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

    def test_ad_hoc_source_uses_non_sheet_row(self):
        source = SourceRow(0, "ad_hoc")
        self.assertEqual(source.sheet_row, 0)
        self.assertEqual(source.key, "ad_hoc")

    def test_sheet_writer_matches_name_and_never_uses_ad_hoc_sheet1_row(self):
        store = object.__new__(GoogleSheetStore)
        store.sheet1 = FakeWorksheet()
        store.sheet3 = FakeWorksheet(col_count=7)
        store._sheet3_values = [["Subreddit"], ["other"], ["target"], ["target"]]
        store._sheet3_headers = ["Subreddit"]
        result = ScrapeResult(
            subreddit="Target",
            source_row=0,
            scraped_at_utc="2026-08-30T00:00:00Z",
            subscribers=123,
            has_bot_bouncer=True,
        )

        store.write_results([result])

        self.assertEqual(store.sheet1.batch_updates, [])
        self.assertEqual(store.sheet3.col_count, 23)
        self.assertEqual(store.sheet3.added_cols, [16])
        written_ranges = {
            item["range"]
            for batch, _ in store.sheet3.batch_updates
            for item in batch
        }
        self.assertIn("A3", written_ranges)
        self.assertIn("A4", written_ranges)
        self.assertNotIn("A2", written_ranges)


if __name__ == "__main__":
    unittest.main()
