"""Cookie 的规范化、校验、存取。

Cookie 是账号凭证，处理原则：

1. 只在内存里出现明文，落盘**默认必须加密**（Windows DPAPI，当前用户级）；
2. 加密不可用时不再"悄悄存明文"——Windows 上直接报错，除非显式设置
   ``MIMO_WHALE_ALLOW_PLAINTEXT=1``；非 Windows（仅 CLI 场景）允许明文但会打标记；
3. 任何日志 / 诊断输出都必须先经 :func:`mask` 脱敏；
4. 解析顺序固定：环境变量 > 加密配置 > 明文配置（加密值优先，避免旧值覆盖新值）。
"""

from __future__ import annotations

import os
from pathlib import Path

from . import config as config_mod
from . import crypto
from .errors import WhaleError
from .jsonio import read_json, write_json

REQUIRED_TOKEN = "api-platform_serviceToken="
REQUIRED_USER = "userId="
ENV_NAME = "MIMO_COOKIE"
ALLOW_PLAINTEXT_ENV = "MIMO_WHALE_ALLOW_PLAINTEXT"


def normalize(raw: str) -> str:
    """去掉 'Cookie:' 前缀、折叠空白（复制来的头经常带换行）。"""
    text = (raw or "").strip()
    if text.lower().startswith("cookie:"):
        text = text.split(":", 1)[1].strip()
    return " ".join(text.split())


def is_valid(cookie: str) -> bool:
    return REQUIRED_TOKEN in cookie and REQUIRED_USER in cookie


def mask(cookie: str) -> str:
    """用于诊断面板：只露 userId 与长度，不泄露 token。"""
    if not cookie:
        return "(未配置)"
    user = ""
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith(REQUIRED_USER):
            user = part[len(REQUIRED_USER) :]
            break
    return f"已配置（userId={user or '?'}，共 {len(cookie)} 字符）"


def from_env(env: dict | None = None) -> str:
    env = os.environ if env is None else env
    return normalize(env.get(ENV_NAME, ""))


def resolve(cfg: dict, env: dict | None = None) -> str:
    """按固定优先级取出可用 Cookie；取不到返回空串。

    加密值排在明文前面：迁移过的配置里 ``cookie`` 会被清空，但用户手动改过的
    旧文件可能残留明文，此时以加密值为准。
    """
    env_cookie = from_env(env)
    if is_valid(env_cookie):
        return env_cookie

    sealed = str(cfg.get("cookieDpapi") or "")
    if sealed:
        restored = normalize(crypto.unprotect(sealed) or "")
        if is_valid(restored):
            return restored

    plain = normalize(str(cfg.get("cookie") or ""))
    if is_valid(plain):
        return plain
    return ""


def _allow_plaintext() -> bool:
    return str(os.environ.get(ALLOW_PLAINTEXT_ENV, "")).strip() == "1"


def save(home: Path, raw: str) -> dict:
    """校验并保存 Cookie，返回 ``{store, warning, masked, path}``。

    默认强制加密：Windows 上 DPAPI 失败就报错，而不是降级成明文。
    """
    cookie = normalize(raw)
    if not cookie:
        raise WhaleError("COOKIE_INVALID", "Cookie 为空")
    if not is_valid(cookie):
        raise WhaleError(
            "COOKIE_INVALID",
            "Cookie 不完整：需要包含 api-platform_serviceToken 与 userId",
        )

    cfg = config_mod.load(home)
    sealed = crypto.protect(cookie)
    warning = ""

    if sealed:
        cfg["cookieDpapi"] = sealed
        cfg["cookie"] = ""
        cfg["cookieStore"] = "dpapi"
    else:
        allowed = _allow_plaintext()
        if crypto.available() and not allowed:
            # Windows 上 DPAPI 失败属于异常情况：宁可不存，也不要明文落盘。
            raise WhaleError(
                "ENCRYPT_FAILED",
                "无法加密保存 Cookie（DPAPI 调用失败）。"
                f"如确认要明文保存，请设置环境变量 {ALLOW_PLAINTEXT_ENV}=1；"
                f"或改用环境变量 {ENV_NAME}（不落盘）。",
            )
        cfg["cookie"] = cookie
        cfg["cookieDpapi"] = ""
        cfg["cookieStore"] = "plain"
        warning = "forced-plaintext" if allowed else "no-dpapi"

    cfg["cookieUpdated"] = config_mod.now_iso()
    path = config_mod.save(home, cfg)
    return {
        "store": cfg["cookieStore"],
        "warning": warning,
        "masked": mask(cookie),
        "path": str(path),
    }


def clear(home: Path) -> dict:
    cfg = config_mod.load(home)
    cfg["cookie"] = ""
    cfg["cookieDpapi"] = ""
    cfg["cookieStore"] = "none"
    cfg["cookieUpdated"] = config_mod.now_iso()
    config_mod.save(home, cfg)
    return {"ok": True}


def _strip_secrets(path: Path) -> None:
    """把旧文件里的凭证字段抹掉，保留其余配置。

    只改名不清理的话，``*.bak`` 里仍然躺着明文 Cookie——等于没迁。
    """
    data = read_json(path, None)
    if not isinstance(data, dict):
        return
    changed = False
    for key in ("mimoCookie", "cookie", "mimoCookieProtected", "cookieDpapi"):
        if key in data:
            data.pop(key, None)
            changed = True
    if changed:
        try:
            write_json(path, data)
        except OSError:
            pass


def _retire(path: Path) -> Path:
    """把旧文件改名成 .bak，避免下次又被扫描到。"""
    backup = path.with_suffix(path.suffix + ".bak")
    try:
        path.replace(backup)
    except OSError:
        return path
    return backup


def migrate_legacy(home: Path, legacy_paths: list[Path]) -> dict | None:
    """把旧版 whale.config.json 里的 Cookie 迁到新配置；返回迁移结果。"""
    for path in legacy_paths:
        data = read_json(path, {})
        if not isinstance(data, dict):
            continue
        raw = normalize(str(data.get("mimoCookie") or data.get("cookie") or ""))
        if not is_valid(raw):
            continue
        if resolve(config_mod.load(home)):
            # 新配置里已有可用 Cookie：只清掉旧文件里的明文，不再迁移
            _strip_secrets(path)
            backup = _retire(path)
            return {"skipped": "already-configured", "from": str(path), "backup": str(backup)}
        result = save(home, raw)
        _strip_secrets(path)
        backup = _retire(path)
        return {**result, "from": str(path), "backup": str(backup)}
    return None
