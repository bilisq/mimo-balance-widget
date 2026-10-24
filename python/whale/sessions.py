"""只读访问 MiMo 会话轨迹库（SQLite）。

库由 MiMo 桌面端写入，这里只用 ``mode=ro`` 打开，绝不写入。
表结构（MiMo 沿用 OpenCode 的轨迹模型）：

    session(id, title, time_created)
    message(id, session_id, time_created, data JSON)   data.role = user|assistant
    part(id, session_id, time_created, data JSON)      data.type = step-finish|tool|text ...
    permission(id, time_updated, data JSON)

所有耗时聚合都基于 ``part`` 表里 ``type='step-finish'`` 的记录：
它带 tokens（input/output/reasoning/cache）与 cost，是唯一可信的用量来源。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

from .errors import WhaleError
from .paths import session_db

# 一次读取所有 step-finish（按时间升序），其余聚合都在 Python 里做，
# 比在 SQL 里反复 json_extract 更快，也更容易读。
SQL_STEPS = """
SELECT data
FROM part
WHERE session_id = ?
  AND json_extract(data, '$.type') = 'step-finish'
  AND json_extract(data, '$.tokens') IS NOT NULL
ORDER BY time_created ASC
"""


@contextmanager
def connect(db: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    path = Path(db) if db else session_db()
    if not path or not path.exists():
        raise WhaleError(
            "NO_DB",
            "找不到 MiMo 会话库 mimocode.db（需要先安装并使用 MiMo 桌面端；"
            "也可用环境变量 MIMO_DB 指定路径）",
        )
    uri = "file:" + quote(path.as_posix(), safe="/:") + "?mode=ro"
    try:
        con = sqlite3.connect(uri, uri=True, timeout=2.0)
    except sqlite3.Error as exc:
        raise WhaleError("DB_ERROR", f"无法打开会话库：{exc}") from exc
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout = 2000")
        yield con
    except sqlite3.Error as exc:
        raise WhaleError("DB_ERROR", f"读取会话库失败：{exc}") from exc
    finally:
        con.close()


# ---------------------------------------------------------------- 内部工具


def _latest_session(cur: sqlite3.Cursor) -> str | None:
    row = cur.execute("SELECT id FROM session ORDER BY time_created DESC LIMIT 1").fetchone()
    return str(row["id"]) if row else None


def _resolve_session(cur: sqlite3.Cursor, session_id: str | None) -> str | None:
    """指定会话时**先确认它还在**。

    用户可能锁过一个后来被删掉的会话；直接拿这个 id 去查会永远得到 0，
    看起来像"用量突然归零"。这里回落到最新会话，至少还能看到真实数据。
    """
    if session_id:
        row = cur.execute("SELECT id FROM session WHERE id = ?", (str(session_id),)).fetchone()
        if row:
            return str(row["id"])
    return _latest_session(cur)


def _steps(cur: sqlite3.Cursor, session_id: str) -> list[dict]:
    """整个会话的 step-finish 记录（升序）。"""
    rows = cur.execute(SQL_STEPS, (session_id,)).fetchall()
    steps: list[dict] = []
    for row in rows:
        try:
            steps.append(json.loads(row["data"]))
        except (TypeError, ValueError):
            continue
    return steps


def _steps_between(cur: sqlite3.Cursor, session_id: str, start: int, end: int) -> list[dict]:
    """取某一轮内的 step-finish。

    ``part`` 的 time_created 同样是毫秒时间戳；用 SQL 过滤比在 Python 里
    过滤快得多，也不需要把整个会话读进内存。
    """
    rows = cur.execute(
        """
        SELECT data FROM part
        WHERE session_id = ?
          AND json_extract(data, '$.type') = 'step-finish'
          AND json_extract(data, '$.tokens') IS NOT NULL
          AND time_created >= ?
          AND time_created <= ?
        ORDER BY time_created ASC
        """,
        (session_id, start, end),
    ).fetchall()
    steps: list[dict] = []
    for row in rows:
        try:
            steps.append(json.loads(row["data"]))
        except (TypeError, ValueError):
            continue
    return steps


def _sum(steps: list[dict]) -> dict:
    total_in = total_out = total_reasoning = 0
    cache_read = cache_write = 0
    cost = 0.0
    context_last = 0
    for step in steps:
        tokens = step.get("tokens") or {}
        total_in += int(tokens.get("input") or 0)
        total_out += int(tokens.get("output") or 0)
        total_reasoning += int(tokens.get("reasoning") or 0)
        cache = tokens.get("cache") or {}
        cache_read += int(cache.get("read") or 0)
        cache_write += int(cache.get("write") or 0)
        try:
            cost += float(step.get("cost") or 0)
        except (TypeError, ValueError):
            pass
        context_last = int(tokens.get("total") or context_last)

    billed = total_in + total_out + total_reasoning
    denominator = cache_read + total_in
    hit_rate = round(cache_read * 100.0 / denominator, 1) if denominator > 0 else None
    return {
        "billed": billed,
        "input": total_in,
        "output": total_out,
        "reasoning": total_reasoning,
        "contextLast": context_last,
        "cache": {"read": cache_read, "write": cache_write, "hitRate": hit_rate},
        "cost": round(cost, 6),
    }


# ---------------------------------------------------------------- 对外查询

# 会话统计的短期缓存：key = (库路径, 会话, step 数, 最后一步时间)。
# 这两个值不变就说明没有新步骤，没必要把整段 JSON 重新解析一遍。
# sidecar 是常驻进程，所以这份缓存真的能省下重复开销（长会话尤其明显）。
_STATS_CACHE: dict[tuple[str, str, int, int], dict] = {}
_STATS_CACHE_MAX = 8


def _cache_store(key: tuple[str, str, int, int], value: dict) -> dict:
    _STATS_CACHE[key] = value
    while len(_STATS_CACHE) > _STATS_CACHE_MAX:
        _STATS_CACHE.pop(next(iter(_STATS_CACHE)))
    return value


def token_stats(session_id: str | None = None, db: str | Path | None = None) -> dict:
    """整个会话的累计 token / 缓存 / 花费。

    先用一条轻量查询拿到 (步数, 最后一步时间)：两者都没变就直接用缓存，
    避免把整个会话的 step-finish 反复读进内存重算。
    """
    with connect(db) as con:
        cur = con.cursor()
        sid = _resolve_session(cur, session_id)
        if not sid:
            raise WhaleError("NO_SESSION", "会话库里还没有任何会话")

        row = cur.execute(
            """
            SELECT COUNT(*), COALESCE(MAX(time_created), 0)
            FROM part
            WHERE session_id = ?
              AND json_extract(data, '$.type') = 'step-finish'
              AND json_extract(data, '$.tokens') IS NOT NULL
            """,
            (sid,),
        ).fetchone()
        count, last_ts = int(row[0] or 0), int(row[1] or 0)

        key = (str(db or ""), sid, count, last_ts)
        cached = _STATS_CACHE.get(key)
        if cached is not None:
            return cached

        steps = _steps(cur, sid)
        totals = _sum(steps)
        result = {
            "ok": True,
            "sessionId": sid,
            "steps": len(steps),
            "tokens": {
                "billed": totals["billed"],
                "input": totals["input"],
                "output": totals["output"],
                "reasoning": totals["reasoning"],
                "contextLast": totals["contextLast"],
            },
            "cache": totals["cache"],
            "cost": totals["cost"],
            "message": None if steps else "暂无 step-finish 记录",
        }

        if not steps:
            # 有对话、却没有 step-finish：多半是 MiMo 改了轨迹格式。
            # 静默显示 0 会让人以为"没花钱"，不如明确告警。
            has_messages = cur.execute(
                "SELECT COUNT(*) FROM message WHERE session_id = ?", (sid,)
            ).fetchone()[0]
            if int(has_messages or 0) > 0:
                return {
                    "ok": False,
                    "error": "SCHEMA_MISMATCH",
                    "sessionId": sid,
                    "message": "会话里没有 step-finish 记录（MiMo 可能升级了轨迹格式）",
                }

        return _cache_store(key, result)


def last_turn(session_id: str | None = None, db: str | Path | None = None) -> dict:
    """最近一整轮对话（上一条 user 消息之后，到最后一个 reason=stop 为止）。"""
    with connect(db) as con:
        cur = con.cursor()
        sid = _resolve_session(cur, session_id)
        if not sid:
            raise WhaleError("NO_SESSION", "会话库里还没有任何会话")

        row = cur.execute(
            """
            SELECT time_created FROM part
            WHERE session_id = ?
              AND json_extract(data, '$.type') = 'step-finish'
              AND json_extract(data, '$.reason') = 'stop'
            ORDER BY time_created DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        if not row:
            raise WhaleError("NO_TURN_END", "还没有结束的一轮对话")
        stop_ts = int(row["time_created"])

        start_row = cur.execute(
            """
            SELECT COALESCE(MAX(time_created), 0) AS ts
            FROM message
            WHERE session_id = ?
              AND json_extract(data, '$.role') = 'user'
              AND time_created <= ?
            """,
            (sid, stop_ts),
        ).fetchone()
        start_ts = int(start_row["ts"] or 0)

        steps = _steps_between(cur, sid, start_ts, stop_ts)
        totals = _sum(steps)

        turn_no = int(
            cur.execute(
                """
                SELECT COUNT(*) FROM message
                WHERE session_id = ?
                  AND json_extract(data, '$.role') = 'user'
                  AND time_created <= ?
                """,
                (sid, stop_ts),
            ).fetchone()[0]
            or 0
        )

        duration = max(0, stop_ts - start_ts) / 1000.0
        per_second = round(totals["billed"] / duration, 1) if duration > 0.2 else None
        return {
            "ok": True,
            "sessionId": sid,
            "endedAt": stop_ts,
            "startAt": start_ts,
            "turn": turn_no,
            "steps": len(steps),
            "durationSec": round(duration, 2),
            "tokPerSec": per_second,
            "billed": totals["billed"],
            "input": totals["input"],
            "output": totals["output"],
            "reasoning": totals["reasoning"],
            "tokens": {
                "billed": totals["billed"],
                "input": totals["input"],
                "output": totals["output"],
                "reasoning": totals["reasoning"],
            },
            "cache": {"read": totals["cache"]["read"], "hitRate": totals["cache"]["hitRate"]},
            "cost": totals["cost"],
        }


def probe(session_id: str | None = None, db: str | Path | None = None) -> dict:
    """轻量探针：步数 + 最新时间 + 最后 stop 时间 + 是否在等用户。

    每 1.2 秒调用一次，所以**只开一次连接**，把四条查询放在同一个连接里做完。
    """
    with connect(db) as con:
        cur = con.cursor()
        sid = _resolve_session(cur, session_id)
        if not sid:
            return {"ok": True, "sessionId": None, "count": 0, "lastTs": 0, "lastStopTs": 0, "pending": None}

        count, last_ts = cur.execute(
            """
            SELECT COUNT(*), COALESCE(MAX(time_created), 0)
            FROM part
            WHERE session_id = ? AND json_extract(data, '$.type') = 'step-finish'
            """,
            (sid,),
        ).fetchone()
        last_stop = cur.execute(
            """
            SELECT COALESCE(MAX(time_created), 0)
            FROM part
            WHERE session_id = ?
              AND json_extract(data, '$.type') = 'step-finish'
              AND json_extract(data, '$.reason') = 'stop'
            """,
            (sid,),
        ).fetchone()[0]
        pending_info = _pending_with(cur, sid)

    return {
        "ok": True,
        "sessionId": sid,
        "count": int(count or 0),
        "lastTs": int(last_ts or 0),
        "lastStopTs": int(last_stop or 0),
        "pending": pending_info,
    }


def _pending_with(cur: sqlite3.Cursor, sid: str) -> dict | None:
    """在已有连接上判断"是否在等用户"。独立出来是为了让 probe 复用连接。"""
    rows = cur.execute(
        """
        SELECT data, time_created FROM part
        WHERE session_id = ?
          AND json_extract(data, '$.tool') = 'question'
          AND json_extract(data, '$.type') = 'tool'
        ORDER BY time_created DESC LIMIT 5
        """,
        (sid,),
    ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row["data"] or "{}")
        except (TypeError, ValueError):
            continue
        state = payload.get("state") or {}
        status = str(state.get("status") or "").lower()
        answered = state.get("output") not in (None, "")
        if answered or status in ("completed", "error", "cancelled"):
            continue
        if status in ("pending", "waiting", "running"):
            return {
                "kind": "question",
                "message": "正在等待主人回答…",
                "at": int(row["time_created"] or 0),
            }

    try:
        rows = cur.execute(
            "SELECT data, time_updated FROM permission ORDER BY time_updated DESC LIMIT 10"
        ).fetchall()
    except sqlite3.Error:
        rows = []
    for row in rows:
        raw = row["data"]
        try:
            data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except (TypeError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        status = str(data.get("status") or (data.get("state") or {}).get("status") or "").lower()
        if status in ("pending", "waiting", "requested", "ask", "asking"):
            message = data.get("message") or data.get("title") or "正在等待主人授权…"
            return {
                "kind": "auth",
                "message": str(message),
                "at": int(row["time_updated"] or 0),
            }
    return None


def pending(session_id: str | None = None, db: str | Path | None = None) -> dict | None:
    """检测"等待用户回答 / 授权"（单独调用时用；probe 内部会复用同一个连接）。

    只认明确信号，绝不从"bash 正在跑"之类推断：
    - question 工具处于 pending/waiting/running 且还没有输出
    - permission 表里存在 pending 状态的行
    """
    with connect(db) as con:
        cur = con.cursor()
        sid = _resolve_session(cur, session_id)
        if not sid:
            return None
        return _pending_with(cur, sid)

def list_sessions(limit: int = 15, db: str | Path | None = None) -> dict:
    with connect(db) as con:
        cur = con.cursor()
        try:
            limit = max(1, min(100, int(limit)))
        except (TypeError, ValueError):
            limit = 15
        rows = cur.execute(
            "SELECT id, title, time_created FROM session ORDER BY time_created DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return {
            "ok": True,
            "sessions": [
                {
                    "id": str(row["id"]),
                    "title": str(row["title"] or "(未命名)"),
                    "time": int(row["time_created"] or 0),
                }
                for row in rows
            ],
        }
