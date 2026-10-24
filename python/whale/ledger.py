"""本地记账：用"余额差值"估算今日 / 近 7 天消耗。

接口没有直接的"今日花费"字段，所以只能在每次观测余额时做差。
充值会让余额变大——那部分抬高质量基准，不冲掉已记录的消耗。

所有函数都是纯函数（时间由参数传入），方便单测。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from . import paths
from .jsonio import read_json, write_json

KEEP_DAYS = 60


def empty() -> dict:
    return {"date": "", "baseline": None, "last": None, "used": 0.0, "days": {}, "updated": ""}


def _normalize(raw: object) -> dict:
    book = empty()
    if isinstance(raw, dict):
        book["date"] = str(raw.get("date") or "")
        book["baseline"] = raw.get("baseline")
        book["last"] = raw.get("last")
        try:
            book["used"] = float(raw.get("used") or 0.0)
        except (TypeError, ValueError):
            book["used"] = 0.0
        days = raw.get("days")
        if isinstance(days, dict):
            cleaned = {}
            for key, value in days.items():
                try:
                    cleaned[str(key)] = round(float(value), 6)
                except (TypeError, ValueError):
                    continue
            book["days"] = cleaned
        book["updated"] = str(raw.get("updated") or "")
    return book


def load(home: Path) -> dict:
    return _normalize(read_json(paths.ledger_file(home), {}))


def save(home: Path, book: dict) -> Path:
    return write_json(paths.ledger_file(home), _normalize(book))


def observe(book: dict, balance: float, now: datetime) -> dict:
    """把一次余额观测并入账本，返回**新**账本（不改入参）。"""
    next_book = _normalize(book)
    today = now.strftime("%Y-%m-%d")

    if next_book["date"] != today:
        if next_book["date"]:
            # 跨天：把那天的累计值定格
            next_book["days"][next_book["date"]] = round(float(next_book["used"]), 6)
        next_book["date"] = today
        next_book["baseline"] = balance
        next_book["last"] = balance
        next_book["used"] = 0.0
    elif next_book["baseline"] is None or next_book["last"] is None:
        next_book["baseline"] = balance
        next_book["last"] = balance
    else:
        delta = float(next_book["last"]) - float(balance)
        if delta > 0:
            next_book["used"] = float(next_book["used"]) + delta
        elif delta < 0:
            # 充值 / 赠送到账：抬高基准，保证 used 不被抵消
            next_book["baseline"] = float(next_book["baseline"]) - delta
        next_book["last"] = balance

    next_book["days"] = _prune(next_book["days"])
    next_book["updated"] = now.isoformat(timespec="seconds")
    return next_book


def _prune(days: dict) -> dict:
    if len(days) <= KEEP_DAYS:
        return days
    keep = sorted(days.keys(), reverse=True)[:KEEP_DAYS]
    return {key: days[key] for key in sorted(keep)}


def week_used(book: dict, now: datetime) -> float:
    """近 7 天（含今天）的估算消耗。"""
    book = _normalize(book)
    today = now.strftime("%Y-%m-%d")
    days = dict(book["days"])
    live_date = book["date"] or today
    if live_date == today:
        days[today] = float(book["used"])
    elif live_date:
        # 今天还没观测过：昨天那一笔仍只在 used 里，先按 yesterday 记
        days.setdefault(live_date, float(book["used"]))

    total = 0.0
    for offset in range(7):
        day = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
        total += float(days.get(day) or 0.0)
    return round(max(0.0, total), 6)


def view(book: dict, now: datetime) -> dict:
    """给前端用的账本视图。"""
    book = _normalize(book)
    return {
        "today": round(float(book["used"]), 6),
        "week7": week_used(book, now),
        "days": book["days"],
        "updated": book["updated"] or None,
    }
