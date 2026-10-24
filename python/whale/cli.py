"""命令行入口：``python -m whale.cli <command>``。

设计约定：
- 成功时 stdout 只有一个 JSON 对象（或纯文本报告），退出码 0；
- 失败时 stdout 只有一个 JSON ``{"ok": false, "error": {...}}``，退出码 1；
- 所有输出强制 UTF-8，避免在 GBK 控制台被重定向时崩溃或乱码。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from . import __version__, api, config as config_mod, credentials, format as format_mod, ledger, migrate, paths, sessions, summary
from .errors import WhaleError

_ACTIONS = {"balance": "balance", "plan": "token_plan", "alert": "alert_config"}


def _force_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


def _emit(obj: object) -> None:
    text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, indent=2)
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="whale",
        description="MiMo 余额挂件命令行（非官方接口，需要控制台 Cookie）",
    )
    parser.add_argument("--home", default="", help="数据目录（默认 %%APPDATA%%\\MiMoWhale）")
    parser.add_argument("--session", default="", help="指定会话 id（默认最新会话）")
    parser.add_argument("--offline", action="store_true", help="只用缓存，不联网")
    parser.add_argument("--version", action="version", version=f"mimo-balance-widget {__version__}")

    sub = parser.add_subparsers(dest="command")
    for name, help_text in (
        ("summary", "纯文本报告"),
        ("json", "完整快照 JSON"),
        ("snapshot", "只用缓存的快照 JSON"),
        ("balance", "余额接口原始结果"),
        ("plan", "Token Plan 结果"),
        ("alert", "官方预警阈值"),
        ("ledger", "本地账本"),
        ("sessions", "会话列表"),
        ("session", "当前会话累计用量"),
        ("turn", "最近一整轮用量"),
        ("probe", "轻量探针（步数 / 等待状态）"),
        ("pending", "是否在等待回答或授权"),
        ("diagnose", "诊断信息"),
    ):
        sub.add_parser(name, help=help_text)

    cookie = sub.add_parser("set-cookie", help="保存 Cookie")
    cookie.add_argument("value", nargs="?", default="", help="Cookie 字符串；用 - 表示从 stdin 读取")
    cookie.add_argument("--from-stdin", action="store_true", help="从 stdin 读取")

    configure = sub.add_parser("configure", help="写入 Python 路径 / 刷新间隔（setup.ps1 调用）")
    configure.add_argument("--python", default="", help="Python 解释器绝对路径")
    configure.add_argument("--refresh", type=int, default=0, help="自动刷新间隔（秒）")

    sub.add_parser("migrate", help="迁移旧版配置与账本")
    return parser


def main(argv: list[str] | None = None) -> int:
    _force_utf8()
    args = build_parser().parse_args(argv)
    home = paths.resolve_home(args.home or None)
    session = args.session or None
    command = args.command or "summary"

    try:
        if command in ("summary", "json"):
            payload = summary.snapshot(home, session) if args.offline else summary.refresh(home, session)
            _emit(format_mod.summary_text(payload) if command == "summary" else payload)
            return 0

        if command == "snapshot":
            _emit(summary.snapshot(home, session))
            return 0

        if command in _ACTIONS:
            cookie_value = credentials.resolve(config_mod.load(home))
            if not cookie_value:
                raise WhaleError("NO_COOKIE", "未配置 MiMo Cookie")
            client = api.Client(cookie_value)
            _emit(getattr(client, _ACTIONS[command])())
            return 0

        if command == "ledger":
            book = ledger.load(home)
            _emit({**book, "week7": ledger.week_used(book, datetime.now(api.CST))})
            return 0

        if command == "sessions":
            _emit(sessions.list_sessions())
            return 0

        if command == "session":
            _emit(sessions.token_stats(session))
            return 0

        if command == "turn":
            _emit(sessions.last_turn(session))
            return 0

        if command == "probe":
            _emit(sessions.probe(session))
            return 0

        if command == "pending":
            _emit(sessions.pending(session) or {"ok": True, "kind": None})
            return 0

        if command == "diagnose":
            _emit(summary.diagnostics(home))
            return 0

        if command == "set-cookie":
            raw = args.value or ""
            if args.from_stdin or raw in ("-", "--stdin"):
                raw = sys.stdin.read()
            _emit(credentials.save(home, raw))
            return 0

        if command == "configure":
            cfg = config_mod.load(home)
            python_arg = getattr(args, "python", "") or ""
            if python_arg:
                cfg["python"] = python_arg
            refresh_arg = int(getattr(args, "refresh", 0) or 0)
            if refresh_arg:
                cfg["refreshSeconds"] = refresh_arg
            path = config_mod.save(home, cfg)
            _emit(
                {
                    "ok": True,
                    "config": str(path),
                    "python": cfg["python"],
                    "refreshSeconds": cfg["refreshSeconds"],
                }
            )
            return 0

        if command == "migrate":
            _emit({"ok": True, **migrate.run(home, paths.app_root())})
            return 0

        raise WhaleError("BAD_COMMAND", f"未知命令：{command}")
    except WhaleError as exc:
        _emit({"ok": False, "error": exc.to_dict()})
        return 1
    except KeyboardInterrupt:  # pragma: no cover
        return 130


if __name__ == "__main__":
    sys.exit(main())
