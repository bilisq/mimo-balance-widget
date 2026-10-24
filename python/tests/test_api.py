"""接口层：信封解析、错误映射、百分比计算。"""

from __future__ import annotations

import json
import unittest

from whale import api
from whale.errors import WhaleError


def fake_transport(status, body):
    def _transport(url, headers, timeout, method="GET"):
        _transport.calls.append({"url": url, "headers": headers, "timeout": timeout, "method": method})
        return status, body

    _transport.calls = []
    return _transport


class PlanPercentTest(unittest.TestCase):
    def test_prefers_used_over_limit(self):
        self.assertEqual(api.plan_percent(5, 1000, 0.5), 0.5)

    def test_small_percentage_is_not_inflated(self):
        # 历史 bug：把 0.5 当成 0~1 小数再乘 100，显示成 50%
        self.assertEqual(api.plan_percent(5, 1000, None), 0.5)

    def test_without_limit_uses_reported(self):
        self.assertEqual(api.plan_percent(0, 0, 0.5), 0.5)
        self.assertEqual(api.plan_percent(0, 0, 42), 42.0)

    def test_clamped(self):
        self.assertEqual(api.plan_percent(2000, 1000, None), 100.0)
        self.assertEqual(api.plan_percent(0, 0, -3), 0.0)


class ClientTest(unittest.TestCase):
    def test_balance_envelope(self):
        body = json.dumps(
            {
                "code": 0,
                "data": {"balance": 12.34, "cashBalance": 10, "giftBalance": 2.34, "currency": "CNY"},
            }
        )
        client = api.Client("api-platform_serviceToken=x; userId=1", transport=fake_transport(200, body))
        data = client.balance()
        self.assertEqual(data["amount"], 12.34)
        self.assertEqual(data["cash"], 10.0)
        self.assertEqual(data["gift"], 2.34)
        self.assertEqual(data["currency"], "CNY")

    def test_cookie_sent_as_header(self):
        transport = fake_transport(200, json.dumps({"code": 0, "data": {"balance": 1}}))
        api.Client("api-platform_serviceToken=x; userId=1", transport=transport).balance()
        call = transport.calls[0]
        self.assertIn("platform.xiaomimimo.com/api/v1/balance", call["url"])
        self.assertEqual(call["headers"]["Cookie"], "api-platform_serviceToken=x; userId=1")

    def test_method_is_forwarded(self):
        # 目前接口都是 GET，但动词不应该被写死在传输层里
        transport = fake_transport(200, json.dumps({"code": 0, "data": {}}))
        client = api.Client("c", transport=transport)
        client._request("balance", "POST")
        self.assertEqual(transport.calls[0]["method"], "POST")
        client._request("balance")
        self.assertEqual(transport.calls[1]["method"], "GET")

    def test_missing_balance_field_is_reported(self):
        # 字段被改名时不能静默按 0 处理，否则界面会显示"余额 ¥0.00"
        body = json.dumps({"code": 0, "data": {"cashBalance": 1}})
        with self.assertRaises(WhaleError) as ctx:
            api.Client("c", transport=fake_transport(200, body)).balance()
        self.assertEqual(ctx.exception.code, "API_SHAPE")

    def test_token_plan_failure_is_not_reported_as_no_plan(self):
        # 两个套餐接口都 500：必须带 error，否则界面会说"未开通"
        plan = api.Client("c", transport=fake_transport(500, "")).token_plan()
        self.assertFalse(plan["hasPlan"])
        self.assertEqual(plan["error"], "HTTP_500")

    def test_token_plan_absent_means_no_plan(self):
        body = json.dumps({"code": 0, "data": {}})
        plan = api.Client("c", transport=fake_transport(200, body)).token_plan()
        self.assertFalse(plan["hasPlan"])
        self.assertIsNone(plan["error"], "确实没开通时不应带 error")

    def test_401_means_cookie_invalid(self):
        client = api.Client("c", transport=fake_transport(401, ""))
        with self.assertRaises(WhaleError) as ctx:
            client.balance()
        self.assertEqual(ctx.exception.code, "COOKIE_INVALID")

    def test_api_error_code(self):
        body = json.dumps({"code": 500, "message": "内部错误"})
        with self.assertRaises(WhaleError) as ctx:
            api.Client("c", transport=fake_transport(200, body)).balance()
        self.assertEqual(ctx.exception.code, "API_500")
        self.assertIn("内部错误", ctx.exception.message)

    def test_non_json_body(self):
        with self.assertRaises(WhaleError) as ctx:
            api.Client("c", transport=fake_transport(200, "<html>")).balance()
        self.assertEqual(ctx.exception.code, "BAD_JSON")

    def test_transport_crash_becomes_network_error(self):
        def boom(url, headers, timeout, method="GET"):
            raise OSError("no route")

        with self.assertRaises(WhaleError) as ctx:
            api.Client("c", transport=boom).balance()
        self.assertEqual(ctx.exception.code, "NETWORK")

    def test_token_plan_reads_items(self):
        body = json.dumps(
            {
                "code": 0,
                "data": {
                    "monthUsage": {
                        "items": [{"used": 150, "limit": 1000, "percent": 15, "name": "month_total_token"}],
                        "percent": 15,
                    }
                },
            }
        )
        client = api.Client("c", transport=fake_transport(200, body))
        # detail 也成功
        plan = client.token_plan()
        self.assertEqual(plan["used"], 150)
        self.assertEqual(plan["limit"], 1000)
        self.assertEqual(plan["percent"], 15.0)

    def test_token_plan_reports_auth_failure(self):
        with self.assertRaises(WhaleError) as ctx:
            api.Client("c", transport=fake_transport(401, "")).token_plan()
        self.assertEqual(ctx.exception.code, "COOKIE_INVALID")

    def test_alert_config_failure_is_not_fatal(self):
        alert = api.Client("c", transport=fake_transport(500, "")).alert_config()
        self.assertFalse(alert["ok"])


if __name__ == "__main__":
    unittest.main()
