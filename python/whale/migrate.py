"""从旧版目录结构迁移数据。

旧版把文件散落在 `%APPDATA%\\MiMoWhale\\whale.config.json` 和安装包根目录，
新版统一为数据目录下的 `config.json` / `ledger.json`。这里做一次性搬运：

- Cookie：写入新配置（优先 DPAPI），旧文件改名成 `.bak`，不删除；
- 账本：旧名字 `whale.ledger.json` → `ledger.json`（仅当新文件不存在）；
- 缓存：不迁移（结构变了，重新联网刷新即可）。
"""

from __future__ import annotations

import shutil
from pathlib import Path

from . import credentials, paths


def run(home: Path, root: Path | None = None) -> dict:
    paths.ensure_home(home)
    legacy = paths.legacy_files(home, root)
    result = {"cookie": None, "ledger": None, "legacy": [str(item) for item in legacy]}

    cookie_result = credentials.migrate_legacy(home, legacy)
    if cookie_result:
        result["cookie"] = cookie_result

    target = paths.ledger_file(home)
    if not target.exists():
        for source in legacy:
            if source.name != "whale.ledger.json":
                continue
            try:
                shutil.copyfile(source, target)
                result["ledger"] = {"from": str(source), "to": str(target)}
            except OSError:
                pass
            break

    return result
