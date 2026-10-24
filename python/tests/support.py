"""测试小工具：临时目录。

不用 ``tempfile.TemporaryDirectory``：
1. 它在退出时强制删除目录，某些受限环境（企业策略 / 沙箱）会拒绝删除；
2. 它用 ``mkdtemp`` 以 0700 权限建目录，个别托管环境里子进程会写不进去。

这里自己用 ``mkdir`` 建普通权限目录，退出时"尽力清理"。
"""

from __future__ import annotations

import atexit
import shutil
import tempfile
import uuid
from pathlib import Path


def temp_dir(prefix: str = "whale-test-") -> Path:
    path = Path(tempfile.gettempdir()) / f"{prefix}{uuid.uuid4().hex[:8]}"
    path.mkdir(parents=True, exist_ok=True)
    atexit.register(lambda: shutil.rmtree(path, ignore_errors=True))
    return path
