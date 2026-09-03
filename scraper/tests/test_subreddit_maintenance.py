import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
import copy
import re

from scraper.subreddit_maintenance import (
    Maintenance, Probe, candidate_eligible, next_observation, probe_subreddit,
)
from scraper.subreddit_sync import GoogleSheetStore, ScrapeResult, SHEET1_REQUIRED_HEADERS
from scraper.tests.test_subreddit_sync import FakeWorksheet

NOW = datetime(2026, 9, 3, tzinfo=timezone.utc)


class MutableSheet(FakeWorksheet):
    id = 0

    def batch_update(self, data, **kwargs):
        super().batch_update(data, **kwargs)
        for item in data:
            column, number = re.fullmatch(r'([A-Z]+)(\d+)', item['range']).groups()
            index = 0
            for letter in column:
                index = index * 26 + ord(letter) - 64
            row = self.values[int(number) - 1]
            row.extend([''] * max(0, index - len(row)))
            row[index - 1] = item['values'][0][0]

    def append_rows(self, rows, **kwargs):
        self.values.extend(copy.deepcopy(rows))


def mutable_worker(matrix):
    store = object.__new__(GoogleSheetStore)
    store.sheet1 = MutableSheet(values=matrix)
    store._sheet1_values = None
    store.workbook = Mock()
    store.workbook.fetch_sheet_metadata.return_value = {
        'sheets': [{'properties': {'sheetId': 0}, 'tables': [{'tableId': 'fixture', 'range': {'sheetId': 0, 'endRowIndex': 2}}]}],
    }
    return Maintenance(store, None, None, apply=True)


class HttpError(Exception):
    def __init__(self, status, reason=''):
        self.response = SimpleNamespace(status_code=status, json=lambda: {'reason': reason})


def analyzer_error(status, reason='', matches=()):
    sub = SimpleNamespace(_fetch=Mock(side_effect=HttpError(status, reason)))
    return SimpleNamespace(
        _call=lambda fn, label: fn(),
        reddit=SimpleNamespace(subreddit=lambda name: sub,
            subreddits=SimpleNamespace(search_by_name=Mock(return_value=matches))),
    )


class MaintenanceTests(unittest.TestCase):
    def test_three_checks_separated_by_24_hours_and_spanning_48_hours(self):
        record = {}
        for hours, count, ready in [(0, 1, False), (1, 1, False), (24, 2, False), (47, 2, False), (48, 3, True)]:
            record, eligible = next_observation(record, Probe('dead', 'banned'), NOW + timedelta(hours=hours))
            self.assertEqual(record['dead_checks'], count)
            self.assertEqual(eligible, ready)

    def test_private_ratelimit_and_server_errors_are_inconclusive(self):
        for status in [403, 429, 500, 502, 503]:
            self.assertEqual(probe_subreddit(analyzer_error(status), 'example').outcome, 'uncertain')
        self.assertEqual(probe_subreddit(analyzer_error(404, 'private'), 'example').outcome, 'uncertain')

    def test_banned_is_evidence_even_if_name_is_indexed(self):
        result = probe_subreddit(analyzer_error(404, 'banned', ['example']), 'example')
        self.assertEqual(result.outcome, 'dead')

    def test_generic_404_requires_independent_absent_name_lookup(self):
        self.assertEqual(probe_subreddit(analyzer_error(404, matches=['Example']), 'example').outcome, 'uncertain')
        self.assertEqual(probe_subreddit(analyzer_error(404), 'example').outcome, 'dead')
        analyzer = analyzer_error(404)
        analyzer.reddit.subreddits.search_by_name.side_effect = HttpError(429)
        self.assertEqual(probe_subreddit(analyzer, 'example').outcome, 'uncertain')

    def test_matching_live_zero_member_community_is_not_dead(self):
        sub = SimpleNamespace(_fetch=lambda: None, display_name='Example', subscribers=0)
        analyzer = SimpleNamespace(_call=lambda fn, label: fn(), reddit=SimpleNamespace(subreddit=lambda name: sub))
        self.assertEqual(probe_subreddit(analyzer, 'example').outcome, 'alive')

    def test_uncertainty_or_recovery_reset_the_streak(self):
        prior = {'state': 'watch', 'dead_checks': 2, 'first_dead_at': NOW - timedelta(days=3), 'last_dead_at': NOW - timedelta(days=1)}
        for outcome in ['alive', 'uncertain']:
            record, eligible = next_observation(prior, Probe(outcome, 'checked'), NOW)
            self.assertEqual(record['dead_checks'], 0)
            self.assertEqual(record['state'], 'active')
            self.assertFalse(eligible)

    def test_restored_community_has_grace_period(self):
        record, eligible = next_observation({'hold_until': NOW + timedelta(hours=72)}, Probe('dead', 'banned'), NOW)
        self.assertFalse(eligible)
        self.assertEqual(record.get('dead_checks', 0), 0)

    def test_archive_kept_until_confirmed_recovery_or_manual_restore(self):
        record, eligible = next_observation({'state': 'archived', 'dead_checks': 3}, Probe('uncertain', '429'), NOW)
        self.assertEqual(record['state'], 'archived')
        self.assertFalse(eligible)

    def test_discovery_thresholds_and_no_missing_member_invention(self):
        valid = {'name': 'example', 'over18': True, 'subreddit_type': 'public', 'subscribers': 100, 'latest_post_utc': NOW.timestamp() - 100}
        self.assertTrue(candidate_eligible(valid, NOW))
        for changes in [{'subscribers': None}, {'subscribers': 99}, {'over18': False}, {'subreddit_type': 'private'},
                        {'latest_post_utc': NOW.timestamp() - 31 * 86400}, {'latest_post_utc': None}, {'name': '../bad'}]:
            self.assertFalse(candidate_eligible({**valid, **changes}, NOW))

    def test_normal_scraper_never_selects_or_overwrites_archives(self):
        headers = list(SHEET1_REQUIRED_HEADERS)
        archived = ['example'] + [''] * (len(headers) - 1)
        archived[headers.index('Sync Status')] = 'archived'
        store = object.__new__(GoogleSheetStore)
        store.sheet1 = FakeWorksheet(values=[headers, archived, ['live']])
        store._sheet1_values = None
        self.assertEqual([row.key for row in store.source_rows()], ['live'])
        store.write_results([ScrapeResult(subreddit='example', source_row=2, scraped_at_utc='2026-09-03T00:00:00Z', subscribers=100)])
        self.assertEqual(store.sheet1.batch_updates, [])

    def test_archive_saves_durable_snapshot_before_hiding(self):
        worker = Maintenance(None, None, None, apply=True)
        worker.table = lambda: (['Subreddit', 'Niche'], {}, {'example': [(2, ['Example', 'manual'])]})
        calls = []
        worker.sql = lambda sql, params=(): calls.append(('db', sql, params))
        worker.event = lambda *args: calls.append(('event', args))
        worker.set_visibility = lambda *args, **kwargs: calls.append(('sheet', args, kwargs))
        worker.archive('example', {'last_evidence': 'banned', 'dead_checks': 3})
        self.assertEqual(calls[0][0], 'db')
        self.assertIn('manual', calls[0][2][0])
        self.assertEqual(calls[-1][0], 'sheet')

    def test_append_is_idempotent_by_normalized_name(self):
        worker = Maintenance(None, None, None, apply=True)
        worker.table = lambda: ([], {}, {'example': [(2, ['example'])]})
        worker.append_row('example', {'Niche': 'retained'})  # No Sheets access.

    def test_sheet_archive_and_restore_preserve_data_and_only_change_checkpoints(self):
        headers = list(SHEET1_REQUIRED_HEADERS)
        row = ['Example', 'https://reddit.com/r/Example', 'Yes', '1,234', 'manual'] + [''] * (len(headers) - 5)
        row[headers.index('Sync Status')] = 'error'
        row[headers.index('Scraped At UTC')] = '2026-09-01T00:00:00Z'
        worker = mutable_worker([headers, row])
        worker.set_visibility('example', archived=True)
        self.assertEqual(worker.store.sheet1.values[1][:14], row[:14])
        self.assertEqual(worker.store.sheet1.values[1][headers.index('Sync Status')], 'archived')
        request = worker.store.workbook.batch_update.call_args.args[0]['requests'][0]
        self.assertTrue(request['updateDimensionProperties']['properties']['hiddenByUser'])
        worker.set_visibility('example', archived=False)
        self.assertEqual(worker.store.sheet1.values[1][:14], row[:14])
        self.assertEqual(worker.store.sheet1.values[1][-3:], ['', '', ''])
        self.assertFalse(worker.store.workbook.batch_update.call_args.args[0]['requests'][0]['updateDimensionProperties']['properties']['hiddenByUser'])

    def test_append_extends_one_table_and_retry_does_not_duplicate(self):
        worker = mutable_worker([list(SHEET1_REQUIRED_HEADERS), ['existing']])
        worker.append_row('example', {'Total Members': 1500, 'Niche': 'manual'})
        worker.append_row('example', {'Total Members': 9999, 'Niche': 'wrong'})
        self.assertEqual(len(worker.store.sheet1.values), 3)
        self.assertEqual(worker.store.sheet1.values[2][3:5], [1500, 'manual'])
        request = worker.store.workbook.batch_update.call_args.args[0]['requests'][0]
        self.assertEqual(request['updateTable']['table']['range']['endRowIndex'], 3)

    def test_rejected_or_already_approved_master_is_never_republished_by_old_queue(self):
        worker = Maintenance(None, None, None, apply=True)
        statements = []
        def sql(statement, params=()):
            statements.append(statement)
            if statement.startswith('SELECT * FROM subreddit_maintenance'):
                return [{'subreddit_name': 'example', 'requested_action': 'add', 'state': 'active'}]
            return []
        worker.sql = sql
        worker.process_queue()
        self.assertFalse(any("SET status='approved'" in sql for sql in statements))
        self.assertTrue(any('requested_action=NULL' in sql for sql in statements))

    def test_dry_queue_never_writes_or_approves(self):
        worker = Maintenance(None, None, None, apply=False)
        worker.sql = Mock(return_value=[{'subreddit_name': 'example', 'requested_action': 'add'}])
        worker.process_queue()
        self.assertEqual(worker.sql.call_count, 1)
        self.assertEqual(worker.report['actions'][0]['queued'], 'add')

    def test_structural_audit_accepts_negative_karma_and_sorted_subreddit_urls(self):
        from scraper.audit_table import audit_table
        report = audit_table([['Subreddit', 'Link', 'Min Comment Karma', 'Total Members'],
                              ['example', 'https://www.reddit.com/r/Example/hot/', '-9', '12,345']])
        self.assertEqual(report['findings'], [])

    def test_structural_audit_identifies_legacy_errors_without_changing_them(self):
        from scraper.audit_table import audit_table
        matrix = [['Subreddit', 'Link', 'Total Members'], ['example', 'https://reddit.com/r/wrong/', 'Error']]
        report = audit_table(matrix)
        self.assertEqual({f['issue'] for f in report['findings']}, {'link_name_mismatch', 'malformed_numeric'})
        self.assertEqual(matrix[1][2], 'Error')


if __name__ == '__main__':
    unittest.main()
