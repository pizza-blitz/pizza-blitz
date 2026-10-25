"""Two-proportion significance math for campaign holdout experiments."""

import unittest

from app.services.holdout_service import two_proportion_test


class HoldoutStatisticsTest(unittest.TestCase):
    def test_clear_winner_is_significant(self):
        result = two_proportion_test(100, 100, 80, 100)
        self.assertTrue(result["available"])
        self.assertTrue(result["significant_95"])
        self.assertLess(result["p_value"], 0.001)
        self.assertGreater(result["absolute_lift_pp"], 15)
        self.assertIsNotNone(result["required_per_group_80_power"])

    def test_equal_groups_are_not_significant(self):
        result = two_proportion_test(25, 100, 25, 100)
        self.assertTrue(result["available"])
        self.assertFalse(result["significant_95"])
        self.assertAlmostEqual(result["p_value"], 1.0, places=3)
        self.assertAlmostEqual(result["absolute_lift_pp"], 0.0, places=3)

    def test_empty_groups_are_unavailable(self):
        result = two_proportion_test(0, 0, 0, 0)
        self.assertFalse(result["available"])
        self.assertIsNone(result["p_value"])
        self.assertFalse(result["significant_95"])


if __name__ == "__main__":
    unittest.main()
