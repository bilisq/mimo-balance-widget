---
name: mimo-balance-whale
description: 查询小米 MiMo 账户余额、Token Plan、今日/近 7 日消耗，以及本地会话的 token 用量与缓存命中。用户问 MiMo 余额、额度、花了多少钱、token 用量时使用；不适用于其他厂商。
---

# MiMo 余额

安装挂件时会生成一个命令行入口（不需要把 Python 加进 PATH）：

```text
%APPDATA%\MiMoWhale\bin\whale.cmd summary     # 纯文本报告（默认联网刷新）
%APPDATA%\MiMoWhale\bin\whale.cmd json        # 完整 JSON
%APPDATA%\MiMoWhale\bin\whale.cmd snapshot    # 只读缓存，不联网
%APPDATA%\MiMoWhale\bin\whale.cmd diagnose    # 排障信息（Cookie 已脱敏）
```

如果安装时设过 `MIMO_WHALE_HOME`，把 `%APPDATA%\MiMoWhale` 换成那个目录。

## 数据来源与限制

- **余额 / 套餐**：`platform.xiaomimimo.com` 的非官方控制台接口，需要登录 Cookie；
- **今日 / 近 7 天消耗**：按余额差值估算，充值会被排除，仅作参考；
- **会话 token**：只读打开 MiMo 本地 `mimocode.db` 统计 `step-finish` 记录；
- 缓存命中率 = `cache.read / (cache.read + input)`。

## 注意

- 回答用户时**不要粘贴 Cookie**；
- 命令失败会返回 `{"ok": false, "error": {"code": ..., "message": ...}}`，
  其中 `COOKIE_INVALID` 表示需要重新登录控制台复制 Cookie。
