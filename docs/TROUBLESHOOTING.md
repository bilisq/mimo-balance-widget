# 排障

先跑一遍体检，它会告诉你缺什么：

```powershell
setup.cmd -Check
```

日志在 `%APPDATA%\MiMoWhale\logs\app.log`，设置面板里也有"日志"和"诊断信息"按钮。

## 启动相关

### 双击 start.cmd 后停留在一屏提示上

那是**缺少 Electron 运行时**时的预期行为，不是崩溃。屏幕上的提示会给你两条路：

- **A（普通用户）**：下载 [Releases](../../releases/latest) 里的便携包，解压后直接双击 `start.cmd`，不需要 Node.js；
- **B（开发者）**：先装 Node.js 18+，再执行 `setup.cmd -InstallDeps`。

本项目的脚本**不会**替你安装 Node.js —— 它只负责检查，并把选择权交给你。

### 我已经有 portable 包，还是提示缺 Electron

确认 zip 是**完整解压**的（不要在压缩软件里直接双击 `start.cmd`），并检查
`node_modules\electron\dist\electron.exe` 是否存在。如果文件被杀毒软件删掉了，
重新解压一次即可。

### 报"Electron 不完整 / icudtl.dat 缺失"

源码安装时网络中断会让 Electron 只解压了一半：

```powershell
setup.cmd -ForceRepair
```

它会从 `%LOCALAPPDATA%\electron\Cache` 里找对应的 zip 重新解压，**不需要联网**。
没有缓存时，重新跑 `setup.cmd -InstallDeps`，或直接改用便携包。

### `setup.cmd -InstallDeps` 卡住或报网络错误

Electron 的下载走的是 `ELECTRON_MIRROR`，脚本会依次尝试 npmmirror 和 GitHub。
都失败时：

1. 换个网络（或挂代理）重试；
2. 或者干脆用便携包——它把运行时打包好了，跟网络无关。

### 没有 Node.js 能用吗

能，但只能用**方式 A**：下载自带运行时的便携包。
Node.js 只在"从源码下载 Electron"这一步需要，普通用户完全用不到。

### 双击后直接闪退 / 窗口完全不出现（尤其目录含中文）

这是已知的**路径编码**问题，不是数据或配置损坏。Chromium 有一批子系统对非 ASCII
路径处理不完整，失败时往往**不报错、直接退出**。

```bat
:: 看一眼你的安装目录有没有中文/日文/emoji
echo %CD%
```

如果含非 ASCII 字符，把整个文件夹（包括 `node_modules`）移动到纯英文路径再试：

```bat
move "C:\Users\你\Desktop\小爱同学的工作区\MiMo-Balance-Widget-v0.1.0" "D:\Apps\MiMo-Balance-Widget"
cd /d D:\Apps\MiMo-Balance-Widget
start.cmd
```

移动后无需重新配置：程序启动时会更新 `pet-path.txt` / `pet-paths.json`，开机自启下次也能找到新位置。

辅助排查（确认是不是走到 Electron 之前就退了）：

```bat
type "%APPDATA%\MiMoWhale\logs\app.log"
```

- 日志里有 `app.start` + `app.non-ascii-path` → 就是这个原因；
- 日志**完全没有**新内容 → 进程在 Electron 初始化阶段就退出了，同样是路径/显卡一类问题，
  可再试 `set MIMO_WHALE_DISABLE_GPU=1`。

### 双击 start.cmd 完全没反应（窗口不出现）

先按顺序排除：

1. **看有没有 Electron 运行时**：`dir node_modules\electron\dist\electron.exe`。
   没有就会打印安装指引（旧版能跑、新版不能，通常就是这个原因）。
2. **看日志**：`%APPDATA%\MiMoWhale\logs\app.log`。里面会记录
   `window.show-fallback`（ready-to-show 未触发，已强制显示）或启动异常。
3. **显卡/驱动问题**：透明窗口在少数驱动上会创建失败或全黑。试一次关掉 GPU：

   ```bat
   set MIMO_WHALE_DISABLE_GPU=1
   start.cmd
   ```

   旧版曾经**无条件**关闭 GPU，0.1.0 改成默认开启、用这个开关兜底。
4. **路径里有异常字符**：确认 `start.cmd` 是最新的（早期开发版本会把
   `...\widget\` 这个带尾反斜杠的路径直接传给 Electron，导致参数里多一个引号，
   表现为"点了没反应"）。新版已经处理，见 `start.cmd` 里的 `PETDIR` 去尾斜杠。

### 启动后完全透明，什么都看不到

- 位置可能被拖到屏幕外了：删掉 `%APPDATA%\MiMoWhale\settings.json` 里的 `window` 字段
  （或删掉整个文件），下次启动会回到右下角；
- 多显示器改动后，挂件会在启动时检查可见性并自动归位。

## 数据相关

### 提示"未配置 MiMo Cookie"

设置面板 → 粘贴 Cookie → 保存。Cookie 需要同时包含 `api-platform_serviceToken` 和 `userId`。

### 提示"Cookie 已失效"

控制台重新登录，复制新 Cookie 覆盖即可。旧 Cookie 会在保存时被替换。

### 提示"找不到 MiMo 会话库 mimocode.db"

这不是错误，只影响"会话 Tokens / 缓存命中"两行——它们读的是 MiMo 桌面端的本地库。
如果确实装了 MiMo 但路径不同，用环境变量指定：

```powershell
set MIMO_DB=D:\path\to\mimocode.db
```

### 余额对了，但"今日消耗"一直是 0

"今日/近 7 天"是按余额差值估算的：只有挂件在运行时观测到余额下降才会记账。
没运行的时间段无法补算，这是接口没有明细数据导致的限制，不是 bug。

### 数字一直是"缓存数据"

说明联网刷新失败了（网络、Cookie 或接口变更）。打开面板状态行会显示具体错误码；
`whale.cmd diagnose` 可以看到 Cookie 是否配置、数据目录在哪。

## Python 相关

### 提示"数据服务未就绪 / 找不到 Python"

按优先级找一个可用的 Python：

1. `config.json` 里的 `python` 字段（`setup.ps1` 写入）
2. 环境变量 `MIMO_PYTHON`
3. MiMo 桌面端自带运行时 `%APPDATA%\Xiaomi MiMo\runtimes\bundled\*\python\python.exe`
4. `PATH` 里的 `python`

修好之后重跑 `setup.ps1`，它会重新探测并写回配置。

### 中文乱码（命令行输出）

0.1.0 起 CLI 强制 UTF-8 输出，理论上不会再出现。如果仍遇到，检查终端的代码页：

```powershell
chcp 65001
```

### `python -m whale.cli` 找不到模块

必须设置 `PYTHONPATH` 指向仓库的 `python` 目录；`setup.ps1` 生成的
`%APPDATA%\MiMoWhale\bin\whale.cmd` 已经处理好，直接用它即可。

## 开机自启

### 登录后没有自动启动

```powershell
powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action status
```

- 启动项在"任务管理器 → 启动"里被禁用了？启用它；
- 快捷方式指向 `%APPDATA%\MiMoWhale\bootstrap.ps1`，里面写的是当前安装路径；
  移动过目录就重跑 `setup.cmd -InstallAutostart`（或让挂件自己启动一次，会自动修复）；
- 如果设置了"等 MiMo 启动"，最多等 10 分钟，超时也会启动。
- 从旧版升级时，旧启动项 `MiMoWhalePet.lnk` 会被自动清理，避免开机启动两个版本。

### 出现了两只桌宠

0.1.0 有单实例锁，正常不会发生。如果看到两只，说明跑的是不同目录的两份拷贝，
关掉其中一个并删掉多余的那份。

## 其它

### 移动安装目录后还能用吗

可以，程序内部全部是相对路径。分两种情况：

- **手动双击 `start.cmd`**：永远没问题。
- **开机自启**：快捷方式指向固定的 `%APPDATA%\MiMoWhale\bootstrap.ps1`，
  它按「安装时记录的路径 → 位置历史 `pet-paths.json` → 单点指针 `pet-path.txt`」依次查找程序。
  所以只要在新位置**启动过一次挂件**，下次开机就能自己找回；
  如果完全不想启动，就跑一次 `setup.cmd -InstallAutostart` 重写快捷方式。

如果换了一台电脑：`config.json` 里记录的 Python 路径会失效，挂件会自动回落到
MiMo 自带运行时或 `PATH`，并把正确路径写回去（日志里会有一条 `python.reconfigured`）。

### 怎么彻底清除

```powershell
setup.cmd -Uninstall
```

然后手动删除程序目录（含 `node_modules`）和 `%APPDATA%\MiMoWhale`。
