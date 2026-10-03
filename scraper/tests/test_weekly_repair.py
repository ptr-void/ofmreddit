import unittest
from datetime import datetime, timezone
from scraper.repair_weekly_metrics import HEADERS, repair_plan
from scraper.subreddit_sync import WEEKLY_HISTORY_HEADERS

class WeeklyRepairTests(unittest.TestCase):
    def test_restores_only_missing_fields_from_matching_valid_history(self):
        matrix = [["Subreddit", *HEADERS, "Sync Status", "Niche"],
                  ["Example", "0", "12", "", "success", "unchanged"],
                  ["NoHistory", "0", "", "0", "success"],
                  ["Archived", "0", "0", "0", "archived"]]
        history = [WEEKLY_HISTORY_HEADERS,
                   ["example", "2026-09-01T00:00:00Z", "100", "20", "10"],
                   ["example", "2026-09-02T00:00:00Z", "200"],
                   ["example", "2026-09-03T00:00:00Z", "0", "0", "0"],
                   ["archived", "2026-09-01T00:00:00Z", "200", "40", "20"],
                   ["example", "2099-01-01T00:00:00Z", "999999", "999999", "999999"]]
        import copy
        before = copy.deepcopy(matrix)
        plan = repair_plan(matrix, history, datetime(2026, 10, 1, tzinfo=timezone.utc))
        self.assertEqual([(p["range"], p["after"]) for p in plan], [("B2", 200), ("D2", 10)])
        self.assertEqual(matrix, before)

    def test_history_header_mismatch_aborts(self):
        with self.assertRaises(ValueError):
            repair_plan([["Subreddit", *HEADERS]], [["Wrong"]])
