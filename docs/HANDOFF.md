# 接手说明（给下一任维护者 / AI）

> 读这份文档的前提：你已经把仓库拉到本地，能跑 `setup.cmd -InstallDeps`，并且**真的点开过一次挂件**。
> 如果还没跑起来，先做第 8 节的验证，再回来看代码——这个项目里有一半的坑只有运行时才暴露。

---

## 1. 这是什么

一个 Windows 桌面挂件：右下角一只桌宠，实时显示 **Xiaomi MiMo 控制台的余额 / 套餐用量 / 本机会话 token 消耗**，
余额低于阈值会弹提示，支持主题、缩放、自定义贴图、开机自启。

它解决的是"看余额要开浏览器 → 登录 → 进控制台"这条路太长的问题。用户画像：自己一个人在用，
装了 MiMo 桌面端，能接受"粘一次 Cookie"。

**它不是**：账号工具、多账号管理、云端同步、跨平台应用。别往这些方向扩，见第 7 节。

---

## 2. 都是基于什么实现的

| 层 | 技术 | 为什么是它 |
|---|---|---|
| 外壳 | **Electron 37.10.3（精确锁定）** | 只有它能做"透明、置顶、无边框、可拖拽"的桌宠窗口 |
| 数据层 | **Python 3.9+，纯标准库** | MiMo 桌面端自带 Python 运行时，用户无需另装；标准库足够（urllib / sqlite3 / ctypes） |
| 数据源 | MiMo 控制台**非官方**接口 + 本地 `mimocode.db` | 没有官方 API；轨迹数据只有本地 SQLite 有 |
| 加密 | Windows **DPAPI**（`CryptProtectData`，ctypes 直调） | 不上第三方库，且密文绑定"本机 + 当前用户" |
| 安装/自启/打包 | **PowerShell 5.1** | Windows 自带，不需要额外运行时 |
| 启动器 | C#（`csc.exe` 编译，7~9 KB） | Windows 自带编译器，产物极小，能避免黑框和 `cmd` 的引号/编码坑 |
| 渲染层 | 原生 ESM + 原生 DOM，**无框架、无构建** | 见 6.1 |

**硬依赖（缺一个就跑不起来）**：

1. Windows 10/11；
2. **纯英文安装路径**（中文路径下 Electron 直接起不来，已实测，见 9.1）；
3. MiMo 桌面端（或任意 Python 3.9+）；
4. 一个有效 Cookie（`api-platform_serviceToken` + `userId`）。

---

## 3. 运行模型

```
┌─────────────────────────── Electron 主进程 (app/main.js) ───────────────────────────┐
│  paths 解析 → logger → settings → 单实例锁 → 窗口 → 托盘 → IPC 注册 → 数据层启动      │
│                                                                                     │
│   Brain（定时器）─────► Sidecar（Python 子进程，NDJSON over stdio）                  │
│   · probe 每 1.2s         · snapshot / refresh / configure / migrate                │
│   · refresh 按间隔        · 读 config.json、cache.json、ledger.json、mimocode.db     │
│   · 一轮结束/手动触发      · 写 cache.json、ledger.json、config.json                 │
└───────────────▲──────────────────────────────────────────────┬──────────────────────┘
                │ IPC（contextBridge 白名单）                     │ webContents.send
┌───────────────┴──────────────────────────────────────────────▼──────────────────────┐
│  渲染层 (app/src/js)：app.js 编排 → pet / panel / menu / toast / diagnostics / theme  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

关键点：

- **Python 是常驻 sidecar，不是每次查询 fork 一个进程。** 旧版是每 1.2 秒起一个 Python（0.5~1.2 秒/次），
  现在一次查询是毫秒级。**不要退回"每次 spawn"的写法**，见 7.10。
- **渲染层不直接碰 Node/Electron API。** 只有 `app/preload.js` 里白名单过的通道能过桥，`contextIsolation: true`、`sandbox: true`。
- **单实例锁**：第二次启动会立即退出（这是为什么双击"看起来没反应"时优先查单实例，见 9.4）。

---

## 4. 数据在哪 / 谁写

| 路径 | 内容 | 唯一写入者 |
|---|---|---|
| `%APPDATA%\MiMoWhale\config.json` | Cookie（加密）、Python 路径、刷新间隔 | **Python** |
| `%APPDATA%\MiMoWhale\settings.json` | 缩放、主题、预设、自定义贴图名、显示开关 | **Electron 主进程** |
| `%APPDATA%\MiMoWhale\cache.json` | 最近一次快照（离线兜底） | **Python** |
| `%APPDATA%\MiMoWhale\ledger.json` | 按"余额差值"估算的每日消耗 | **Python** |
| `%APPDATA%\MiMoWhale\autostart.json` | 自启状态 | **PowerShell** |
| `%APPDATA%\MiMoWhale\pet-path.txt` / `pet-paths.json` | 程序位置指针（搬目录后自愈用） | **Electron 主进程** |
| `%APPDATA%\MiMoWhale\logs\app.log` | 日志（1 MB 滚动，出口统一脱敏） | **Electron 主进程** |
| `%APPDATA%\MiMoBalanceWidget\` | Chromium profile（GPU 缓存、Local Storage） | Chromium |
| `%APPDATA%\MiMoWhale\pets\custom.png` | 自定义贴图（只存文件名，不存绝对路径） | 主进程 |
| `%LOCALAPPDATA%\electron\Cache\` | Electron 运行时 zip 缓存（`-ForceRepair` 用） | npm |

**规则：一个文件只有一个写者。** 跨语言同时写会丢数据、也会写出带 BOM 的 JSON 把 Node 的 `JSON.parse` 弄崩。
要加新字段，加在拥有者那一侧，另一侧只读。

数据目录可被 `MIMO_WHALE_HOME` 覆盖（便携/U 盘模式），解析优先级：`--home` > `MIMO_WHALE_HOME` > `%APPDATA%\MiMoWhale`。

---

## 5. 代码地图（改什么去哪）

| 想做 | 去改 |
|---|---|
| 加一个界面元素 / 交互 | `app/src/index.html` + `app/src/js/*.js` + `app/src/styles/*.css` |
| 加一个主进程能力 | `app/lib/ipc.js`（handler）+ `app/preload.js`（白名单）+ 渲染层调用 |
| 改数据字段 | `python/whale/summary.py`（**同时改 SCHEMA**）+ `docs/ARCHITECTURE.md` 的示例 |
| 改接口解析 | `python/whale/api.py` |
| 改本地库查询 | `python/whale/sessions.py`（注意它没有索引，查询要带 `session_id`） |
| 改加密/凭据 | `python/whale/credentials.py` + `crypto.py` |
| 改安装/自启/打包 | `setup.ps1` / `scripts/*.ps1` / `scripts/build-launcher.ps1` |
| 改启动器行为 | `scripts/launcher/Program.cs` |

模块职责：

- `app/main.js`：只做编排（启动顺序、窗口、托盘、IPC 注册、退出清理）。**不要把业务写进这里**，它曾经是 800 行的 God file。
- `app/lib/brain.js`：所有"什么时候刷新"的策略（定时、退避、暂停、恢复），不含 HTTP。
- `app/lib/sidecar.js`：NDJSON 协议、超时、崩溃重启（最多 3 次）。
- `app/lib/window.js`：透明窗口、拖拽、边缘吸附、屏幕外归位、显示重建。
- `python/whale/summary.py`：快照组装 + 缓存 + 部分失败容错。**这里是 schema 的唯一来源。**

---

## 6. 为什么有些代码"看起来该改"但其实不能改

### 6.1 渲染层没有框架、没有构建

约 700 行、10 个模块。引 Preact/TS 的收益是"以后好维护"，代价是：加构建步骤（离线环境与 CI 都要重建）、
改 CSP、把 `contextBridge` 边界重新设计一遍。**触发条件**：出现第三个模块消费同一份状态，
或单个模块超过 500 行——那时引入一个 30 行的 `createStore(get/set/subscribe)`，仍然不引框架。

### 6.2 Electron 锁死在 37.10.3

- 37 的 npm 包带 `postinstall: node install.js`，装完 `dist` 就直接在，`setup.ps1` 的完整性校验能过；
- **44 改成了懒下载**（`index.js` 里 `downloadElectron()`），`npm install` 后没有 `dist`，
  安装流程、打包脚本、启动器都要跟着改；
- 精确锁版本 + `package-lock.json` 是为了"同一份代码在任何机器上装出同样的运行时"。

升级前必须一起改：`setup.ps1` 的安装逻辑、`scripts/package-release.ps1`、`scripts/launcher/Program.cs`、
`test/structure.test.js` 的断言；并且**在真机上点一次**。

### 6.3 `.cmd` 必须是纯 ASCII

cmd.exe 用系统代码页（GBK）读 `.cmd`，文件里含 UTF-8 中文时会**字节错位**：`rem` 前缀和 `%VAR%` 被截断，
残片被当成命令执行（真实事故：`'ECTRON' 不是内部或外部命令`）。所有对外文案放 PowerShell 里，
`.cmd` 只做转发。`scripts/check-syntax.js` 有守卫。

### 6.4 `.ps1` 必须 UTF-8 **带 BOM**

PowerShell 5.1 读无 BOM 的 UTF-8 会按 ANSI 解码，中文注释/字符串会破坏语法（真实事故：`Missing closing '}'`）。
反过来，**给 Node/Python 读的 JSON 和指针文件必须无 BOM**，否则 `JSON.parse` 直接失败。
`check-syntax.js` 同时守着这两条。

### 6.5 `app.setPath('userData', …MiMoBalanceWidget)`

`productName` 是中文（"MiMo 余额挂件"），默认 userData 会变成 `%APPDATA%\MiMo 余额挂件`——
又是一个 Chromium 不喜欢的非 ASCII 路径。这行看着多余，删了会在部分机器上白屏/闪退。

### 6.6 源码里不许出现盘符绝对路径

所有资源都从 `__dirname` / `$PSScriptRoot` / `__file__` 推。`test/portability.test.js` 会 fail，
连注释里的示例路径都算违规（我写文档时被自己的守卫抓过两次）。

### 6.7 日志出口统一脱敏

`app/lib/logger.js` 的 `redact()` 在写盘前擦掉 `api-platform_serviceToken=…` 和 `Cookie: …`。
不要"顺手"在某个模块里 `console.log(cookie)`——日志会被贴进 issue。

### 6.8 刷新间隔在 Python 侧，主进程回读

`refreshSeconds` 属于 `config.json`（Python 写）。主进程每 30 秒回读一次并同步给 Brain，
`whale configure` 改完不用重启。不要在 Electron 侧再存一份——那会变成两个真相。

### 6.9 `window-all-closed` 不退出

托盘常驻应用：窗口被意外销毁时进程要活着，托盘点一下会重建窗口（`windowController.recreate()`）。
在这里 `app.quit()` 会让"托盘还在、点了没反应"。

### 6.10 Python 是常驻 sidecar

`app/lib/sidecar.js` 负责一遍遍重启（最多 3 次）+ 超时 + 请求关联。**不要在 IPC handler 里
自己 `spawn` Python**：每次启动约 200~500 ms，probe 每 1.2 秒一次，会直接把风扇吹起来。

---

## 7. 红线（动了就出事，且往往不是立刻出事）

| # | 不要 | 原因 | 替代做法 |
|---|---|---|---|
| 1 | 引入前端框架 / 构建步骤 | 离线、CSP、CI 都要跟着改 | 见 6.1 的触发条件 |
| 2 | 升级 Electron 大版本 | 安装流程/打包/启动器全变 | 见 6.2，一个 PR 全改完再上 |
| 3 | 在 `.cmd` 里写中文 | GBK 错位，命令被截断 | 文案放 `.ps1`，`.cmd` 只转发 |
| 4 | 让 `.ps1` 丢掉 BOM | PS 5.1 语法错误 | 编辑器设 UTF-8 with BOM；lint 会拦 |
| 5 | 给 `config.json`/`settings.json` 写 BOM | Node `JSON.parse` 崩 | 一律无 BOM 写，读侧剥 BOM |
| 6 | 改 `userData` 路径 | 中文 profile 会白屏 | 保持 `MiMoBalanceWidget` |
| 7 | 在源码里写 `C:\…` | 换机/换盘即坏 | `__dirname` / `$PSScriptRoot` / `__file__` |
| 8 | 把 Cookie 落明文 | 用户机器被拷走即泄露 | DPAPI；确实要明文需显式 `MIMO_WHALE_ALLOW_PLAINTEXT=1` |
| 9 | 在日志里打印 Cookie/完整 URL 带参 | 会被贴进 issue | 用 `logger`，出口有 `redact()` |
| 10 | 每查询 spawn 一次 Python | 性能回退 100 倍 | 用现有 sidecar 通道 |
| 11 | 删掉单实例锁 | 两只桌宠、两套定时器抢着写缓存 | 保留 |
| 12 | 让两个进程写同一个 JSON | 数据丢失、编码互相污染 | 见第 4 节的"唯一写者" |
| 13 | 把 `customImage` 存成绝对路径 | 数据目录搬移后贴图消失 | 只存文件名，读取时拼 `petsDir` |
| 14 | 在 `window-all-closed` 里 `app.quit()` | 托盘变摆设 | 只记日志，退出交给托盘菜单 |
| 15 | 用 `innerHTML` 拼界面 | XSS 面 + CSP 风险 | `textContent` / `el()` |
| 16 | 用 `!important` 压样式 | 主题切换会打架 | 唯一例外是 `[hidden]` |
| 17 | 把"查不到"显示成"没有" | 余额 0 / 未开通会误导用户 | 用 `error` 字段区分（见 `API_SHAPE`、`SCHEMA_MISMATCH`） |

---

## 8. 怎么验证（每次改完都要跑）

### 8.1 机器化

```bat
npm run lint        :: 语法 + 编码守卫（PS1 必带 BOM、CMD 必纯 ASCII、无盘符绝对路径）
npm test            :: Node 单测（node --test 自动发现 test/*.test.js）
npm run test:py     :: Python 单测（75 个用例）
npm run smoke       :: 真启动一次 Electron：窗口、渲染层、preload、DOM，**以及菜单能不能打开**
```

`npm run smoke` 的报告写在 `%APPDATA%\MiMoWhale\smoke-report.json`，要求 `"ok": true`。
它会真的点一下 ☰ 并断言 `#menu` 从 hidden 变成可见——**`menuOpens: false` 就是在告诉你事件没接上**。

> 如果 `npm test` 在受限环境（CI 容器、沙箱）里因为子进程管道被禁而失败，可以退化成逐个跑：
> ```powershell
> Get-ChildItem test\*.test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE) { throw $_ } }
> ```

### 8.2 人工（每周或大改后）

自动化测不到"看起来对不对"，这十分钟别省：

1. 悬停桌宠 → 右上角出现 ☰ → 点开设置；
2. 切三个预设、改缩放、切深色/浅色 → 桌宠立刻变；
3. 粘一次 Cookie → 保存 → 看提示是 `刷新完成（时间）` 还是具体错误；
4. 拖动桌宠到屏幕边缘 → 吸附；拖到另一块屏 → 不跑丢；
5. 关掉再开 → 位置、主题、预设都还在；
6. 托盘图标右键 → 显示/隐藏、退出都有效。

### 8.3 出问题看哪里

```
%APPDATA%\MiMoWhale\logs\app.log          ← 主进程日志（含渲染层异常、CSP 拦截）
%APPDATA%\MiMoWhale\smoke-report.json      ← smoke 的结构化结果
%APPDATA%\MiMoWhale\cache.json             ← 上一次成功的数据，能看出是"没数据"还是"没刷新"
MiMoBalanceWidget.exe --check              ← 启动器探测：找到哪个 electron、有没有在跑
MiMoBalanceWidget.exe --trace              ← 不弹窗，把启动过程写进 launcher-trace.log
```

---

## 9. 已知限制（诚实清单，不是 todo）

### 9.1 中文路径必挂（已实测）

同一份 Electron：`C:\...\小爱同学的工作区\...` 下进程直接退出、连 `app.log` 都不写；
`C:\MiMoTest` 下 `"ok": true`。已加三层提示（README / setup 前置检查 / 启动器弹窗），
但**没有从根上解决**——那是 Chromium 的行为。所以：安装路径必须纯英文。

### 9.2 Cookie 会过期

接口是非官方的，401/403 就报 `COOKIE_INVALID`。用户要重新粘。
**别把"失效"显示成"余额 0"**（见红线 17）。

### 9.3 账本是估算

用"余额差值"推每日消耗：退款、赠金到账/过期都会被算进去。界面上有 `≈` 和 tooltip。
真要精确账单，得从接口拿流水，目前没有。

### 9.4 "双击没反应"的排查顺序

1. 目录含中文 → 移走；
2. 已经有一个实例在跑 → 托盘里找（双击会弹"已经在运行"）；
3. 缺 Electron 运行时 → 启动器会弹窗并可直接装；
4. 渲染层报错 → 看 `app.log` 里的 `renderer.error`。

### 9.5 未签名

`MiMoBalanceWidget.exe` 没有代码签名，首次运行可能弹 SmartScreen → "更多信息 → 仍要运行"。
真安装包（开始菜单/卸载/自动更新）需要 `electron-builder` + NSIS + 证书，是另一套分发模型。

### 9.6 只在 Windows / 只在单机

macOS/Linux 完全跑不了（PowerShell + DPAPI + `.lnk`）。移植工作量在"外壳"，不在数据层。

### 9.7 依赖非官方接口

字段改名会报 `API_SHAPE`，轨迹格式变化会报 `SCHEMA_MISMATCH`。这是**故意**的：
宁可报错，也不要静默显示 0。

---

## 10. 第一天怎么上手

1. 在纯英文路径跑 `setup.cmd -InstallDeps` → `npm run smoke`，确认 `"ok": true`；
2. 按 8.2 点一遍；
3. 读这三份：`docs/ARCHITECTURE.md`（结构）、`CHANGELOG.md`（为什么长这样，含历次评审的取舍）、`SECURITY.md`（威胁模型）；
4. 挑一个"已知限制"里的小项动手（比如加一个 `≈` 标注、补一条测试），别一上来重构；
5. 改完必须：`check-syntax` + `node --test` + `python -m unittest` + `npm run smoke` 全绿，
   并在 PR 里写清"影响了哪些约定"。

---

## 11. 坑速查

| 现象 | 真实原因 |
|---|---|
| `'ECTRON' 不是内部或外部命令` | `.cmd` 里有中文，GBK 解析错位 |
| `Missing closing '}'`（PS） | `.ps1` 丢了 BOM |
| `JSON.parse` 报错 | 某个进程给 JSON 写了 BOM |
| 双击 exe 没反应 | 目录含中文 / 已有实例 / 缺运行时 / 渲染层报错 |
| 白屏但进程在 | 渲染层模块 import 失败（曾有 `clear` 漏导出），看 `app.log` |
| 菜单打不开 | 事件没绑（曾有 ☰ 按钮没监听）；`smoke` 的 `menuOpens` 会报 |
| 改了 `refreshSeconds` 不生效 | 主进程 30 秒后才回读 `config.json` |
| 移植到别的盘后贴图不见 | `customImage` 被写成了绝对路径 |
| 打包后启动即退出 | `node_modules\electron\dist` 不完整（用 `-ForceRepair`） |
| 变量赋值报"无法覆盖" | `$home` / `$args` 是 PowerShell 只读/自动变量，换名字 |
