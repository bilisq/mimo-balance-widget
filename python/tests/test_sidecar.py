"""sidecar 协议：UTF-8 分帧、错误隔离、不因单条命令失败退出。"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from . import support

PY_DIR = Path(__file__).resolve().parents[1]


def run_sidecar(requests: list[dict], home: Path, timeout: int = 20) -> list[dict]:
    process = subprocess.Popen(
        [sys.executable, "-u", "-m", "whale.sidecar", "--home", str(home)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(PY_DIR),
    )
    payload = "".join(json.dumps(item) + "\n" for item in requests).encode("utf-8")
    out, _err = process.communicate(payload, timeout=timeout)
    lines = [line for line in out.decode("utf-8").splitlines() if line.strip()]
    return [json.loads(line) for line in lines]


class SidecarTest(unittest.TestCase):
    def test_ready_then_ping_then_shutdown(self):
        messages = run_sidecar(
            [{"id": 1, "cmd": "ping"}, {"id": 2, "cmd": "shutdown"}],
            support.temp_dir(),
        )
        self.assertEqual(messages[0]["event"], "ready")
        self.assertEqual(messages[0]["version"], "0.1.0")
        ping = [m for m in messages if m.get("id") == 1][0]
        self.assertTrue(ping["ok"])
        self.assertIn("version", ping["data"])
        self.assertTrue([m for m in messages if m.get("id") == 2][0]["ok"])

    def test_unknown_command_does_not_kill_process(self):
        messages = run_sidecar(
            [{"id": 1, "cmd": "nope"}, {"id": 2, "cmd": "ping"}],
            support.temp_dir(),
        )
        first = [m for m in messages if m.get("id") == 1][0]
        second = [m for m in messages if m.get("id") == 2][0]
        self.assertFalse(first["ok"])
        self.assertEqual(first["error"]["code"], "BAD_COMMAND")
        self.assertTrue(second["ok"])

    def test_chinese_survives_pipe(self):
        # 关键回归：GBK 管道下中文曾经乱码 / 直接抛 UnicodeEncodeError
        messages = run_sidecar([{"id": 1, "cmd": "snapshot"}], support.temp_dir())
        envelope = [m for m in messages if m.get("id") == 1][0]
        self.assertTrue(envelope["ok"])
        snapshot = envelope["data"]
        self.assertFalse(snapshot["ok"])
        self.assertIn("缓存", snapshot["error"]["message"])

    def test_configure_writes_python_path(self):
        home = support.temp_dir()
        messages = run_sidecar(
            [
                {"id": 1, "cmd": "configure", "args": {"python": "C:/fake/python.exe", "refresh": 90}},
                {"id": 2, "cmd": "shutdown"},
            ],
            home,
        )
        reply = [m for m in messages if m.get("id") == 1][0]
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["data"]["python"], "C:/fake/python.exe")

        saved = json.loads((home / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["python"], "C:/fake/python.exe")
        self.assertEqual(saved["refreshSeconds"], 90)

    def test_bad_json_is_reported(self):
        process = subprocess.Popen(
            [sys.executable, "-u", "-m", "whale.sidecar"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(PY_DIR),
        )
        out, _err = process.communicate(b"not json\n", timeout=20)
        lines = [json.loads(line) for line in out.decode("utf-8").splitlines() if line.strip()]
        self.assertEqual(lines[0]["event"], "ready")
        self.assertEqual(lines[1]["error"]["code"], "BAD_REQUEST")


if __name__ == "__main__":
    unittest.main()
