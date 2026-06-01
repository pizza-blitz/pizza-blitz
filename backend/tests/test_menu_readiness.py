import unittest
from collections import Counter

from app.api.api_v1.endpoints.menu import _top_option_rows


class MenuReadinessRankingTest(unittest.TestCase):
    def test_top_options_preserve_ties_at_display_boundary(self):
        counter = Counter(
            {
                "Size: Medium": 3,
                "Crust: Classic": 3,
                "Sauce: Tomato": 2,
                "Size: Large": 1,
                "Crust: Cheese Burst": 1,
                "Toppings: Extra Cheese": 1,
                "Toppings: Paneer": 1,
                "Add-ons: Dessert": 1,
                "Combo: Garlic Bread + Drink": 1,
                "Sauce: Schezwan": 1,
            }
        )

        rows = _top_option_rows(counter)

        self.assertEqual(len(rows), 10)
        self.assertIn(
            {"option": "Combo: Garlic Bread + Drink", "quantity": 1},
            rows,
        )


if __name__ == "__main__":
    unittest.main()
