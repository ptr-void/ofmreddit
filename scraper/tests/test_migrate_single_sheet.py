import unittest

from scraper.migrate_single_sheet import merge_labels


class SingleSheetMigrationTests(unittest.TestCase):
    def test_niche_merge_is_ordered_case_insensitive_and_deduplicated(self):
        self.assertEqual(
            merge_labels(["General, Teen"], ["teen", "Cosplay", "general"]),
            "general, teen, cosplay",
        )


if __name__ == "__main__":
    unittest.main()
