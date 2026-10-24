"""路径解析：所有文件的落点只在这里定义一次。

历史版本里"包根配置"和"%APPDATA% 配置"同时存在、且按文件是否存在来决
定用哪个，导致用户按文档填了 Cookie 却不生效。现在规则只有一条：

    home = --home 参数 | MIMO_WHALE_HOME | 平台默认目录

home 下的文件名是固定的，不再有第二套候选。
"""

from __future__ import annotations

import os
from pathlib import Path

APP_DIRNAME = "MiMoWhale"

CONFIG_NAME = "config.json"
CACHE_NAME = "cache.json"
LEDGER_NAME = "ledger.json"
SETTINGS_NAME = "settings.json"  # 由 Electron 写，Python 只读不写
AUTOSTART_NAME = "autostart.json"
LOG_DIRNAME = "logs"
PET_DIRNAME = "pets"
BIN_DIRNAME = "bin"

# 旧版本可能遗留的文件名，仅用于一次性迁移
LEGACY_CONFIG_NAMES = ("whale.config.json", "whale.cache.json", "whale.ledger.json")


def app_root() -> Path:
    """仓库根目录（含 package.json / artwork-nc）。"""
    return Path(__file__).resolve().parents[2]


def default_home(env: dict | None = None) -> Path:
    env = os.environ if env is None else env
    override = (env.get("MIMO_WHALE_HOME") or "").strip()
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        base = env.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_DIRNAME
    base = env.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / APP_DIRNAME.lower()


def resolve_home(explicit: str | Path | None = None, env: dict | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    return default_home(env)


def ensure_home(home: Path) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    return home


def config_file(home: Path) -> Path:
    return home / CONFIG_NAME


def cache_file(home: Path) -> Path:
    return home / CACHE_NAME


def ledger_file(home: Path) -> Path:
    return home / LEDGER_NAME


def settings_file(home: Path) -> Path:
    return home / SETTINGS_NAME


def autostart_file(home: Path) -> Path:
    return home / AUTOSTART_NAME


def pets_dir(home: Path) -> Path:
    return home / PET_DIRNAME


def logs_dir(home: Path) -> Path:
    return home / LOG_DIRNAME


def bin_dir(home: Path) -> Path:
    return home / BIN_DIRNAME


def legacy_files(home: Path, root: Path | None = None) -> list[Path]:
    """可能存在的旧版文件（迁移用，不参与运行时解析）。"""
    found: list[Path] = []
    for name in LEGACY_CONFIG_NAMES:
        for base in (home, root):
            if base is None:
                continue
            candidate = Path(base) / name
            if candidate.exists():
                found.append(candidate)
    return found


def session_db_candidates(env: dict | None = None) -> list[Path]:
    """mimocode.db 的候选位置，按优先级排列。

    MiMo 桌面端沿用 OpenCode 的 XDG 风格路径；同时兼容少数把库放在
    APPDATA / LOCALAPPDATA 下的版本。
    """
    env = os.environ if env is None else env
    candidates: list[Path] = []
    override = (env.get("MIMO_DB") or "").strip()
    if override:
        candidates.append(Path(override).expanduser())
    home = Path.home()
    candidates.append(home / ".local" / "share" / "mimocode" / "mimocode.db")
    for key in ("APPDATA", "LOCALAPPDATA"):
        base = env.get(key)
        if base:
            candidates.append(Path(base) / "mimocode" / "mimocode.db")
    return candidates


def session_db(env: dict | None = None) -> Path | None:
    for candidate in session_db_candidates(env):
        if candidate.exists():
            return candidate
    return None
