"""金额 / token 格式化与纯文本报告（CLI 与技能用）。"""

from __future__ import annotations


def money(value: object, currency: str = "CNY") -> str:
    if value is None:
        return "—"
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "—"
    symbol = "¥" if str(currency or "CNY").upper() in ("CNY", "RMB", "") else f"{currency} "
    return f"{symbol}{number:,.2f}"


def tokens(value: object) -> str:
    try:
        number = int(value or 0)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "0"
    if number >= 1_000_000:
        return f"{number / 1_000_000:.2f}M"
    if number >= 1_000:
        return f"{number / 1_000:.1f}K"
    return str(number)


def percent(value: object) -> str:
    try:
        return f"{float(value or 0):.1f}%"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "—"


def summary_text(payload: dict) -> str:
    """把快照渲染成给人和 AI 看的纯文本。"""
    balance = payload.get("balance") or {}
    plan = payload.get("tokenPlan") or {}
    book = payload.get("ledger") or {}
    currency = balance.get("currency") or "CNY"

    lines = ["【MiMo 账户】"]
    lines.append(f"余额：{money(balance.get('amount'), currency)}")
    if balance.get("cash") is not None:
        lines.append(f"  现金 {money(balance.get('cash'), currency)}")
    if balance.get("gift") is not None:
        lines.append(f"  赠送 {money(balance.get('gift'), currency)}")

    if plan.get("hasPlan"):
        lines.append(f"Token Plan：{plan.get('planCode') or '已开通'}")
        if plan.get("limit"):
            lines.append(
                f"  已用 {tokens(plan.get('used'))} / {tokens(plan.get('limit'))}"
                f"（{percent(plan.get('percent'))}）"
            )
        if plan.get("periodEnd"):
            lines.append(f"  本期至 {plan.get('periodEnd')}")
    else:
        lines.append("Token Plan：未开通")

    lines.append("【本地记账】")
    lines.append(f"今日消耗：{money(book.get('today'), currency)}（按余额差值估算）")
    lines.append(f"近 7 天：{money(book.get('week7'), currency)}")

    stats = payload.get("sessionTokens") or {}
    if stats.get("ok"):
        cache = stats.get("cache") or {}
        lines.append("【当前会话】")
        lines.append(
            f"  {stats.get('steps', 0)} 步 · {tokens((stats.get('tokens') or {}).get('billed'))} tok"
            f" · {money(stats.get('cost'), currency)}"
        )
        if cache.get("hitRate") is not None:
            lines.append(f"  缓存命中 {percent(cache.get('hitRate'))}")

    error = payload.get("error") or {}
    if error:
        lines.append(f"⚠ {error.get('message') or error.get('code')}")
    elif payload.get("stale"):
        lines.append("⚠ 显示的是缓存数据")
    stamp = payload.get("generatedAt")
    if stamp:
        lines.append(f"查询时间：{stamp}")
    return "\n".join(lines)
