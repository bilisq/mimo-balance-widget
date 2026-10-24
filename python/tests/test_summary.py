"""快照聚合：缓存回落、无 Cookie、联网成功写缓存。"""

from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta
from unittest import mock

from whale import api, credentials, paths, summary
from whale.errors import WhaleError

from . import support

COOKIE = "api-platform_serviceToken=abc; userId=2272017759"
NOW = datetime(2026, 10, 19, 12, 0, 0, tzinfo=api.CST)


class FakeClient:
    def __init__(self, cookie, **_kwargs):
        self.cookie = cookie

    def balance(self):
        return {"amount": 12.5, "cash": 10.0, "gift": 2.5, "currency": "CNY", "queriedAt": "2026-10-19T12:00:00+08:00"}

    def token_plan(self):
        return {
            "hasPlan": True,
            "planCode": "lite",
            "expired": False,
            "periodEnd": "2026-11-18 23:59:59",
            "used": 150,
            "limit": 1000,
            "percent": 15.0,
            "itemName": "month_total_token",
            "queriedAt": "2026-10-19T12:00:00+08:00",
        }

    def alert_config(self):
        return {"ok": True, "enabled": True, "threshold": 5.0, "userId": "2272017759", "queriedAt": "x"}


class FailingClient(FakeClient):
    def balance(self):
        raise WhaleError("NETWORK", "断网了")


class PartialClient(FakeClient):
    """余额正常，但套餐接口挂了——不能让余额一起丢。"""

    def token_plan(self):
        raise WhaleError("HTTP_500", "套餐接口 500")


class SummaryTest(unittest.TestCase):
    def setUp(self):
        self.home = support.temp_dir()
        self.env = mock.patch.dict(os.environ, {"MIMO_COOKIE": ""}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_snapshot_without_cache(self):
        payload = summary.snapshot(self.home, None, NOW)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "NO_CACHE")

    def test_refresh_without_cookie(self):
        payload = summary.refresh(self.home, None, NOW)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "NO_COOKIE")

    def test_refresh_success_writes_cache_and_ledger(self):
        credentials.save(self.home, COOKIE)
        with mock.patch("whale.summary.api.Client", FakeClient):
            payload = summary.refresh(self.home, None, NOW)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["source"], "api")
        self.assertEqual(payload["balance"]["amount"], 12.5)
        self.assertEqual(payload["tokenPlan"]["percent"], 15.0)
        self.assertTrue(paths.cache_file(self.home).exists())
        self.assertTrue(paths.ledger_file(self.home).exists())
        self.assertEqual(payload["generatedAt"], NOW.isoformat(timespec="seconds"))

    def test_plan_failure_does_not_discard_balance(self):
        # 旧实现三者共用一个 try：tokenPlan 一挂，已经取到的余额也被丢掉
        credentials.save(self.home, COOKIE)
        with mock.patch("whale.summary.api.Client", PartialClient):
            payload = summary.refresh(self.home, None, NOW)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["source"], "api")
        self.assertEqual(payload["balance"]["amount"], 12.5)
        self.assertEqual(payload["tokenPlan"]["error"], "HTTP_500")
        self.assertFalse(payload["tokenPlan"]["hasPlan"])
        self.assertTrue(paths.ledger_file(self.home).exists(), "余额拿到了就该记账")

    def test_refresh_failure_falls_back_to_cache(self):
        credentials.save(self.home, COOKIE)
        with mock.patch("whale.summary.api.Client", FakeClient):
            summary.refresh(self.home, None, NOW)
        later = NOW + timedelta(seconds=1)
        with mock.patch("whale.summary.api.Client", FailingClient):
            payload = summary.refresh(self.home, None, later)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["error"]["code"], "NETWORK")
        self.assertTrue(payload["stale"])
        # 缓存本身没被错误数据覆盖
        self.assertEqual(payload["balance"]["amount"], 12.5)

    def test_snapshot_reads_cache_without_network(self):
        credentials.save(self.home, COOKIE)
        with mock.patch("whale.summary.api.Client", FakeClient):
            summary.refresh(self.home, None, NOW)
        with mock.patch("whale.summary.api.Client", side_effect=AssertionError("不该联网")):
            payload = summary.snapshot(self.home, None, NOW + timedelta(seconds=5))
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["source"], "cache")
        self.assertFalse(payload["stale"])

    def test_snapshot_marks_stale_by_age(self):
        credentials.save(self.home, COOKIE)
        with mock.patch("whale.summary.api.Client", FakeClient):
            summary.refresh(self.home, None, NOW)
        payload = summary.snapshot(self.home, None, NOW + timedelta(hours=2))
        self.assertTrue(payload["stale"])

    def test_refresh_never_crashes_on_local_db_problems(self):
        # 会话库异常时，会话字段应降级为 ok=False，而不是让整次刷新失败
        credentials.save(self.home, COOKIE)
        broken = mock.patch("whale.summary.sessions.token_stats", side_effect=WhaleError("NO_DB", "找不到库"))
        with broken, mock.patch("whale.summary.api.Client", FakeClient):
            payload = summary.refresh(self.home, None, NOW)
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["sessionTokens"]["ok"])
        self.assertEqual(payload["sessionTokens"]["error"], "NO_DB")


class DiagnosticsTest(unittest.TestCase):
    def test_masks_cookie(self):
        home = support.temp_dir()
        credentials.save(home, COOKIE)
        info = summary.diagnostics(home)
        self.assertNotIn("abc", info["cookie"])
        self.assertEqual(info["schema"], 2)
        self.assertIn("configPath", info)


if __name__ == "__main__":
    unittest.main()
