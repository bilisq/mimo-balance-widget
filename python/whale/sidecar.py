"""NDJSON 常驻服务：Electron 主进程与数据层之间唯一的通道。

为什么是常驻进程而不是"每次调用起一个进程"：后者每次要付
0.3~1.2 秒的解释器启动 + import 开销，而挂件需要秒级探针。

协议（每行一个 JSON 对象，UTF-8，无 BOM）：

    → {"id": 1, "cmd": "probe", "args": {"session": null}}
    ← {"id": 1, "ok": true,  "data": {...}}
    ← {"id": 1, "ok": false, "error": {"code": "NO_DB", "message": "..."}}

启动后先输出一行 ``{"event": "ready", ...}``，关闭时退出码 0。
未知命令、坏 JSON、单条命令异常都**不会**终止进程——挂件不该因为某次
查询失败就失去数据源。
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from . import __version__, api, config as config_mod, credentials, migrate, paths, sessions, summary
from .errors import WhaleError


class Server:
    def __init__(self, home: Path):
        self.home = home
        self.running = True
        self.commands = {
            "ping": self.cmd_ping,
            "snapshot": self.cmd_snapshot,
            "refresh": self.cmd_refresh,
            "set-cookie": self.cmd_set_cookie,
            "configure": self.cmd_configure,
            "migrate": self.cmd_migrate,
            "sessions": self.cmd_sessions,
            "session": self.cmd_session,
            "turn": self.cmd_turn,
            "probe": self.cmd_probe,
            "pending": self.cmd_pending,
            "diagnose": self.cmd_diagnose,
            "shutdown": self.cmd_shutdown,
        }

    # ------------------------------------------------------------ 输出
    def _write(self, message: dict) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
        sys.stdout.buffer.flush()

    def _log(self, text: str) -> None:
        sys.stderr.write(f"[whale-sidecar] {text}\n")
        sys.stderr.flush()

    # ------------------------------------------------------------ 命令
    def _session_arg(self, args: dict) -> str | None:
        value = args.get("session") if isinstance(args, dict) else None
        return str(value) if value else None

    def cmd_ping(self, args: dict) -> dict:
        return {
            "version": __version__,
            "pid": os.getpid(),
            "home": str(self.home),
            "python": sys.executable,
        }

    def cmd_snapshot(self, args: dict) -> dict:
        return summary.snapshot(self.home, self._session_arg(args))

    def cmd_refresh(self, args: dict) -> dict:
        return summary.refresh(self.home, self._session_arg(args))

    def cmd_set_cookie(self, args: dict) -> dict:
        raw = args.get("cookie") if isinstance(args, dict) else ""
        return credentials.save(self.home, str(raw or ""))

    def cmd_configure(self, args: dict) -> dict:
        """纠正 config.json 里记录的路径/间隔（换机器后 Python 路径会失效）。"""
        cfg = config_mod.load(self.home)
        exe = str(args.get("python") or "").strip()
        if exe:
            cfg["python"] = exe
        refresh = args.get("refresh")
        if refresh:
            try:
                cfg["refreshSeconds"] = int(refresh)
            except (TypeError, ValueError):
                pass
        path = config_mod.save(self.home, cfg)
        return {"ok": True, "config": str(path), "python": cfg["python"], "refreshSeconds": cfg["refreshSeconds"]}

    def cmd_migrate(self, args: dict) -> dict:
        """迁移旧版配置（并把旧文件里的明文 Cookie 抹掉）。幂等。"""
        return {"ok": True, **migrate.run(self.home, paths.app_root())}

    def cmd_sessions(self, args: dict) -> dict:
        limit = args.get("limit") if isinstance(args, dict) else None
        return sessions.list_sessions(int(limit) if limit else 15)

    def cmd_session(self, args: dict) -> dict:
        return sessions.token_stats(self._session_arg(args))

    def cmd_turn(self, args: dict) -> dict:
        return sessions.last_turn(self._session_arg(args))

    def cmd_probe(self, args: dict) -> dict:
        data = sessions.probe(self._session_arg(args))
        if data.get("sessionId") is None:
            return {**data, "pending": None, "ok": True}
        return data

    def cmd_pending(self, args: dict) -> dict:
        return sessions.pending(self._session_arg(args)) or {"ok": True, "kind": None}

    def cmd_diagnose(self, args: dict) -> dict:
        info = summary.diagnostics(self.home)
        cfg = config_mod.load(self.home)
        info["refreshSeconds"] = config_mod.refresh_seconds(cfg)
        info["pythonPinned"] = cfg.get("python") or ""
        info["now"] = datetime.now(api.CST).isoformat(timespec="seconds")
        return info

    def cmd_shutdown(self, args: dict) -> dict:
        self.running = False
        return {"ok": True}

    # ------------------------------------------------------------ 主循环
    def serve(self) -> int:
        self._write(
            {
                "event": "ready",
                "version": __version__,
                "home": str(self.home),
                "pid": os.getpid(),
            }
        )
        self._log(f"ready v{__version__} home={self.home}")

        for raw in sys.stdin.buffer:
            if not self.running:
                break
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                self._write({"id": None, "ok": False, "error": {"code": "BAD_REQUEST", "message": "不是合法 JSON"}})
                continue
            if not isinstance(message, dict):
                self._write({"id": None, "ok": False, "error": {"code": "BAD_REQUEST", "message": "需要 JSON 对象"}})
                continue

            request_id = message.get("id")
            name = str(message.get("cmd") or "")
            args = message.get("args") if isinstance(message.get("args"), dict) else {}
            handler = self.commands.get(name)
            if handler is None:
                self._write(
                    {
                        "id": request_id,
                        "ok": False,
                        "error": {"code": "BAD_COMMAND", "message": f"未知命令：{name}"},
                    }
                )
                continue

            try:
                data = handler(args)
                self._write({"id": request_id, "ok": True, "data": data})
            except WhaleError as exc:
                self._write({"id": request_id, "ok": False, "error": exc.to_dict()})
            except Exception as exc:  # noqa: BLE001 - 单条命令失败不能拖垮服务
                self._log(f"command {name} failed: {exc!r}")
                self._write(
                    {
                        "id": request_id,
                        "ok": False,
                        "error": {"code": "INTERNAL", "message": str(exc)},
                    }
                )
        return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    home_arg = ""
    if "--home" in argv:
        index = argv.index("--home")
        if index + 1 < len(argv):
            home_arg = argv[index + 1]
    home = paths.resolve_home(home_arg or None)
    return Server(home).serve()


if __name__ == "__main__":
    sys.exit(main())
