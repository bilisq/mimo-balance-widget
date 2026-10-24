"""本地记账：花费累计、充值、跨天、7 日窗口。"""

from __future__ import annotations

import unittest
from datetime import datetime

from whale import ledger
from whale.api import CST

from . import support


def at(year, month, day, hour=12):
    return datetime(year, month, day, hour, tzinfo=CST)


class ObserveTest(unittest.TestCase):
    def test_first_observation_sets_baseline(self):
        book = ledger.observe(ledger.empty(), 10.0, at(2026, 1, 1))
        self.assertEqual(book["date"], "2026-01-01")
        self.assertEqual(book["baseline"], 10.0)
        self.assertEqual(book["used"], 0.0)

    def test_spend_accumulates(self):
        book = ledger.observe(ledger.empty(), 10.0, at(2026, 1, 1, 10))
        book = ledger.observe(book, 9.5, at(2026, 1, 1, 11))
        book = ledger.observe(book, 9.0, at(2026, 1, 1, 12))
        self.assertAlmostEqual(book["used"], 1.0)
        self.assertAlmostEqual(book["last"], 9.0)

    def test_topup_raises_baseline_without_losing_spend(self):
        book = ledger.observe(ledger.empty(), 10.0, at(2026, 1, 1, 10))
        book = ledger.observe(book, 9.0, at(2026, 1, 1, 11))  # 花掉 1
        book = ledger.observe(book, 59.0, at(2026, 1, 1, 12))  # 充值 50
        self.assertAlmostEqual(book["used"], 1.0)
        self.assertAlmostEqual(book["baseline"], 60.0)
        self.assertAlmostEqual(book["last"], 59.0)

    def test_day_rollover_freezes_previous_day(self):
        book = ledger.observe(ledger.empty(), 10.0, at(2026, 1, 1, 10))
        book = ledger.observe(book, 8.0, at(2026, 1, 1, 20))
        book = ledger.observe(book, 8.0, at(2026, 1, 2, 9))
        self.assertEqual(book["date"], "2026-01-02")
        self.assertAlmostEqual(book["days"]["2026-01-01"], 2.0)
        self.assertAlmostEqual(book["used"], 0.0)

    def test_negative_balance_is_fine(self):
        book = ledger.observe(ledger.empty(), -4.55, at(2026, 1, 1))
        self.assertEqual(book["baseline"], -4.55)
        self.assertEqual(book["used"], 0.0)

    def test_observation_does_not_mutate_input(self):
        original = ledger.observe(ledger.empty(), 10.0, at(2026, 1, 1))
        snapshot = dict(original)
        ledger.observe(original, 9.0, at(2026, 1, 1, 13))
        self.assertEqual(original["used"], snapshot["used"])


class WeekUsedTest(unittest.TestCase):
    def test_counts_today_and_previous_days(self):
        now = at(2026, 1, 8)
        book = ledger.empty()
        book["date"] = "2026-01-08"
        book["used"] = 3.0
        book["days"] = {"2026-01-07": 2.0, "2026-01-02": 5.0, "2025-12-31": 99.0}
        self.assertAlmostEqual(ledger.week_used(book, now), 10.0)

    def test_includes_yesterday_when_today_not_yet_observed(self):
        now = at(2026, 1, 8, 9)
        book = ledger.empty()
        book["date"] = "2026-01-07"
        book["used"] = 4.0
        self.assertAlmostEqual(ledger.week_used(book, now), 4.0)

    def test_never_negative(self):
        now = at(2026, 1, 8)
        book = ledger.empty()
        book.update(date="2026-01-08", used=-5.0, days={"2026-01-07": -2.0})
        self.assertEqual(ledger.week_used(book, now), 0.0)


class PruneTest(unittest.TestCase):
    def test_keeps_newest_sixty_days(self):
        days = {f"2025-01-{day:02d}": 1.0 for day in range(1, 32)}
        days.update({f"2025-02-{day:02d}": 1.0 for day in range(1, 32)})
        book = ledger.empty()
        book["days"] = days
        pruned = ledger._prune(book["days"])
        self.assertEqual(len(pruned), 60)

    def test_view_shape(self):
        now = at(2026, 1, 1)
        view = ledger.view(ledger.observe(ledger.empty(), 5.0, now), now)
        self.assertEqual(set(view), {"today", "week7", "days", "updated"})


class LoadSaveTest(unittest.TestCase):
    def test_roundtrip_with_tmp_dir(self):
        home = support.temp_dir()
        book = ledger.observe(ledger.empty(), 7.0, at(2026, 1, 1))
        ledger.save(home, book)
        loaded = ledger.load(home)
        self.assertEqual(loaded["date"], "2026-01-01")
        self.assertAlmostEqual(loaded["baseline"], 7.0)


if __name__ == "__main__":
    unittest.main()
