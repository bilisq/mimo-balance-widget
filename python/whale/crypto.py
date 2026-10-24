"""Windows DPAPI 加解密（当前用户作用域）。

只在 Windows 上可用；其它平台返回 None，调用方回落到明文存储并给出提示。
不引入 pywin32，直接用 ctypes 调 crypt32。
"""

from __future__ import annotations

import base64
import ctypes
import ctypes.wintypes as wintypes
import sys

_CRYPTPROTECT_UI_FORBIDDEN = 0x01


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def available() -> bool:
    return sys.platform == "win32"


def _blob(data: bytes):
    """构造 DATA_BLOB；返回 (blob, buffer)，buffer 必须保持存活。"""
    buffer = ctypes.create_string_buffer(data, len(data))
    blob = _DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    return blob, buffer


def protect(plain: str) -> str | None:
    """加密并返回 base64；失败返回 None。"""
    if not available() or not plain:
        return None
    try:
        data = plain.encode("utf-8")
        blob_in, _keep = _blob(data)
        blob_out = _DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            _CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
        if not ok:
            return None
        try:
            raw = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
        return base64.b64encode(raw).decode("ascii")
    except Exception:  # noqa: BLE001 - 加密失败不该让保存流程崩溃
        return None


def unprotect(encoded: str) -> str | None:
    """解密 base64 密文；失败返回 None。"""
    if not available() or not encoded:
        return None
    try:
        data = base64.b64decode(encoded)
        if not data:
            return None
        blob_in, _keep = _blob(data)
        blob_out = _DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            _CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
        if not ok:
            return None
        try:
            raw = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
        return raw.decode("utf-8")
    except Exception:  # noqa: BLE001
        return None
