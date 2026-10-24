"""会话库读取：用真实的 SQLite 夹具验证聚合、探针与格式漂移告警。"""

from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path

from whale import sessions
from whale.errors import WhaleError

from . import support

SCHEMA = """
CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, time_created INTEGER);
CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
CREATE TABLE part (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
CREATE TABLE permission (id TEXT, time_updated INTEGER, data TEXT);
"""


def step(tokens: dict, cost: float, reason: str | None = None) -> str:
    payload = {"type": "step-finish", "tokens": tokens, "cost": cost}
    if reason:
        payload["reason"] = reason
    return json.dumps(payload)


def build_db() -> Path:
    path = support.temp_dir("sessions-") / "mimocode.db"
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.execute("INSERT INTO session VALUES ('s1', 'demo', 1000)")
    con.execute("INSERT INTO session VALUES ('s2', 'empty', 2000)")
    # s1：两条 user 消息 + 两个 step-finish + 一个待回答的 question 工具
    con.executemany(
        "INSERT INTO message VALUES (?, 's1', ?, ?)",
        [
            ("m1", 1100, json.dumps({"role": "user"})),
            ("m2", 1250, json.dumps({"role": "user"})),
        ],
    )
    con.executemany(
        "INSERT INTO part VALUES (?, 's1', ?, ?)",
        [
            (
                "p1",
                1200,
                step(
                    {"input": 100, "output": 50, "reasoning": 10, "total": 160, "cache": {"read": 900, "write": 0}},
                    0.01,
                    "stop",
                ),
            ),
            (
                "p2",
                1300,
                step(
                    {"input": 200, "output": 60, "reasoning": 20, "total": 280, "cache": {"read": 1800, "write": 0}},
                    0.02,
                ),
            ),
            (
                "p3",
                1400,
                json.dumps({"type": "tool", "tool": "question", "state": {"status": "running"}}),
            ),
        ],
    )
    # s2：有消息但没有 step-finish，模拟 MiMo 改了轨迹格式
    con.execute("INSERT INTO message VALUES ('m3', 's2', 2100, ?)", (json.dumps({"role": "user"}),))
    con.commit()
    con.close()
    return path


class TokenStatsTest(unittest.TestCase):
    def setUp(self):
        self.db = build_db()

    def test_sums_tokens_cache_and_cost(self):
        stats = sessions.token_stats("s1", self.db)
        self.assertTrue(stats["ok"])
        self.assertEqual(stats["steps"], 2)
        self.assertEqual(stats["tokens"]["input"], 300)
        self.assertEqual(stats["tokens"]["output"], 110)
        self.assertEqual(stats["tokens"]["reasoning"], 30)
        self.assertEqual(stats["tokens"]["billed"], 440)
        self.assertEqual(stats["tokens"]["contextLast"], 280)
        self.assertEqual(stats["cache"]["read"], 2700)
        self.assertAlmostEqual(stats["cache"]["hitRate"], 90.0)
        self.assertAlmostEqual(stats["cost"], 0.03, places=6)

    def test_second_call_hits_cache_and_stays_correct(self):
        first = sessions.token_stats("s1", self.db)
        second = sessions.token_stats("s1", self.db)
        self.assertEqual(first, second)

    def test_schema_drift_is_reported(self):
        stats = sessions.token_stats("s2", self.db)
        self.assertFalse(stats["ok"], "有消息却没有 step-finish 时不能静默返回 0")
        self.assertEqual(stats["error"], "SCHEMA_MISMATCH")

    def test_unknown_session_falls_back_to_latest(self):
        # 锁定的会话被删掉时，不能永远显示 0；回落到最新会话
        stats = sessions.token_stats("nope", self.db)
        self.assertEqual(stats["sessionId"], "s2")
        self.assertEqual(stats["error"], "SCHEMA_MISMATCH")


class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.db = build_db()

    def test_counts_and_stop_timestamp(self):
        probe = sessions.probe("s1", self.db)
        self.assertEqual(probe["count"], 2)
        self.assertEqual(probe["lastTs"], 1300)
        self.assertEqual(probe["lastStopTs"], 1200)

    def test_detects_pending_question(self):
        probe = sessions.probe("s1", self.db)
        self.assertIsNotNone(probe["pending"])
        self.assertEqual(probe["pending"]["kind"], "question")

    def test_empty_db_returns_zeros(self):
        probe = sessions.probe("unknown", self.db)
        self.assertEqual(probe["count"], 0)
        self.assertIsNone(probe["pending"])

    def test_pending_helper_matches_probe(self):
        self.assertEqual(sessions.pending("s1", self.db)["kind"], "question")


class LastTurnTest(unittest.TestCase):
    def setUp(self):
        self.db = build_db()

    def test_last_turn_uses_time_window(self):
        turn = sessions.last_turn("s1", self.db)
        self.assertTrue(turn["ok"])
        # stop 在 1200，最近一条 user 消息在 1100，所以这一轮只含 p1
        self.assertEqual(turn["steps"], 1)
        self.assertEqual(turn["tokens"]["billed"], 160)
        self.assertEqual(turn["startAt"], 1100)

    def test_no_completed_turn(self):
        with self.assertRaises(WhaleError) as ctx:
            sessions.last_turn("s2", self.db)
        self.assertEqual(ctx.exception.code, "NO_TURN_END")


if __name__ == "__main__":
    unittest.main()
