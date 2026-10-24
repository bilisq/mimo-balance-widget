# MiMo 余额挂件

透明置顶的 **MiMo 账户桌宠**：余额、Token Plan、今日 / 近 7 日消耗、会话 Tokens、缓存命中、低余额提醒。
点一下说话，拖到屏幕边缘会自动吸附。

> **非小米官方产品。** 通过 MiMo 网页控制台的 Cookie 调用内部接口，接口可能随时变更或失效，使用风险自负。

> English: a transparent always-on-top desktop widget for the MiMo (Xiaomi) console —
> balance, token plan, local session usage and cache-hit rate. Windows 10/11,
> Electron + a small Python data layer (standard library only). Not affiliated with Xiaomi.
> A portable release with the Electron runtime bundled is provided, so end users do not need Node.js.

---

## 界面

| 桌宠 | 余额面板 | 设置 |
|---|---|---|
| 三个预设皮肤：小米姬 / 小爱同学 / 大肥鱼，也支持自定义 PNG | 余额、现金/赠送、套餐进度、今日/7 天消耗、会话用量 | 缩放、主题、台词、气泡配色、Cookie、会话锁定、开机自启 |

<!-- 欢迎在 PR 里补一张真实截图：![screenshot](docs/screenshot.png) -->

## 特性

- **余额 / Token Plan / 今日与近 7 日消耗**，接口失败自动回落到上一次缓存并标注"缓存数据"
- **会话 Tokens、缓存命中率、上下文长度、tok/s**，数据只读自 MiMo 本地轨迹库
- **回合结束提示**：一轮结束时弹出本轮花费与速度；等待回答 / 授权时显示常驻提示
- **三种皮肤 + 自定义贴图**，浅深色跟随 MiMo 桌面端主题（也可手动锁定）
- **低余额预警**：默认跟随官方阈值，可改成自己的数字
- **边缘吸附、位置记忆、开机自启**（检测到 MiMo 桌面端后再启动）
- **手工检查更新**：设置面板里一个按钮，点了才请求 GitHub，发现新版本直接打开发布页
- **纯标准库数据层**：没有 `requests` / `pandas` 之类第三方依赖，Python 3.9+ 即可

## 平台支持

**目前只支持 Windows 10 / 11。** 原因不是懒，而是依赖面：

| 依赖 | 说明 |
|---|---|
| MiMo 桌面端 | 数据源（余额接口的 Cookie、本地 `mimocode.db`）本身就是 Windows 客户端 |
| DPAPI | Cookie 加密用的 `CryptProtectData`，Windows 专有；macOS 对应 Keychain |
| PowerShell | 安装、自启、打包脚本全在这套里（约 500 行） |
| `.lnk` 自启 | macOS 要换成 LaunchAgent，Linux 要换成 `.desktop` |

数据层本身是跨平台的（已用 `crypto.available()` 做分支、按 XDG/APPDATA 选目录），
所以真要移植，工作量集中在**外壳**（脚本 500 行 + 窗口行为 + 打包），而不是业务逻辑。
在 MiMo 官方没有 macOS 客户端之前，做这件事收益不大，因此暂不排期。

## 两种安装方式

> 本项目的安装脚本**不会**替你安装 Node.js。缺少运行时的时候它只做检查，并告诉你下一步怎么做。

### 方式 A：下载便携包（普通用户，推荐）

到 [Releases](../../releases/latest) 下载 `MiMo-Balance-Widget-<版本>-win-x64.zip`，解压后双击 **`MiMoBalanceWidget.exe`**（或 `start.cmd`）。

- 自带 Electron 运行时（约 317 MB），**不需要 Node.js、不需要联网**；
- 建议解压到固定位置（例如 `D:\Apps\MiMo-Balance-Widget`），移动目录后挂件会自愈自启快捷方式。

#### 关于 `MiMoBalanceWidget.exe`

它是个 **7 KB 的启动器**，只做三件事：找到同目录的 `node_modules\electron\dist\electron.exe` → 用正确参数启动 → 找不到时提示并引导安装。相比 `start.cmd`：

- 不闪黑框（GUI 子系统，不是控制台程序）；
- 会清掉环境里可能残留的 `ELECTRON_RUN_AS_NODE`（它会让 Electron 退化成 Node）；
- 可以在任意位置双击，不依赖当前目录。

**它不是单文件应用**，仍然需要旁边的 `node_modules`（便携包里自带）。
源码在 [`scripts/launcher/Program.cs`](scripts/launcher/Program.cs)（约 100 行，不联网），
可以自己重建、自己审：

```bat
powershell -ExecutionPolicy Bypass -File scripts\build-launcher.ps1
```

> 想要**真正的安装包**（开始菜单、卸载项、自动更新）需要换用 `electron-builder` + NSIS，
> 并给 exe 做代码签名；那是另一套分发模型，本项目暂不采用。

### 方式 B：从源码运行（开发者）

```bat
:: 1. 先安装 Node.js 18+（只用于下载 Electron，装完就不再需要）
::    https://nodejs.org/zh-cn/download

:: 2. 拉取代码后安装运行时
setup.cmd -InstallDeps

:: 3. 启动
start.cmd
```

`setup.cmd -InstallDeps` 会用 npm 下载 Electron（自动尝试国内镜像），并校验文件是否完整。

### 环境要求

> ⚠️ **仅支持 Windows 10 / 11。** macOS 与 Linux 完全无法运行（安装/自启/打包脚本是 PowerShell，
> Cookie 加密用 Windows DPAPI）。移植评估见上面的「平台支持」。
>
> ⚠️ **安装路径必须是纯英文**，例如 `D:\Apps\MiMo-Balance-Widget`。
> 放在中文目录（如 `C:\Users\你\桌面\小爱同学的工作区\...`）时，有反馈出现**双击闪退、窗口不出现**。

| 项目 | 方式 A（便携包） | 方式 B（源码） |
|---|---|---|
| 系统 | **Windows 10 / 11（唯一支持）** | 同左 |
| 安装路径 | **纯英文，不含中文/日文/emoji** | 同左 |
| Node.js | **不需要** | 18+（仅安装时需要） |
| Python | 3.9+，或安装 MiMo 桌面端（自带运行时） | 同左 |

没有 Python 也能启动挂件：余额区会提示原因，桌宠本体、设置、皮肤都正常。

#### 为什么不能放在中文目录

Electron 本质是一份 Chromium。Chromium 在 Windows 上有一部分子系统（GPU 缓存、
Crashpad、日志、`--app-path` 解析）对非 ASCII 路径的处理不完整，已知在部分环境会
**直接闪退且不报错**——现象就是"双击了，什么都没发生"。

0.1.0 做了两层防护，尽量减少这类问题：

1. **Chromium 的 profile 固定到 ASCII 目录**：`%APPDATA%\MiMoBalanceWidget`
   （不再跟着中文 `productName` 变成 `%APPDATA%\MiMo 余额挂件`）；
2. **启动时检测安装路径**：含非 ASCII 就写一条 `app.non-ascii-path` 警告到
   `%APPDATA%\MiMoWhale\logs\app.log`。

但**安装目录本身仍建议用纯英文**——这两层只覆盖了 profile 路径，覆盖不了 Chromium 对
`app path` 的处理。挪目录后第一次启动会自动更新位置记录，不用重新配置。

## 配置 Cookie

余额查询需要登录 Cookie，**至少包含** `api-platform_serviceToken` 与 `userId`。

1. 打开 <https://platform.xiaomimimo.com/#/console/balance> 并登录
2. DevTools → Network → 任选一个控制台请求 → 复制请求头里的 `Cookie`
3. 点桌宠右上角 ☰ → 粘贴 → 保存（也可以写环境变量 `MIMO_COOKIE`）

保存后会**用 Windows DPAPI 加密**（当前用户作用域），`config.json` 里看不到明文；
加密失败时保存会直接报错，不会降级成明文。诊断面板里可以看到当前的存储方式。
不想落盘的话，用环境变量 `MIMO_COOKIE` 即可。

> Cookie 等同于账号登录凭证：不要提交到 git、不要发给别人。失效后重新复制即可。

## 命令行速查

```text
setup.cmd                     检查环境 + 准备数据目录（缺 Electron 时给出指引）
setup.cmd -InstallDeps        开发者：下载 Electron（需要 Node.js）
setup.cmd -ForceRepair        只修复不完整的 Electron（从本地缓存解压）
setup.cmd -Check              只体检，不改任何文件
setup.cmd -InstallAutostart   顺带设置开机自启
setup.cmd -InstallSkill       顺带安装 MiMo 技能
setup.cmd -Uninstall          卸载自启 / 技能 / 命令行入口（保留个人数据）
```

退出码：`0` 就绪 ｜ `1` 有组件未就绪 ｜ `2` 缺少运行前置（Electron / Node.js）。

## 数据放在哪

所有运行时文件都在**同一个目录**，不写死任何本机路径：

| 平台 | 目录 |
|---|---|
| Windows | `%APPDATA%\MiMoWhale` |
| 其它 | `$XDG_CONFIG_HOME/mimowhale` |

可用环境变量 `MIMO_WHALE_HOME` 覆盖（便携模式）。

| 文件 | 写入方 | 内容 |
|---|---|---|
| `config.json` | Python | Cookie（DPAPI 加密）、Python 路径、刷新间隔 |
| `settings.json` | Electron | 缩放、皮肤、台词、气泡配色、窗口位置 |
| `cache.json` / `ledger.json` | Python | 最近一次联网结果、本地估算账本 |
| `bin\whale.cmd` | `setup.ps1` | 命令行入口（技能与脚本共用） |
| `logs\app.log` | Electron | 运行日志（超过 1 MB 自动滚动） |
| `autostart.json` | PowerShell | 开机自启状态 |
| `pet-path.txt` / `pet-paths.json` | Electron | 安装位置指针与最近位置历史（供引导脚本找回程序） |

## 路径规则（可移植性）

**程序自身的资源永远相对解析，没有任何写死的绝对路径**——这条有测试守着
（[`test/portability.test.js`](test/portability.test.js)：扫描源码里的盘符字面量）。

| 用途 | 解析方式 |
|---|---|
| 程序资源（`main.js`、`python/`、皮肤、脚本） | 相对 `__dirname` / `$PSScriptRoot` / `__file__` |
| 数据 / 配置 / 日志 | `MIMO_WHALE_HOME` → `%APPDATA%\MiMoWhale` |
| Python 解释器 | `config.json`（**先校验存在**）→ `MIMO_PYTHON` → MiMo 自带 → `PATH` |
| 开机自启 | 快捷方式指向固定的 `bootstrap.ps1`，由它按指针列表定位程序 |
| 命令行入口 | `whale.ps1` 运行时读 `pet-path.txt` / `config.json`，失效才用安装时的兜底值 |

所以下面这些操作都不会"起不来"：

- **整包搬到另一个目录**：程序内部全相对；下次启动会重写 `pet-path.txt`，自启随之自愈；
- **拷到另一台电脑**：`config.json` 里的 Python 路径会失效，探测逻辑自动回落到 MiMo 自带或 `PATH`，
  并把正确路径写回去；
- **数据目录搬走**：用 `MIMO_WHALE_HOME` 指过去即可，程序不会去找旧路径。

唯一"需要人做一次"的场景：目录搬走后**从没在新位置启动过**——此时开机引导没有线索可循，
双击一次 `start.cmd` 就会把位置写进指针，之后自启恢复正常。

## 命令行 / MiMo 技能

安装会生成 `%APPDATA%\MiMoWhale\bin\whale.cmd`：

```text
whale.cmd summary      # 纯文本报告（默认联网刷新）
whale.cmd json         # 完整 JSON（加 --offline 只用缓存）
whale.cmd snapshot     # 只读缓存，绝不联网
whale.cmd diagnose     # 排障信息（Cookie 已脱敏）
whale.cmd --help
```

给助手用的话，注册 MiMo 技能：

```powershell
setup.cmd -InstallSkill
```

技能位置：`%USERPROFILE%\.config\mimocode\skills\mimo-balance-whale\`。

## 开机自启

```powershell
setup.cmd -InstallAutostart
```

行为：登录后静默等待 **MiMo 桌面端**启动（最多 10 分钟），随后拉起挂件。
移动安装目录后不需要手动处理——挂件启动时会自动重写快捷方式。
重复启动由单实例锁兜底，不会出现两只桌宠；旧版的启动项会被自动清理。

也可以在设置面板里开关。

## 从旧版 MiMoWhale-Widget 升级

0.1.0 换了数据目录结构。`setup.cmd` 会自动：

- 把旧 `whale.config.json` 里的 Cookie 迁移到 `config.json`（旧文件改名成 `.bak`，不删除）
- 把旧 `whale.ledger.json` 复制成 `ledger.json`（保留记账历史）

旧缓存直接丢弃（结构变了，刷新一次即可）。

## 开发

```bat
setup.cmd -InstallDeps    :: 装 Electron（需要 Node.js）
npm start                 :: 启动挂件
npm test                  :: Node 单测（含 IPC 契约、渲染层静态检查）
npm run test:py           :: Python 单测（无需网络与真实 MiMo）
npm run lint              :: 语法检查（JS + JSON）
npm run smoke             :: 真正启动一次 Electron，自检 API/DOM 后退出
```

`npm run smoke` 会写 `%APPDATA%\MiMoWhale\smoke-report.json`，方便在 CI 里当 artifact。

架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，排障见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

> **接手这个项目？先读 [docs/HANDOFF.md](docs/HANDOFF.md)。**
> 那里面写了：运行模型、每个文件的唯一写者、为什么有些代码"看起来该改"但其实不能改、
> 17 条红线、验证步骤、以及已知限制（中文路径会闪退、Cookie 会过期、exe 未签名）。

## 发行便携包（维护者）

```powershell
setup.cmd -InstallDeps                       # 先在本机装好 Electron
powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1
```

产物：`release\MiMo-Balance-Widget-<版本>-win-x64.zip`（约 130 MB），解压即用、不需要 Node.js。
脚本会校验必需文件、并拒绝把 `config.json` / `logs` 之类本机数据打进包。

## 目录结构

```text
app/                  Electron 主进程 + 渲染层
  main.js             编排：窗口 / 托盘 / IPC / 数据服务 / 调度
  preload.js          唯一的渲染层能力面
  lib/                路径、设置、日志、sidecar 客户端、调度…
  shared/             主进程与渲染层共享的纯函数（几何、格式化）
  src/                index.html + 样式 + 渲染层模块
python/whale/         数据层（标准库实现）
  api.py              MiMo 控制台接口
  sessions.py         只读读取 mimocode.db
  ledger.py           余额差值记账
  summary.py          快照聚合 + 缓存
  sidecar.py          NDJSON 常驻服务（Electron 拉起的那个进程）
  cli.py              命令行入口
scripts/              PowerShell 辅助脚本 + 打包 + 语法检查
skill/                MiMo 技能包
artwork-nc/           角色皮肤（非 MIT，见 NOTICE.md）
test/                 Node 单测
setup.ps1 / setup.cmd 环境检查与安装
start.cmd             启动
```

## 许可与声明

| 内容 | 许可 |
|---|---|
| 代码（`app/`、`python/`、`scripts/`、`skill/`） | MIT |
| 默认鲸鱼图 `app/assets/whale-tight.png` | MIT |
| `artwork-nc/*` 角色皮肤 | **CC BY-NC-SA 4.0（非商用）** |

- 部分角色形象可能涉及第三方 IP，**可再分发权利并不完整**，商用前请自行确认。
- 本项目与小米无关；Cookie 接口属非官方用法，请遵守当地法律与服务条款。
- 明细见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
