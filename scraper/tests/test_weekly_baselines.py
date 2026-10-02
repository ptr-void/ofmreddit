import copy
import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from scraper.weekly_baselines import HEADERS, METRICS, historical_baselines, missing_metrics, stored_keys, backfill

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)
END = NOW - timedelta(days=30)

def posts(count=10, end=END):
    return [{"id": f"p{i}", "created_utc": (end - timedelta(hours=i)).timestamp(), "score": 100 - i * 3}
            for i in range(count)]

class WeeklyBaselineTests(unittest.TestCase):
    def test_complete_older_window_has_exact_rank_group_averages_and_provenance(self):
        source = posts()
        before = copy.deepcopy(source)
        rows = historical_baselines('Example', source, list(METRICS), now=NOW, listing_complete=True)
        self.assertEqual([row[5] for row in rows], [100, 92, 79])
        self.assertEqual(source, before)
        self.assertEqual(len(stored_keys([HEADERS, *rows], NOW)), 3)
        for row in rows:
            self.assertEqual(row[6], 10)
            self.assertEqual(json.loads(row[7]), [f'p{i}' for i in range(10)])
            self.assertEqual(datetime.fromisoformat(row[3].replace('Z', '+00:00')) -
                             datetime.fromisoformat(row[2].replace('Z', '+00:00')), timedelta(days=7))

    def test_sparse_latest_period_can_use_older_dated_period_for_a_missing_rank_group(self):
        source = [{'id':'latest','created_utc':END.timestamp(),'score':900}, *posts(end=END-timedelta(days=20))]
        rows = historical_baselines('Example', source, list(METRICS), now=NOW, listing_complete=True)
        self.assertEqual(rows[0][5], 900)
        self.assertNotEqual(rows[0][3], rows[2][3])

    def test_current_week_is_not_relabelled_as_historical(self):
        self.assertEqual(historical_baselines('Example', posts(end=NOW), list(METRICS), now=NOW, listing_complete=True), [])

    def test_capped_listing_without_a_complete_window_is_not_published(self):
        self.assertEqual(historical_baselines('Example', posts(), list(METRICS), now=NOW, listing_complete=False), [])
        source = [*posts(), {'id':'older-boundary','created_utc':(END-timedelta(days=8)).timestamp(),'score':500}]
        self.assertEqual(len(historical_baselines('Example', source, list(METRICS), now=NOW, listing_complete=False)), 3)

    def test_deleted_duplicates_and_unusable_scores_do_not_create_fake_groups(self):
        source = [*posts(1), *posts(1)]
        rows = historical_baselines('Example', source, list(METRICS), now=NOW, listing_complete=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][6], 1)
        self.assertEqual(historical_baselines('Example', [*source, {'id':'bad','created_utc':END.timestamp(),'score':None}],
                         list(METRICS), now=NOW, listing_complete=True), [])
        self.assertEqual(historical_baselines('Example', [{'id':'zero','created_utc':END.timestamp(),'score':0}],
                         list(METRICS), now=NOW, listing_complete=True), [])

    def test_only_missing_active_source_cells_are_eligible(self):
        matrix = [['Subreddit', *METRICS, 'Sync Status'], ['Example','100','0','','success'],
                  ['Archived','0','0','0','archived'], ['', '0','0','0','success']]
        self.assertEqual(missing_metrics(matrix), {'example': {'Hot 2-5 Avg (Weekly)', 'Hot 6-10 Avg (Weekly)'}})
        self.assertEqual(missing_metrics(matrix, ['other']), {})

    def test_stored_baseline_validation_rejects_wrong_headers_future_and_bad_ids(self):
        row = historical_baselines('Example', posts(), list(METRICS), now=NOW, listing_complete=True)[0]
        with self.assertRaises(RuntimeError): stored_keys([['wrong']], NOW)
        for index, value in [(4,'2099-01-01T00:00:00Z'), (5,'0'), (7,'[["unhashable"]]'), (7,'["duplicate","duplicate"]')]:
            invalid = list(row); invalid[index] = value
            self.assertEqual(stored_keys([HEADERS, invalid], NOW), set())

    def test_backfill_dry_run_is_read_only_and_apply_only_writes_separate_sheet_once(self):
        class WorksheetNotFound(Exception): pass
        class Sheet:
            values = []
            def get_all_values(self): return [[str(value) for value in row] for row in self.values]
            def update(self, values, **kwargs): self.values = values
            def append_rows(self, rows, **kwargs): self.values.extend(rows)
        class Workbook:
            id = 'fixture'
            sheet = None
            def worksheet(self, name):
                if self.sheet is None: raise WorksheetNotFound()
                return self.sheet
            def add_worksheet(self, **kwargs): self.sheet = Sheet(); return self.sheet
        matrix = [['Subreddit', *METRICS, 'Sync Status'], ['Example','0','0','0','success']]
        workbook = Workbook()
        store = SimpleNamespace(workbook=workbook, _load_sheet1=lambda: (None, copy.deepcopy(matrix)))
        sub = SimpleNamespace(display_name='Example', _fetch=lambda:None,
                              new=lambda **kwargs:[SimpleNamespace(**post) for post in posts()])
        analyzer = SimpleNamespace(reddit=SimpleNamespace(subreddit=lambda name:sub), _call=lambda fn,label:fn())
        before = copy.deepcopy(matrix)
        with patch('scraper.weekly_baselines.atomic_write_json'), patch('scraper.weekly_baselines.utc_now',return_value=NOW):
            dry = backfill(store, analyzer)
            self.assertEqual(len(dry['planned']),3);self.assertIsNone(workbook.sheet)
            applied = backfill(store, analyzer, apply=True)
            self.assertTrue(applied['verified']);self.assertEqual(len(workbook.sheet.values),4)
            backfill(store, analyzer, apply=True)
            self.assertEqual(len(workbook.sheet.values),4)
        self.assertEqual(matrix,before)
