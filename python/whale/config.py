"""config.json：数据源相关配置（Cookie、Python 路径、刷新间隔）。

**写入方只有 Python（CLI / sidecar / setup.ps1）**；Electron 只读不写。
界面偏好走 settings.json，由 Electron 独占——两个 owner 各管一个文件，
避免并发写同一个 JSON。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import paths
from .jsonio import read_json, write_json

CST = timezone(timedelta(hours=8))

DEFAULT = {
    "schema": 2,
    "refreshSeconds": 60,
    "python": "",
    "cookie": "",
    "cookieDpapi": "",
    # dpapi | plain | none —— 记录当前 Cookie 是怎么存的，诊断面板据此告警
    "cookieStore": "none",
    "cookieUpdated": "",
    "updated": "",
}

MIN_REFRESH = 20
MAX_REFRESH = 3600

COOKIE_STORES = ("dpapi", "plain", "none")


def now_iso() -> str:
    return datetime.now(CST).isoformat(timespec="seconds")


def normalize(data: dict | None) -> dict:
    cfg = dict(DEFAULT)
    if isinstance(data, dict):
        cfg.update({k: v for k, v in data.items() if k in DEFAULT or k == "schema"})
    try:
        cfg["refreshSeconds"] = max(MIN_REFRESH, min(MAX_REFRESH, int(cfg.get("refreshSeconds") or 60)))
    except (TypeError, ValueError):
        cfg["refreshSeconds"] = DEFAULT["refreshSeconds"]
    cfg["python"] = str(cfg.get("python") or "")
    cfg["cookie"] = str(cfg.get("cookie") or "")
    cfg["cookieDpapi"] = str(cfg.get("cookieDpapi") or "")
    # 旧配置没有这个字段：按实际内容推断，避免显示成"未配置"
    store = str(cfg.get("cookieStore") or "")
    if store not in COOKIE_STORES:
        if cfg["cookieDpapi"]:
            store = "dpapi"
        elif cfg["cookie"]:
            store = "plain"
        else:
            store = "none"
    cfg["cookieStore"] = store
    cfg["schema"] = 2
    return cfg


def load(home: Path) -> dict:
    return normalize(read_json(paths.config_file(home), {}))


def save(home: Path, data: dict) -> Path:
    cfg = normalize(data)
    cfg["updated"] = now_iso()
    paths.ensure_home(home)
    return write_json(paths.config_file(home), cfg)


def ensure(home: Path) -> dict:
    """确保配置文件存在（首次运行时落一份默认值）。"""
    path = paths.config_file(home)
    if not path.exists():
        save(home, load(home))
    return load(home)


def set_python(home: Path, exe: str) -> dict:
    cfg = load(home)
    cfg["python"] = str(exe or "")
    save(home, cfg)
    return cfg


def refresh_seconds(cfg: dict | None = None) -> int:
    if not cfg:
        return DEFAULT["refreshSeconds"]
    return normalize(cfg)["refreshSeconds"]
