"""把接口、账本、会话库组合成前端要的唯一快照，并管理缓存。

两条路径，字段形状完全一致：

``refresh()``  联网 → 更新账本 → 写缓存 → 返回 ``source="api"``
``snapshot()`` 只读缓存 + 现算本地会话数据 → ``source="cache"``（不联网）

Electron 用 snapshot 做秒级刷新，用 refresh 做分钟级刷新和"立即刷新"，
这样"看数字"永远不会触发网络请求。
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from . import __version__, api, config as config_mod, credentials, crypto, ledger as ledger_mod, paths, sessions
from .errors import WhaleError
from .jsonio import read_json, write_json

SCHEMA = 2


# ---------------------------------------------------------------- 本地部分


def _session_tokens(session_id: str | None) -> dict:
    try:
        return sessions.token_stats(session_id)
    except WhaleError as exc:
        return {"ok": False, "error": exc.code, "message": exc.message}


def _last_turn(session_id: str | None) -> dict:
    try:
        data = sessions.last_turn(session_id)
        return data
    except WhaleError as exc:
        return {"ok": False, "error": exc.code, "message": exc.message}


def _local(session_id: str | None) -> dict:
    return {"sessionTokens": _session_tokens(session_id), "lastTurn": _last_turn(session_id)}


# ---------------------------------------------------------------- 缓存


def _cache(home: Path) -> dict | None:
    data = read_json(paths.cache_file(home), None)
    if isinstance(data, dict) and data.get("schema") == SCHEMA:
        return data
    return None


def _age_seconds(payload: dict, now: datetime) -> float | None:
    stamp = payload.get("generatedAt")
    if not stamp:
        return None
    try:
        generated = datetime.fromisoformat(str(stamp))
    except ValueError:
        return None
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=api.CST)
    return max(0.0, (now - generated).total_seconds())


def _decorate(payload: dict, cfg: dict, now: datetime, session_id: str | None) -> dict:
    out = dict(payload)
    out.update(_local(session_id))
    out["schema"] = SCHEMA
    age = _age_seconds(payload, now)
    out["cacheAgeSeconds"] = round(age, 1) if age is not None else None
    out["stale"] = bool(age is None or age > config_mod.refresh_seconds(cfg) * 2)
    return out


def _empty(cfg: dict) -> dict:
    return {
        "schema": SCHEMA,
        "ok": False,
        "source": "none",
        "stale": True,
        "cacheAgeSeconds": None,
        "error": None,
        "balance": None,
        "tokenPlan": None,
        "ledger": None,
        "sessionTokens": None,
        "lastTurn": None,
        "alertConfig": None,
        "generatedAt": None,
        "refreshSeconds": config_mod.refresh_seconds(cfg),
    }


def _fallback(home: Path, cfg: dict, session_id: str | None, now: datetime, code: str, message: str) -> dict:
    """联网失败：有缓存就返回缓存 + 错误，没有就返回错误空壳。

    回落到缓存时一律标记 ``stale``：界面上要能看出"这是旧数据"，
    与 ``snapshot()`` 的"按缓存年龄判断"是两回事。
    """
    cached = _cache(home)
    if cached:
        out = _decorate(cached, cfg, now, session_id)
        out["ok"] = True
        out["source"] = "cache"
        out["stale"] = True
        out["error"] = {"code": code, "message": message}
        return out
    out = _empty(cfg)
    out.update(_local(session_id))
    out["error"] = {"code": code, "message": message}
    return out


# ---------------------------------------------------------------- 对外


def snapshot(home: Path, session_id: str | None = None, now: datetime | None = None) -> dict:
    """只读缓存 + 现算本地数据，绝不联网。"""
    now = now or datetime.now(api.CST)
    cfg = config_mod.load(home)
    cached = _cache(home)
    if not cached:
        out = _empty(cfg)
        out.update(_local(session_id))
        out["error"] = {"code": "NO_CACHE", "message": "还没有缓存，刷新一次即可"}
        return out

    out = _decorate(cached, cfg, now, session_id)
    out["ok"] = True
    out["source"] = "cache"
    out["error"] = None
    return out


def refresh(home: Path, session_id: str | None = None, now: datetime | None = None) -> dict:
    """联网刷新；失败时回落到缓存并把错误一起带回去。"""
    now = now or datetime.now(api.CST)
    cfg = config_mod.load(home)
    cookie = credentials.resolve(cfg)
    if not cookie:
        return _fallback(home, cfg, session_id, now, "NO_COOKIE", "未配置 MiMo Cookie（菜单里粘贴即可）")

    try:
        client = api.Client(cookie)
        # 余额是核心：拿不到就整体回落（旧缓存 + 错误提示）。
        balance = client.balance()
    except WhaleError as exc:
        return _fallback(home, cfg, session_id, now, exc.code, exc.message)

    # 套餐与预警各自容错：它们失败不该把已经拿到的余额一起丢掉
    # （旧实现三者包在同一个 try 里，tokenPlan 一失败，余额白拿、账本也不更新）。
    try:
        plan = client.token_plan()
    except WhaleError as exc:
        plan = {
            "hasPlan": False,
            "planCode": "",
            "expired": False,
            "periodEnd": None,
            "used": 0,
            "limit": 0,
            "percent": 0.0,
            "itemName": "",
            "queriedAt": api.now_iso(),
            "error": exc.code,
            "message": exc.message,
        }
    try:
        alert = client.alert_config()
    except WhaleError as exc:
        alert = {"ok": False, "enabled": False, "threshold": None, "error": exc.code, "message": exc.message}

    book = ledger_mod.observe(ledger_mod.load(home), float(balance["amount"]), now)
    ledger_mod.save(home, book)

    payload = {
        "schema": SCHEMA,
        "ok": True,
        "source": "api",
        "stale": False,
        "cacheAgeSeconds": 0.0,
        "error": None,
        "balance": balance,
        "tokenPlan": plan,
        "ledger": ledger_mod.view(book, now),
        "sessionTokens": None,
        "lastTurn": None,
        "alertConfig": alert,
        "generatedAt": now.isoformat(timespec="seconds"),
        "refreshSeconds": config_mod.refresh_seconds(cfg),
    }
    payload.update(_local(session_id))
    try:
        write_json(paths.cache_file(home), payload)
    except OSError:
        # 磁盘写不进去不该让界面拿不到数据
        pass
    return payload


def diagnostics(home: Path) -> dict:
    """诊断信息：只给结论，不给凭证。"""
    cfg = config_mod.load(home)
    cookie = credentials.resolve(cfg)
    db = paths.session_db()
    return {
        "version": __version__,
        "schema": SCHEMA,
        "home": str(home),
        "configPath": str(paths.config_file(home)),
        "cachePath": str(paths.cache_file(home)),
        "ledgerPath": str(paths.ledger_file(home)),
        "sessionDb": str(db) if db else None,
        "sessionDbFound": bool(db),
        "cookie": credentials.mask(cookie),
        "cookieSource": "env" if credentials.from_env() else ("config" if cookie else "none"),
        "cookieStore": cfg.get("cookieStore", "none"),
        "cookieStoreHint": _store_hint(cfg.get("cookieStore", "none")),
        "refreshSeconds": config_mod.refresh_seconds(cfg),
        "python": {"executable": sys.executable, "version": sys.version.split()[0], "utf8": _utf8_mode()},
        "platform": sys.platform,
        "encryption": "dpapi" if crypto.available() else "none",
    }


def _utf8_mode() -> bool:
    return bool(getattr(sys.flags, "utf8_mode", 0)) or sys.getdefaultencoding() == "utf-8"


def _store_hint(store: str) -> str:
    if store == "dpapi":
        return "DPAPI 加密（仅本机当前用户可解）"
    if store == "plain":
        return "明文存储（不推荐：换机/拷贝会泄露，可重新保存以加密）"
    return "未配置"
