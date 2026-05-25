import unittest

from app.services.sheets_service import SheetsService


class SheetsServicePublicGvizSelectionTest(unittest.TestCase):
    def test_selects_highest_dated_month_candidate_and_ignores_summary_rows(self):
        service = SheetsService()
        service.discover_public_tabs = lambda _sheet_url: [  # type: ignore[method-assign]
            {"order": 0, "gid": "low", "title": ""},
            {"order": 1, "gid": "high", "title": ""},
        ]

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

    def test_uses_tab_title_month_when_sheet_dates_are_copied_from_another_year(self):
        service = SheetsService()
        service.discover_public_tabs = lambda _sheet_url: [  # type: ignore[method-assign]
            {"order": 0, "gid": "sept-2023", "title": "Sept 2023"},
        ]
        service.fetch_public_gviz_rows = lambda _sheet_url, _gid: [  # type: ignore[method-assign]
            ["Date", "Cash", "Expense", "Sale"],
            ["Date(2025,8,24)", 500, 100, 700],
            ["Date(2025,8,25)", 600, 150, 800],
        ]

        selected = service._select_public_gviz_month_candidates("https://example.test/sheet", "all")

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["month"], "2023-09")
        self.assertEqual(selected[0]["rows"][1][0], "2023-09-24")
        self.assertEqual(selected[0]["rows"][2][0], "2023-09-25")
        self.assertEqual(float(selected[0]["total_sale"]), 1500.0)


if __name__ == "__main__":
    unittest.main()
