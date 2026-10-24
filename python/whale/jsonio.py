"""JSON 读写：原子写 + 容错读。

配置、缓存、账本都是"随时可能被中断"的小文件，直接 ``write_text`` 一旦
在写入过程中崩溃就会留下半个文件。这里统一走 临时文件 + ``os.replace``。
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def read_json(path: str | Path, default: Any = None) -> Any:
    """读 JSON；文件不存在 / 内容损坏时返回 default（不抛异常）。"""
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path: str | Path, obj: Any) -> Path:
    """原子写入 JSON（同目录临时文件 + replace）。返回写入路径。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return target
