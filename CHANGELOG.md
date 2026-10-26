# 变更记录

本项目由旧版 **MiMoWhale-Widget**（0.1.x）重写而来，版本号重新从 **0.1.0** 开始：功能基本不变，结构和正确性大幅调整。

## 0.1.1（2026-10-26）

### 新增

- **透明区点击穿透**：窗口空白处不再挡住下层程序，只有宠物 / 面板 / 菜单 / 诊断面板可交互。
  实现是"主进程默认 `setIgnoreMouseEvents(true, { forward: true })` + 渲染层按 `getBoundingClientRect`
  几何判定"，宠物额外留 16px 热区；拖拽期间锁死捕获。
- **余额面板（旧版的"余额气泡"）5 秒自动收**，并且**点空白处立即关闭**。
  做法借自旧版：旧版没有点击穿透，透明像素照样接收点击，所以一次 `pointerdown` 就能判断
  "点在面板/鲸鱼之外就关"。现在空白区是穿透的、页面收不到点击，所以浮层打开期间先
  `setHold(true)` 让窗口重新捕获鼠标，关掉后再放回穿透；鼠标停在面板上时暂停计时
  （旧版同款），移开重新计时；窗口失焦也关闭。
- **提示气泡**（余额/消耗）：**5 秒自动消失**（`BUBBLE_TTL_MS`），点击任意处或失焦立即关闭；
  `pending`（等待回答/授权）仍常驻。

### 修复

- **宠物点不动**：渲染层 `api.js` 没暴露 `window.setMouseIgnore`，`clickthrough.js` 调用时抛异常
  又被 `catch {}` 吞掉，窗口于是永远停在"忽略鼠标"状态——空白能穿透，宠物却点不到。
- **「检查更新」按钮从 0.1.0 起就是坏的**：`menu.js` 调 `api.update.check()`，而 `api.js` 同样漏了
  `update` 分组。两处都是"主进程/preload 有，渲染层封装忘了加"。
- `clickthrough.js` 不再静默吞异常：首次失败会 `console.error`，并写进日志。

### 质量

- 新增静态测试：**渲染层调用的 `api.<组>.<方法>` 必须在 `api.js` 里存在**（上面两个 bug 都归它管）。
- `npm run smoke` 增加点击穿透链路断言：`mouseCaptureOnPet` / `mouseCaptureOffBlank` / `mouseIgnoreWired`，
  覆盖"渲染层 → preload → IPC → 窗口"整条链路。
- 新增气泡/浮层行为断言（5 秒 TTL、点空白关闭、hover 暂停、`setHold`）。
- `npm run smoke` 增加 `mouseHeldWhileOverlayOpen`：浮层开着时鼠标移到空白处仍保持捕获，
  关掉后恢复穿透——这条正是"点空白关闭"能成立的前提。

## 0.1.0

### 新增（可双击的 exe 启动器）

- **`MiMoBalanceWidget.exe`**：约 7 KB 的 C# 启动器，双击即启动，不闪黑框。
  它只做三件事——找同目录的 `node_modules\electron\dist\electron.exe`、清掉可能被注入的
  `ELECTRON_RUN_AS_NODE`、用正确参数启动；找不到运行时会弹窗，并可直接帮你跑
  `setup.cmd -InstallDeps`。
- 源码 `scripts/launcher/Program.cs`（约 100 行，不联网、不下载），构建脚本
  `scripts/build-launcher.ps1` 用 Windows 自带的 `csc.exe` 编译，**不需要 .NET SDK、不需要联网**；
  发布包会自动编译并带上它。
- 两个非交互模式便于排查：`--check`（打印探测结果）、`--trace`（把启动过程写进
  `launcher-trace.log`，不弹窗，适合自动化验证）。
- 明确的取舍：这不是"单文件应用"，仍需要旁边的运行时目录。真安装包
  （开始菜单 / 卸载 / 自动更新）需要 `electron-builder` + NSIS + 代码签名，属于另一套分发模型。

### 修复

- **配置被遮蔽**：旧版安装脚本会生成一个空的 `%APPDATA%\MiMoWhale\whale.config.json`，
  而数据层按"文件是否存在"选目录，导致用户填在包根目录的 Cookie 永远不生效。
  现在目录解析只有一条规则：`--home` > `MIMO_WHALE_HOME` > 平台默认目录。
- **管道编码**：Python 输出在 Windows 管道下退化成 GBK，主进程按 UTF-8 解码导致中文乱码，
  `summary` 甚至因 `¥` 无法编码直接崩溃。现在 sidecar 直接写 UTF-8 字节，CLI 强制重配 stdout，
  主进程设置 `PYTHONUTF8/PYTHONIOENCODING`。
- **每秒起一个 Python 进程**：探针从"fork 进程"改为"常驻 sidecar + NDJSON"，单次查询从 0.5~1.2 s 降到毫秒级。
- **可以同时跑两只桌宠**：加入单实例锁。
- **`--offline` 仍然联网**：离线模式不再请求预警阈值接口。
- **小百分比被放大 100 倍**：套餐百分比优先用 `used/limit`，不再对 0~1 小数做 ×100 猜测。
- **用户设置的阈值被官方覆盖**：现在官方阈值只是默认值，用户值优先，界面标注来源。
- **`-ForceElectronRepair` 是空参数**：改名为 `-ForceRepair` 并真正实现。
- **自定义贴图路径含中文/空格时加载失败**：改为在主进程读取并转成 data URL。
- **提示气泡注入**：气泡内容全部改为 DOM 构建，不再拼接 HTML。
- **右键被劫持成刷新**：改为打开设置，另外保留点击/拖动交互。

### 质量

- `npm run smoke` 现在会检查**渲染层真实错误与 CSP 拦截**（`securitypolicyviolation`），
  白屏类问题不再只能靠肉眼发现，报告写进 `smoke-report.json`；
- 清掉死代码：未使用的导出（`syncClass`、`DATA_DIR_HINT`、`MAX_BUFFER`、`FALLBACK_ICON`、
  `MAX_BYTES`、`DEFAULT_TICK_MS`、`MAX_BACKOFF_MS`、`RESTART_DELAYS`、`count`）与
  `errors.py` 里没人引用的错误码常量；
- 修掉测试里的两处无用 import。

### 凭证安全

- **不再静默降级为明文**：Windows 上 DPAPI 加密失败时保存直接报错（`ENCRYPT_FAILED`），
  只有显式设置 `MIMO_WHALE_ALLOW_PLAINTEXT=1` 才允许明文；非 Windows 的 CLI 场景会标记 `no-dpapi`。
- **迁移时抹掉旧文件里的明文**：`.bak` 备份保留其它配置，但不再包含 Cookie 字段。
- **应用启动时自动迁移**：不跑 setup 也会把旧版的 `whale.config.json` 迁走并清理，
  不会再出现"新配置已加密、旧文件还躺着明文"。
- **`config.json` 记录存储方式**（`cookieStore: dpapi|plain|none`），诊断面板显示
  「DPAPI 加密 / 明文存储（不推荐）」，保存 Cookie 后菜单会提示是否加密成功。
- 解析优先级调整为：`MIMO_COOKIE` > 加密配置 > 明文配置，避免旧明文覆盖新密文。

### 评审反馈（第三轮）

- **托盘常驻与代码自相矛盾**：`window-all-closed` 的注释说"不退出"，代码却无条件 `app.quit()`。
  现在窗口全部关闭时只记日志、进程保留；`windowController.show()/toggle()` 在窗口已销毁时
  会重建窗口，托盘点一下就能找回来（之前遇到渲染崩溃就会变成"托盘还在但点了没反应"）。
- **刷新间隔双源不同步**：`Brain` 用启动时的 `config.refreshSeconds` 固定定时器，而
  `setRefreshSeconds()` 没有任何调用方。现在主进程每 30 秒回读 `config.json`，
  发现变化就同步给 Brain——`whale configure` 改完不用重启。
- **套餐查询失败被当成"未开通"**：`token_plan()` 两个端点都失败时返回 `error`/`message`，
  面板显示"查询失败"（带 tooltip）而不是"未开通"；确实没开通时 `error` 为 null。
- **刷新不是原子的**：余额 / 套餐 / 预警原先共用一个 `try`，套餐接口一失败，
  已取到的余额被丢弃、账本也不更新。现在只有余额失败才整体回落，套餐与预警各自容错。
- **账本是估算值**：面板上的今日/7 天消耗加 `≈` 前缀与 tooltip，避免被当成精确账单。
- **DPAPI 缺测试**：新增 `test_crypto.py`（Windows 上跑真实往返、密文每次不同、
  篡改与垃圾输入返回 None；其它平台自动跳过）。
- **electron 版本锁定**：`^37.10.3` → `37.10.3`，避免删掉 lock 后重新安装漂到新大版本
  （37 有 postinstall，44 改成懒下载，两者安装流程不同）。
- **去掉 console-message 的双签名兼容**：既然锁定了 37，就按 37 的签名写，
  少一层"只在版本漂移时才生效"的分支。

### 评审反馈（第二轮）

- **探针重复开连接**：`probe()` 原先关掉自己的连接后再调 `pending()`，等于每 1.2 秒开两次
  SQLite、跑四条查询。现在 `pending()` 拆出 `_pending_with(cur, sid)`，probe 在同一连接里做完。
- **会话统计全量重算**：`token_stats()` 之前每次都把整个会话的 `step-finish` 读进内存解析。
  现在先用一条 COUNT/MAX 取 (步数, 最后一步时间)，两者没变就直接用缓存（sidecar 是常驻进程，
  缓存真的生效）；长会话不再随步数线性变慢。
- **轨迹格式漂移不再静默**：有消息却没有任何 `step-finish` 时返回
  `SCHEMA_MISMATCH`，面板的"会话 Tokens"会显示 `—` 并把原因挂到 tooltip 上，
  而不是安静地显示 0。
- **余额字段缺失不再当 0**：`balance` 字段被改名时抛 `API_SHAPE`，
  避免界面显示"余额 ¥0.00"这种更危险的结果。
- **锁定的会话被删掉**：`_resolve_session` 现在会校验 id 是否存在，不存在就回落到最新会话，
  不再永远显示 0。
- **`customImage` 改存文件名**：设置里只写 `custom.png`，读取时按当前数据目录拼回路径，
  数据目录搬盘/换机器后自定义贴图不会消失（有单测）。
- **`mask()` 不再露出末 6 字符**：只保留 userId 与总长度，避免诊断截图带出凭证片段。
- **补上 `sessions.py` 的测试**（此前为 0）：用真实 SQLite 夹具覆盖聚合、探针、待回答检测、
  时间窗、格式漂移。
- **给渲染层加了数据契约 JSDoc**（Balance / TokenPlan / Snapshot / Settings），
  字段改名时编辑器能提示，不用只靠约定。

### 可移植性（本轮重点）

- **`config.json` 里的 Python 路径先校验再使用**：旧逻辑只要配置里有值就直接拿去启动，
  拷到另一台电脑时会拿着一个不存在的路径报"数据服务不可用"；现在会回落到
  `MIMO_PYTHON` → MiMo 自带运行时 → `PATH`，并把正确路径写回配置。
- **命令行入口不再固化 `PYTHONPATH`**：`whale.ps1` 运行时读 `pet-path.txt` 与 `config.json`，
  安装时的路径只作为最后兜底；换盘符/换机器也不会直接失效。
- **开机引导能找回程序**：`bootstrap.ps1` 依次尝试"安装记录 → 位置历史（`pet-paths.json`）
  → 指针（`pet-path.txt`）"，程序每次启动都会刷新这两份记录。
- **修复 BOM 引发的一串问题**：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，
  导致 Node 的 `JSON.parse` 失败、指针路径变成非法路径。现在跨语言读取的文本一律不写 BOM，
  读取侧也剥 BOM；`scripts/check-syntax.js` 增加"PS1 必须带 BOM、CMD 必须纯 ASCII"的守卫。
- 新增 `test/portability.test.js`：源码里出现盘符绝对路径直接 fail。

### 评审反馈（第一轮）

针对外部评审的 5 条意见，逐条处理：

- **自动更新**：不引入 `electron-updater`（它面向 NSIS/Squirrel 安装包 + 代码签名，
  而我们是免安装 zip）。改为**手动"检查更新"**：点击后请求 GitHub releases API，
  有新版就打开 release 页；不后台轮询、不上报。纯逻辑（版本比较、仓库解析、
  错误包装）有 8 个单测。
- **平台局限**：接受事实，不做跨平台。README 新增"平台支持"表，说明依赖面
  （MiMo 客户端 / DPAPI / PowerShell / .lnk）与移植时真正的工作量在"外壳"而非数据层。
- **渲染层可维护性**：接受诊断，不引入 Preact。当前约 700 行 / 10 个模块尚未到需要框架的
  阈值，引入会带来打包步骤与 CSP 调整。先修了具体症状：`menu.sync()` 不再覆盖正在输入的控件。
- **隐私**：日志出口新增**统一脱敏**（`api-platform_serviceToken=***`、`Cookie: ***`），
  5 个单测覆盖；主密码模式暂不做，理由与替代方案（`MIMO_COOKIE` 不落盘）写进 SECURITY.md。
- **网络层只支持 GET**：`_urllib_transport` / `Client._request` 已参数化 `method`，
  并加了转发测试；请求体留到真有 POST 接口时再做，避免半套抽象。

### 修复（反馈闭环）

- **保存 Cookie 后状态永远停在"正在刷新…"**：旧版的保存回调只在成功时写一次提示，
  之后没有任何代码再更新它，所以看起来像卡死。0.1.0 的保存流程现在会等刷新结果并改写提示：
  `刷新完成（19:24:31）` / `刷新失败：<原因>（会按刷新间隔自动重试）`，
  显示缓存时还会注明"当前显示缓存数据"。

### 修复（菜单按钮是死的）

- **右上角 ☰ 只有样式、没有事件**：HTML 里有 `#menu-button`，CSS 还写了 hover 显示，
  但 **app.js 从未给它绑 click** —— 点它当然什么都不发生（右键桌宠仍可打开菜单，但没人猜得到）。
  已绑定为"打开/关闭设置面板"，并阻止冒泡避免同时触发桌宠点击。
- `npm run smoke` 增加**真实点击探测**：加载页面后点一下 ☰（或对桌宠派发 contextmenu），
  断言 `#menu` 真的从 hidden 变成可见，并把按钮的 opacity/pointer-events 一并写进报告。
  这条一旦回归，smoke 直接 `menuOpens: false`。
- 另加静态断言：`#menu-button` 必须在渲染层有事件绑定。
### 修复（渲染层白屏，实测定位）

- **dom.js 漏导出 `clear`**：`menu.js` / `diagnostics.js` 都 `import { clear }`，
  浏览器直接抛 `Uncaught SyntaxError: The requested module './dom.js' does not provide an export named 'clear'`，
  **整个渲染层不执行** —— 主进程一切正常、窗口也建好了，但界面全白。
  已补上 `clear`，并新增静态测试：**所有 import 的具名符号必须在目标模块里真的有导出**。
  这条测试本该早就有——之前只检查了 `#id` 和 import 路径，没检查导出名。
### 修复（启动相关，直接影响"能不能打开"）

- **中文/非 ASCII 安装路径会闪退**（用户实测：放在 `小爱同学的工作区` 下双击无反应，
  挪到纯英文目录即可）。Chromium 的部分子系统对非 ASCII 路径处理不完整，失败时通常不报错。
  本轮补了三处防护：
  1. Chromium 的 profile 固定到 `%APPDATA%\MiMoBalanceWidget`——此前会跟着中文 `productName`
     变成 `%APPDATA%\MiMo 余额挂件`；
  2. 启动时检测安装路径，含非 ASCII 就写一条 `app.non-ascii-path` 警告到日志；
  3. `setup.ps1` 在"运行前置"里直接提示当前目录含中文，并给出英文路径示例。

  README 新增「为什么不能放在中文目录」，排障文档新增对应条目，并加了静态测试守住
  userData 的 ASCII 目录名。
- **`start.cmd` 把带尾反斜杠的路径直接传给 Electron**：`%~dp0` 结尾是 `\`，
  写进带引号的参数后 `CommandLineToArgvW` 会把它当成转义符，子进程收到的路径末尾
  多出一个引号 → 找不到 `package.json` → **双击没反应**。
  旧版的启动器有"去尾斜杠"的防御，重写时漏掉了；现已恢复，并补了
  `app\main.js` 存在性检查与更明确的错误提示。
- **窗口可能永远不显示**：`ready-to-show` 在少数显卡/透明窗口组合下不触发，
  现在改为"页面加载完 1.5 秒后仍不可见就强制 show"，并写一条
  `window.show-fallback` 日志，不再表现为"点了没反应"。
- **识别 npm 11.19+ 的 `allowScripts` 门禁**：新版 npm 默认不执行依赖的 postinstall，
  `npm install` 会"成功"但不产出 `electron.exe`。setup 现在的兜底顺序是：
  补跑 `electron/install.js` → 从本地缓存解压 → 打印放行命令
  （`npm install-scripts approve electron`），不再只给一句"文件不完整"。
- 排障文档补充"双击没反应"的四步排查（含 `MIMO_WHALE_DISABLE_GPU=1` 兜底）。

### 新增

- **便携发布包**：`scripts/package-release.ps1` 生成自带 Electron 运行时的 zip，
  普通用户解压即用，**完全不需要 Node.js**；
- 窗口位置记忆、屏幕外自动归位、多显示器变更后自愈；
- 设置面板可直接切换浅色/深色/跟随主题；
- `whale` 命令行入口与 `diagnose` 子命令；
- 旧版配置与账本的一次性迁移（`migrate`）；
- 日志文件（`logs\app.log`，1 MB 滚动）；
- 单测：Python 50 个、Node 若干（含 IPC 契约与渲染层静态检查）；
- `npm run smoke`：真正启动 Electron 自检 API 与 DOM；
- GitHub Actions CI。

### 安装流程（重要）

- **不再尝试安装 Node.js**。旧版会在缺 Node 时报一串错误、把用户挡在门外；
  现在安装脚本只做检查，缺少运行时时打印两条明确路径：
  A. 下载自带 Electron 的便携包（不需要 Node.js）；
  B. 开发者先装 Node.js 18+，再执行 `setup.ps1 -InstallDeps`。
- `setup.ps1` 新增 `-InstallDeps`（显式下载 Electron）、`-ForceRepair`（离线修复）；
  删除了语义混乱的 `-SkipDeps`。
- 退出码约定：`0` 就绪 / `1` 有组件未就绪 / `2` 缺少运行前置，`start.cmd` 据此给出不同提示。
- 修复了一个会让安装器"假失败"的 bug：把 CLI 输出和退出码一起 `return`，
  导致明明写入成功的配置被判定为失败。
- 安装/卸载时自动清理旧版遗留的 `MiMoWhalePet.lnk` 启动项。

### 变更

- 数据目录文件统一为 `config.json` / `settings.json` / `cache.json` / `ledger.json`；
- 快照结构升级到 `schema 2`（`balance.amount` 取代 `balance.balance`）；
- 皮肤不再复制到 `app/assets/presets/`，直接从 `artwork-nc/` 读取；
- 移除 `scripts/server.py`（本地 HTTP 预览服务，带 `Access-Control-Allow-Origin: *` 且无鉴权）；
- 皮肤图片压缩到 720px（仓库体积从 ~3.9 MB 降到 ~1.5 MB）。

### 移除

- 三处重复的"找 Python"逻辑（收敛到 `app/lib/python.js` 与 `setup.ps1`）；
- 生成物 `app/auto-launch.ps1`、`pet-path.txt`、递归搜索安装目录的启发式逻辑；
- 死代码与小道具（`chip`、`.speech`、无用的 `import time` 等）。

## 旧版 MiMoWhale-Widget 0.1.x（已归档）

首个公开版本：透明置顶桌宠、余额 / 套餐 / 会话用量、三种皮肤、开机自启、MiMo 技能。
