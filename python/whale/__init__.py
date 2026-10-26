"""MiMo 余额挂件 · 数据层。

纯标准库实现，无第三方依赖。两个入口：

    python -m whale.cli <command>     # 命令行（人看 / 脚本 / MiMo 技能调用）
    python -m whale.sidecar           # NDJSON 常驻服务（由 Electron 主进程拉起）

数据目录优先级：``--home`` 参数 > 环境变量 ``MIMO_WHALE_HOME`` > 平台默认目录。
"""

__version__ = "0.1.1"

# 缓存 / 快照结构版本，与 Electron 渲染层约定的契约版本。
# 改动快照字段时必须同时 bump 这里和 docs/ARCHITECTURE.md。
SCHEMA = 2
