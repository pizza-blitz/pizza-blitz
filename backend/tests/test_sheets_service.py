import unittest

from app.services.sheets_service import SheetsService


class SheetsServicePublicGvizSelectionTest(unittest.TestCase):
    def test_selects_highest_dated_month_candidate_and_ignores_summary_rows(self):
        service = SheetsService()
        service.discover_public_gids = lambda _sheet_url: ["low", "high"]  # type: ignore[method-assign]

        rows_by_gid = {
            "low": [
                ["Date", "Cash", "Expense", "Sale"],
                ["Date(2024,0,1)", 100, 30, 100],
                ["Date(2024,0,2)", 100, 30, 100],
                ["", 200, 60, 200],
            ],
            "high": [
                ["Date", "Cash", "Expense", "Sale"],
                ["Date(2024,0,1)", 200, 40, 300],
                ["Date(2024,0,2)", 150, 40, 250],
                ["", 350, 80, 550],
            ],
        }
        service.fetch_public_gviz_rows = lambda _sheet_url, gid: rows_by_gid[gid]  # type: ignore[method-assign]

        selected = service._select_public_gviz_month_candidates("https://example.test/sheet", "all")

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["gid"], "high")
        self.assertEqual(selected[0]["month"], "2024-01")
        self.assertEqual(selected[0]["dated_rows"], 2)
        self.assertEqual(float(selected[0]["total_sale"]), 550.0)


if __name__ == "__main__":
    unittest.main()
