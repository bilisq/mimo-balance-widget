# 架构说明

## 进程模型

```text
┌────────────────────────────── Electron 主进程 (app/main.js) ──────────────────────────────┐
│  paths  settings  logger  window  tray  ipc  autostart                                     │
│         │            │        │       │                                                  │
│         │            └── settings.json（界面偏好，唯一写入方）                              │
│         │                                                                                 │
│         ├── Sidecar 客户端（NDJSON over stdio） ──► python -m whale.sidecar（常驻）         │
│         │                                              │                                   │
│         └── Brain（调度）                                ├── config.json（Cookie，唯一写入方）│
│                                                        ├── cache.json / ledger.json        │
│                                                        └── 只读 mimocode.db               │
└──────────────────────────────┬────────────────────────────────────────────────────────────┘
                               │ IPC（contextBridge 白名单）
┌──────────────────────────────▼────────────────────────────────────────────────────────────┐
│ 渲染层（app/src）：pet / panel / menu / toast / diagnostics，全部原生 DOM，无框架           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

三个进程各自只做一件事：渲染层画界面、主进程管窗口与调度、Python 管数据。
三者之间只有两条边界：`contextBridge` 白名单 + NDJSON 协议。

## 为什么数据层要用常驻进程

旧版（MiMoWhale-Widget）的做法是"每次查询 `spawn` 一个 Python 进程"。实测一次调用要
0.5~1.2 秒（解释器启动 + import），而挂件需要秒级探针判断"这一轮结束了没有"。
结果是每秒都在启动进程，CPU 常驻占用。

0.1.0 改成**一个常驻进程 + 一问一答**：

- 查询耗时从几百毫秒降到几毫秒；
- 进程崩溃时按 1s / 2s / 5s 退避重启，最多 3 次，用尽后界面提示"运行 setup.cmd"；
- 单条命令失败只返回错误，不会杀掉服务。

## NDJSON 协议

每行一个 JSON 对象，UTF-8，无 BOM：

```text
→ {"id":1,"cmd":"probe","args":{"session":null}}
← {"id":1,"ok":true,"data":{...}}
← {"id":1,"ok":false,"error":{"code":"NO_DB","message":"找不到会话库"}}
```

启动后先输出 `{"event":"ready","version":"0.1.0","pid":1234}`。
命令表：`ping` `snapshot` `refresh` `set-cookie` `sessions` `session` `turn` `probe` `pending` `diagnose` `shutdown`。

**为什么强制 UTF-8**：旧版在 Windows 上把 Python 的 stdout 当 UTF-8 读，但管道下
Python 默认用 GBK，导致中文错误信息乱码，`summary` 甚至因为 `¥` 无法用 GBK 编码直接崩溃。
现在 sidecar 用 `stdout.buffer` 写 UTF-8 字节，CLI 用 `sys.stdout.reconfigure(encoding="utf-8")`，
主进程也设置 `PYTHONUTF8=1 / PYTHONIOENCODING=utf-8`，三层同时兜底。

## 快照结构（schema 2）

`snapshot` / `refresh` 返回同一形状，渲染层不需要区分来源：

```jsonc
{
  "schema": 2,
  "ok": true,
  "source": "api",            // api | cache | none
  "stale": false,             // 缓存超过 2 个刷新周期 → true
  "cacheAgeSeconds": 0,
  "error": null,              // { code, message } | null
  "balance":  { "amount": 12.5, "cash": 10, "gift": 2.5, "currency": "CNY", "queriedAt": "..." },
  "tokenPlan":{ "hasPlan": true, "planCode": "lite", "percent": 15.6, "used": 641104384,
                "limit": 4100000000, "periodEnd": "2026-11-18 23:59:59", "expired": false },
  "ledger":   { "today": 0.0, "week7": 0.0, "days": {}, "updated": "..." },
  "sessionTokens": { "ok": true, "sessionId": "...", "steps": 151,
                     "tokens": { "billed": 0, "input": 0, "output": 0, "reasoning": 0, "contextLast": 0 },
                     "cache": { "read": 0, "write": 0, "hitRate": 98.4 }, "cost": 0 },
  "lastTurn":  { "ok": true, "turn": 15, "steps": 7, "tokPerSec": 70.8, "billed": 7960,
                 "output": 1922, "cost": 0, "endedAt": 1792372267557 },
  "alertConfig": { "ok": true, "enabled": true, "threshold": 5 },
  "generatedAt": "2026-10-19T12:00:00+08:00",
  "refreshSeconds": 60
}
```

改动字段必须同时改三处：`python/whale/__init__.py` 的 `SCHEMA`、`summary.py` 的 `SCHEMA`、
本文档。`test/structure.test.js` 会检查前两处是否一致。

## 调度（app/lib/brain.js）

| 动作 | 触发 | 是否联网 |
|---|---|---|
| `probe` | 每 1.2 s | 否（只读本地 SQLite） |
| `snapshot` | 步骤数变化、面板打开、启动 | 否（缓存 + 现算本地数据） |
| `refresh` | 启动、每 `refreshSeconds`、一轮结束、手动 | 是 |

`refreshSeconds` 存在 Python 的 `config.json` 里，主进程每 30 秒回读一次并同步给 Brain，
所以用 `whale configure` 改完**不用重启**就生效。

失败处理：

- 网络类错误 → 指数退避（30s 起，上限 5 分钟），界面显示缓存数据；
- `COOKIE_INVALID` / `NO_COOKIE` → 暂停自动刷新，等用户重新保存 Cookie；
- 会话库异常 → 只影响 `sessionTokens` 字段（`ok:false`），不影响余额。

## 文件归属

| 文件 | 唯一写入方 | 说明 |
|---|---|---|
| `config.json` | Python | 两个写入方会互相覆盖，所以 Electron 只读 |
| `settings.json` | Electron | Python 从不写它 |
| `cache.json` / `ledger.json` | Python | 原子写（临时文件 + `os.replace`） |
| `autostart.json` | PowerShell | Node 只读，避免状态漂移；**不写 BOM**（Node 的 JSON.parse 不认 BOM） |
| `pet-path.txt` / `pet-paths.json` | Electron | 安装位置指针与历史，供引导脚本定位程序 |
| `bin\whale.cmd` | `setup.ps1` | 生成物；内部路径运行时解析，改目录后不会失效 |

## 可移植性

三条规则，代码里有测试守着（`test/portability.test.js` 扫描盘符字面量）：

1. **程序资源一律相对解析**：主进程用 `path.resolve(__dirname, '..')`，Python 用
   `Path(__file__).resolve().parents[2]`，PowerShell 用 `$PSScriptRoot`。
   源码里不允许出现 `C:\...` 这类字面量。
2. **本机状态一律运行时探测**：数据目录来自 `MIMO_WHALE_HOME` / `%APPDATA%`；
   Python 解释器来自 `config.json` → 环境变量 → MiMo 自带 → `PATH`，
   并且 `config.json` 里的路径**必须先校验存在**，否则换机器后会拿着一个不存在的 exe 去启动。
3. **绝对路径只许出现在"可再生的生成物"里，且要能自愈**：

```text
启动一次挂件
   ├─ 写 pet-path.txt（单点指针）
   ├─ 写 pet-paths.json（最近 8 个位置）
   └─ 若 config.json 里的 Python 失效 → 用探测到的路径回写（sidecar: configure）
```

开机引导 `bootstrap.ps1` 按 `已记录路径 → 位置历史 → 指针` 依次尝试，全部失效才安静退出；
命令行入口 `whale.ps1` 同样先读指针与配置，最后才用安装时写入的兜底值。
两者都用 `[System.IO.File]::Exists` 而不是 `Join-Path`/`Test-Path`——候选路径可能指向
已经不存在的盘符，`Join-Path` 会直接抛异常。

## 渲染层

- **无框架**：只有六个模块（pet / panel / menu / toast / diagnostics / idle）+ 三个工具（dom / theme / api），
  总行数比旧版的单文件少一半，且没有全局状态散落——所有状态集中在 `app.js` 的 `ctx`。
- **无 `innerHTML`**：提示气泡和面板都用 `textContent` / `el()` 构建，DB 里的文本不会变成 HTML。
- **样式无 `!important`**：主题与皮肤全部通过 CSS 变量切换（`data-theme` / `data-preset`），
  组件只引用变量。唯一的 `!important` 留给 `[hidden]`。
- **几何单一来源**：`app/shared/geometry.js` 同时被主进程（吸附计算）和渲染层（尺寸变量）使用。

## 安全基线

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，渲染层只能看到 preload 暴露的具名方法；
- CSP 禁止 inline script / eval，`img-src` 只允许本地与 data URL；
- Cookie 只走 stdin 传给 Python（不出现在命令行参数里），落盘优先 DPAPI 加密；
- 诊断信息里的 Cookie 永远脱敏；
- 所有 IPC 入参过 `validate.js`，只接受白名单字段。
