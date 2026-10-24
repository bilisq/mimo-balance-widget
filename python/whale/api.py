"""MiMo 网页控制台接口（非官方，Cookie 鉴权）。

只做三件事：发请求、剥掉外层信封、把字段整理成稳定的 dict。
所有网络错误统一抛 :class:`WhaleError`，调用方不需要认识 urllib。

可测性：``Client(transport=...)`` 可注入假传输函数，
``transport(url, headers, timeout) -> (status, body)``。
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

from . import __version__
from .errors import WhaleError

BASE_URL = "https://platform.xiaomimimo.com/api/v1"
CONSOLE_URL = "https://platform.xiaomimimo.com/#/console/balance"
TIMEOUT = 15
CST = timezone(timedelta(hours=8))

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
)

Transport = Callable[..., "tuple[int, str]"]


def now_iso() -> str:
    return datetime.now(CST).isoformat(timespec="seconds")


def _urllib_transport(url: str, headers: dict, timeout: int, method: str = "GET") -> tuple[int, str]:
    # method 显式传入：目前控制台接口都是 GET，但把动词写死在这里，
    # 将来接口换成 POST 就得改传输层（而不是调用点）。
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""


def plan_percent(used: int, limit: int, reported: object) -> float:
    """计算 Token Plan 使用百分比。

    优先用 used/limit（权威且无歧义）。只有在没有上限时才参考接口返回的
    百分比字段——历史版本对 0~1 的小数做了 ×100 猜测，会把真实的 0.5%
    显示成 50%，这里不再猜测。
    """
    if limit and limit > 0:
        value = used * 100.0 / limit
    else:
        try:
            value = float(reported)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0
    return round(max(0.0, min(100.0, value)), 1)


class Client:
    def __init__(self, cookie: str, timeout: int = TIMEOUT, transport: Transport | None = None):
        self.cookie = cookie
        self.timeout = timeout
        self._transport: Transport = transport or _urllib_transport

    # ------------------------------------------------------------ 内部
    def _headers(self) -> dict:
        return {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cookie": self.cookie,
            "Origin": "https://platform.xiaomimimo.com",
            "Referer": CONSOLE_URL,
            "x-timeZone": "UTC+08:00",
            "User-Agent": USER_AGENT,
            "x-widget-version": f"mimo-balance-widget/{__version__}",
        }

    def _request(self, path: str, method: str = "GET"):
        url = f"{BASE_URL}/{path.lstrip('/')}"
        try:
            status, body = self._transport(url, self._headers(), self.timeout, method)
        except WhaleError:
            raise
        except Exception as exc:  # noqa: BLE001 - 网络层的所有异常都归为 NETWORK
            raise WhaleError("NETWORK", f"网络请求失败：{exc}") from exc

        if status in (401, 403):
            raise WhaleError("COOKIE_INVALID", "MiMo Cookie 已失效，请重新登录控制台复制 Cookie")
        if status >= 400:
            raise WhaleError(f"HTTP_{status}", f"接口返回 HTTP {status}")

        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise WhaleError("BAD_JSON", "接口返回的不是 JSON（可能被代理拦截）") from exc

        if not isinstance(payload, dict):
            raise WhaleError("BAD_JSON", "接口返回结构异常")

        code = payload.get("code")
        if code not in (0, "0", None):
            if code in (401, 403, "401", "403"):
                raise WhaleError("COOKIE_INVALID", "MiMo Cookie 已失效，请重新登录控制台复制 Cookie")
            message = str(payload.get("message") or code)
            raise WhaleError(f"API_{code}", message)
        return payload.get("data")

    # ------------------------------------------------------------ 公开
    def balance(self) -> dict:
        data = self._request("balance")
        if not isinstance(data, dict):
            raise WhaleError("EMPTY_BALANCE", "余额接口返回为空")
        if "balance" not in data:
            # 字段被改名时静默按 0 处理会显示"余额 ¥0.00"，比报错更危险
            raise WhaleError("API_SHAPE", "余额接口里没有 balance 字段（接口可能已变更）")

        def as_float(value):
            try:
                return round(float(value), 6)
            except (TypeError, ValueError):
                return None

        return {
            "amount": as_float(data.get("balance")) or 0.0,
            "cash": as_float(data.get("cashBalance")),
            "gift": as_float(data.get("giftBalance")),
            "currency": str(data.get("currency") or "CNY"),
            "queriedAt": now_iso(),
        }

    def token_plan(self) -> dict:
        detail = usage = None
        errors: list[WhaleError] = []
        for name, target in (("tokenPlan/detail", "detail"), ("tokenPlan/usage", "usage")):
            try:
                value = self._request(name)
            except WhaleError as exc:
                errors.append(exc)
                value = None
            if target == "detail":
                detail = value
            else:
                usage = value

        # 两个接口都因为鉴权失败时，不能假装"未开通套餐"——那是误导用户。
        if len(errors) == 2 and all(exc.code == "COOKIE_INVALID" for exc in errors):
            raise errors[0]

        used = limit = 0
        reported = None
        item_name = ""
        month = (usage or {}).get("monthUsage") or {}
        items = month.get("items") or []
        if items and isinstance(items[0], dict):
            item = items[0]
            used = int(item.get("used") or 0)
            limit = int(item.get("limit") or 0)
            reported = item.get("percent")
            item_name = str(item.get("name") or "")
        if month.get("percent") is not None:
            reported = month.get("percent")

        detail = detail or {}
        # 两个接口都失败（且不是鉴权问题）时，区分"确实没开通"和"查不到"：
        # 前者 hasPlan=False 且没有 error，后者带 error 让界面显示"查询失败"。
        plan_error = None
        plan_message = None
        if len(errors) == 2:
            plan_error = errors[0].code
            plan_message = errors[0].message

        has_plan = bool(detail.get("planCode")) or limit > 0
        return {
            "hasPlan": has_plan,
            "planCode": str(detail.get("planCode") or ""),
            "expired": bool(detail.get("expired")),
            "periodEnd": str(detail.get("currentPeriodEnd") or "") or None,
            "used": used,
            "limit": limit,
            "percent": plan_percent(used, limit, reported),
            "itemName": item_name,
            "queriedAt": now_iso(),
            "error": plan_error,
            "message": plan_message,
        }

    def alert_config(self) -> dict:
        """官方余额预警阈值。拿不到不算失败，返回 ok=False 让上层用本地设置。"""
        try:
            data = self._request("balanceAlertConfig") or {}
        except WhaleError as exc:
            return {"ok": False, "error": exc.code, "message": exc.message}
        config = (data or {}).get("config") or {}
        threshold = config.get("balance_threshold")
        try:
            threshold = float(threshold) if threshold is not None else None
        except (TypeError, ValueError):
            threshold = None
        return {
            "ok": True,
            "enabled": bool((data or {}).get("enabled")),
            "threshold": threshold,
            "userId": str((data or {}).get("user_id") or ""),
            "queriedAt": now_iso(),
        }
