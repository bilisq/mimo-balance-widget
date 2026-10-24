#Requires -Version 5.1
<#
  MiMo 余额挂件 · 安装 / 体检 / 卸载

  重要：本脚本**不会**安装 Node.js，也不会在缺少 Node.js 的情况下尝试联网装 Electron。
        缺少运行时时只做检查，并打印两条可选路径（便携包 / 自己装 Node.js）。

  用法（在仓库根目录执行）：
    setup.cmd                     检查 + 准备工作目录（缺少 Electron 时给出指引）
    setup.cmd -InstallDeps        开发者：用 npm 下载 Electron（需要 Node.js 18+）
    setup.cmd -ForceRepair        只修复不完整的 Electron（从本地缓存解压，不联网）
    setup.cmd -Check              只体检，不改任何文件
    setup.cmd -InstallAutostart   顺带设置开机自启
    setup.cmd -InstallSkill       顺带安装 MiMo 技能
    setup.cmd -Uninstall          卸载自启 / 技能 / 命令行入口（保留个人数据）

  退出码：0 就绪 ｜ 1 有组件未就绪 ｜ 2 缺少运行前置（Electron 或 Node.js）
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$InstallDeps,
    [switch]$InstallAutostart,
    [switch]$InstallSkill,
    [switch]$Uninstall,
    [switch]$ForceRepair,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

# ---- 改这里就能把指引指向你自己的仓库 ----
$ProjectUrl = 'https://github.com/bilisq/mimo-balance-widget'
$ReleasesUrl = "$ProjectUrl/releases/latest"
$NodeDownloadUrl = 'https://nodejs.org/zh-cn/download'
$PythonDownloadUrl = 'https://www.python.org/downloads/'
$NodeMinMajor = 18

$pkgRoot = $PSScriptRoot
$pythonDir = Join-Path $pkgRoot 'python'
$electronExe = Join-Path $pkgRoot 'node_modules\electron\dist\electron.exe'
$electronDist = Join-Path $pkgRoot 'node_modules\electron\dist'
$autostartScript = Join-Path $pkgRoot 'scripts\autostart.ps1'

if ($env:MIMO_WHALE_HOME) {
    $dataDir = $env:MIMO_WHALE_HOME
} else {
    $dataDir = Join-Path $env:APPDATA 'MiMoWhale'
}
$configPath = Join-Path $dataDir 'config.json'
$pointerPath = Join-Path $dataDir 'pet-path.txt'
$binDir = Join-Path $dataDir 'bin'

function Step([string]$Message) { if (-not $Quiet) { Write-Host ("==> {0}" -f $Message) -ForegroundColor Cyan } }
function Ok([string]$Message) { if (-not $Quiet) { Write-Host ("  OK  {0}" -f $Message) -ForegroundColor Green } }
function Warn2([string]$Message) { Write-Host ("  !!  {0}" -f $Message) -ForegroundColor Yellow }
function Bad([string]$Message) { Write-Host ("  XX  {0}" -f $Message) -ForegroundColor Red }

function Write-Utf8Bom {
    param([string]$Path, [string]$Content)
    $encoding = New-Object System.Text.UTF8Encoding $true
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

# 给"跨语言读取"的文本用：Node 的 JSON.parse 不认 BOM，纯路径文件也不该带 BOM。
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $encoding = New-Object System.Text.UTF8Encoding $false
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

# ---------------------------------------------------------------- 指引输出

function Show-ElectronGuidance {
    Write-Host ''
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host ' 缺少 Electron 运行时：启动必需，解压后约 317 MB' -ForegroundColor Yellow
    Write-Host ' 本脚本不会替你安装 Node.js，请从下面两种方式里选一种：'
    Write-Host ''
    Write-Host '   A. 普通用户（完全不需要 Node.js）'
    Write-Host ("      下载自带运行时的便携包：{0}" -f $ReleasesUrl)
    Write-Host '      解压后直接双击 start.cmd 即可'
    Write-Host ''
    Write-Host '   B. 开发者（需要 Node.js 18 或更高版本）'
    Write-Host ("      1) 先安装 Node.js：{0}" -f $NodeDownloadUrl)
    Write-Host '      2) 回到本目录执行：setup.cmd -InstallDeps'
    Write-Host ''
    Write-Host ' 说明：Node.js 只用于"下载 Electron"这一步；便携包已经把 Electron 打包好，'
    Write-Host '       所以普通用户完全不需要装 Node.js。'
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host ''
}

function Show-PythonGuidance {
    Write-Host ''
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host ' 没有找到 Python 3.9+（挂件仍可启动，但余额 / 会话数据不可用）'
    Write-Host ' 推荐直接安装 MiMo 桌面端（自带 Python 运行时），或：'
    Write-Host ("   {0}" -f $PythonDownloadUrl)
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host ''
}

# ---------------------------------------------------------------- 探测

function Resolve-Node {
    $node = $null
    $npm = $null
    if ($env:MIMO_NODE -and (Test-Path -LiteralPath $env:MIMO_NODE)) { $node = $env:MIMO_NODE }
    if ($env:MIMO_NPM -and (Test-Path -LiteralPath $env:MIMO_NPM)) { $npm = $env:MIMO_NPM }
    if (-not $node) {
        $found = Get-Command node -ErrorAction SilentlyContinue
        if ($found) { $node = $found.Source }
    }
    if (-not $npm) {
        $found = Get-Command npm -ErrorAction SilentlyContinue
        if ($found) {
            $npm = $found.Source
            # Get-Command 可能解析到 npm.ps1；在受限执行策略下会调用失败，
            # 优先换成同目录的 npm.cmd（Node 安装包一定会带它）。
            if ($npm -like '*.ps1') {
                $cmdShim = [System.IO.Path]::ChangeExtension($npm, '.cmd')
                if (Test-Path -LiteralPath $cmdShim) { $npm = $cmdShim }
            }
        } elseif ($node) {
            $guess = Join-Path (Split-Path $node -Parent) 'node_modules\npm\bin\npm-cli.js'
            if (Test-Path -LiteralPath $guess) { $npm = $guess }
        }
    }
    return @{ Node = $node; Npm = $npm }
}

function Test-NodeReady {
    $tools = Resolve-Node
    if (-not $tools.Node) {
        return @{ Ok = $false; Node = $null; Npm = $null; Version = ''; Reason = '未找到 Node.js' }
    }
    if (-not $tools.Npm) {
        return @{ Ok = $false; Node = $tools.Node; Npm = $null; Version = ''; Reason = '找到 node 但找不到 npm' }
    }

    $raw = ''
    try { $raw = (& $tools.Node -v 2>$null | Out-String).Trim() } catch { $raw = '' }
    if ($raw -notmatch '^v(\d+)\.') {
        return @{ Ok = $false; Node = $tools.Node; Npm = $tools.Npm; Version = $raw; Reason = '无法获取 Node.js 版本' }
    }
    $major = [int]$Matches[1]
    if ($major -lt $NodeMinMajor) {
        return @{
            Ok = $false
            Node = $tools.Node
            Npm = $tools.Npm
            Version = $raw
            Reason = ("Node.js {0} 太低，需要 v{1}+" -f $raw, $NodeMinMajor)
        }
    }
    return @{ Ok = $true; Node = $tools.Node; Npm = $tools.Npm; Version = $raw; Reason = '' }
}

function Resolve-Python {
    if ($env:MIMO_PYTHON -and (Test-Path -LiteralPath $env:MIMO_PYTHON)) { return $env:MIMO_PYTHON }

    $bundledRoot = Join-Path $env:APPDATA 'Xiaomi MiMo\runtimes\bundled'
    if (Test-Path -LiteralPath $bundledRoot) {
        foreach ($entry in Get-ChildItem -LiteralPath $bundledRoot -Directory -ErrorAction SilentlyContinue) {
            $candidate = Join-Path $entry.FullName 'python\python.exe'
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }

    foreach ($name in @('python', 'python3')) {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($found -and $found.Source -notmatch 'WindowsApps') { return $found.Source }
    }
    return $null
}

function Get-PythonVersion([string]$Exe) {
    try {
        $raw = & $Exe -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        return ($raw | Out-String).Trim()
    } catch {
        return ''
    }
}

function Test-PythonVersion([string]$Version) {
    if (-not $Version -or $Version -notmatch '^(\d+)\.(\d+)$') { return $false }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    return ($major -gt 3) -or ($major -eq 3 -and $minor -ge 9)
}

function Test-ElectronComplete {
    $required = @(
        'electron.exe',
        'icudtl.dat',
        'snapshot_blob.bin',
        'v8_context_snapshot.bin',
        'resources\default_app.asar',
        'locales\en-US.pak'
    )
    foreach ($name in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $electronDist $name))) { return $false }
    }
    return $true
}

# ---------------------------------------------------------------- Electron

function Repair-ElectronFromCache {
    Step '从本地缓存修复 Electron 运行时'
    $cache = Join-Path $env:LOCALAPPDATA 'electron\Cache'
    $zip = $null
    if (Test-Path -LiteralPath $cache) {
        $zip = Get-ChildItem -LiteralPath $cache -Recurse -Filter 'electron-v*-win32-x64.zip' -ErrorAction SilentlyContinue |
            Sort-Object Length -Descending |
            Select-Object -First 1
    }
    if (-not $zip) {
        Bad '没找到 Electron 缓存 zip，无法离线修复'
        Warn2 '请按上面的方式 A 下载便携包，或联网后执行 setup.cmd -InstallDeps'
        return $false
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('mimo-widget-repair-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip.FullName, $temp)
        New-Item -ItemType Directory -Path $electronDist -Force | Out-Null
        Copy-Item -Path (Join-Path $temp '*') -Destination $electronDist -Recurse -Force
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (Test-ElectronComplete) {
        Ok ("Electron 已修复（来源 {0}）" -f $zip.Name)
        return $true
    }
    Bad '修复后仍不完整'
    return $false
}

function Install-ElectronDeps {
    $node = Test-NodeReady
    if (-not $node.Ok) {
        Bad $node.Reason
        return $false
    }
    Ok ("Node.js {0}" -f $node.Version)
    Step '下载 Electron 运行时（首次约 100 MB，请保持网络畅通）'

    $mirrors = @(
        'https://npmmirror.com/mirrors/electron/',
        'https://github.com/electron/electron/releases/download/'
    )
    $installed = $false
    Push-Location $pkgRoot
    try {
        foreach ($mirror in $mirrors) {
            Write-Host ("  ..  ELECTRON_MIRROR={0}" -f $mirror)
            $env:ELECTRON_MIRROR = $mirror
            if ($node.Npm -like '*.js') {
                & $node.Node $node.Npm install --no-fund --no-audit
            } else {
                & $node.Npm install --no-fund --no-audit
            }
            if ($LASTEXITCODE -eq 0) { $installed = $true; break }
            Warn2 '这个镜像没成功，换下一个'
        }

        if (-not (Test-ElectronComplete)) {
            $installScript = Join-Path $pkgRoot 'node_modules\electron\install.js'
            if (Test-Path -LiteralPath $installScript) {
                Write-Host '  ..  补跑 electron/install.js（npm 可能拦截了 postinstall）'
                & $node.Node $installScript
            }
        }
    } finally {
        Pop-Location
    }

    if (-not (Test-ElectronComplete)) { [void](Repair-ElectronFromCache) }

    if (Test-ElectronComplete) {
        Ok 'Electron 运行时完整'
        return $true
    }

    if (-not $installed) {
        Bad 'npm install 失败（多半是网络或镜像问题）'
        Warn2 '可以重试，或改用方式 A 下载便携包'
    } else {
        Bad 'npm 执行成功，但 Electron 文件不完整'
        # npm 11.19+ 新增 allowScripts 门禁：默认不执行依赖的 postinstall，
        # electron 的 node install.js 会被拦下（表现为一条 npm warn）。
        Warn2 '新版 npm 可能拦下了 Electron 的 postinstall（allowScripts 门禁）'
        Warn2 '手动放行：npm install-scripts approve electron  然后重跑 setup.cmd -InstallDeps'
        Warn2 '或者跳过 npm：node node_modules\electron\install.js'
        Warn2 '还不行就删掉 node_modules 后重来，或用 setup.cmd -ForceRepair（走本地缓存）'
    }
    return $false
}

# ---------------------------------------------------------------- 配置 / 入口

function Invoke-WhaleCli {
    param([string]$Python, [string[]]$CliArgs)
    $env:PYTHONPATH = $pythonDir
    $env:MIMO_WHALE_HOME = $dataDir
    $env:PYTHONUTF8 = '1'

    # 不要把命令输出和退出码一起 return，否则调用方拿到的是"输出数组"，判断会失真。
    # 这里只返回 [int] 退出码；失败时把输出打到控制台，便于用户自查。
    $lines = & $Python -X utf8 -m whale.cli @CliArgs 2>&1
    $code = [int]$LASTEXITCODE
    if ($code -ne 0 -and $lines) {
        ($lines | Out-String).Trim() -split "`r?`n" | Where-Object { $_ } | ForEach-Object {
            Write-Host ("     {0}" -f $_) -ForegroundColor DarkGray
        }
    }
    return $code
}

function Write-Config([string]$Python) {
    Step '写入数据层配置（Python 路径 / 刷新间隔）'
    $code = Invoke-WhaleCli -Python $Python -CliArgs @('configure', '--python', $Python, '--refresh', '60')
    if ($code -eq 0) { Ok ("配置：{0}" -f $configPath) } else { Warn2 '配置写入失败（保存 Cookie 时也会自动生成）' }

    Step '迁移旧版配置（如有）'
    [void](Invoke-WhaleCli -Python $Python -CliArgs @('migrate'))
    Ok '迁移检查完成'
}

function Write-InstallPointer {
    # 只记录"程序在哪"，程序自身的资源仍全部相对 $PSScriptRoot / __dirname 解析。
    # 开机引导与命令行入口会在运行时读它，所以搬移目录后只需让程序启动一次即可自愈。
    # 不写 BOM：Node 侧读取纯文本时不会剥 BOM，带 BOM 的路径会变成非法路径。
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Utf8NoBom -Path $pointerPath -Content $pkgRoot
}

function Write-CliShim([string]$Python) {
    Step '生成命令行入口（技能与脚本共用）'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null

    # 入口里的路径是"运行时解析"的：
    #   数据目录取脚本自己的父目录（入口位于 <数据目录>\bin，天然相对，换盘符也不失效）
    #   仓库位置依次看 pet-path.txt → 数据目录的上一级（便携模式）→ 安装时的兜底
    $ps1 = @'
# 由 setup.ps1 生成：调用挂件自带数据层 CLI（路径运行时解析，可随目录/盘符变化）
$ErrorActionPreference = 'Stop'

# 入口放在 <数据目录>\bin 下，所以数据目录可以直接从脚本位置推出来，
# 不需要把绝对路径写死在这里。
$dataHome = Split-Path -Parent $PSScriptRoot
if (-not $dataHome) { $dataHome = '__DATA_DIR__' }

# 用 .NET 的存在性检查而不是 Join-Path/Test-Path：盘符不存在时 Join-Path 会抛错，
# 而"换了一台电脑，记录的 D 盘根本不存在"正是这里要处理的情况。
function Test-File([string]$path) {
    if (-not $path) { return $false }
    try { return [System.IO.File]::Exists($path) } catch { return $false }
}

function Test-Repo([string]$dir) {
    if (-not $dir) { return $false }
    return Test-File ($dir + '\python\whale\cli.py')
}

$repo = ''
$pointer = $dataHome + '\pet-path.txt'
if (Test-File $pointer) {
    try { $repo = ([System.IO.File]::ReadAllText($pointer)).TrimStart([char]0xFEFF).Trim() } catch { $repo = '' }
}

# 便携模式：数据目录就放在程序目录里（MIMO_WHALE_HOME=.\data），上一级即程序根
if (-not (Test-Repo $repo)) {
    $parent = Split-Path -Parent $dataHome
    if (Test-Repo $parent) { $repo = $parent }
}

if (-not (Test-Repo $repo)) { $repo = '__REPO_FALLBACK__' }

$python = ''
$configPath = $dataHome + '\config.json'
if (Test-File $configPath) {
    try { $python = (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json).python } catch { $python = '' }
}
if (-not $python -or -not (Test-File $python)) { $python = '__PYTHON_FALLBACK__' }
if (-not $python -or -not (Test-File $python)) { $python = 'python' }

$env:PYTHONPATH = $repo + '\python'
$env:MIMO_WHALE_HOME = $dataHome
$env:PYTHONUTF8 = '1'
& $python -X utf8 -m whale.cli @args
exit $LASTEXITCODE
'@
    $ps1 = $ps1.Replace('__DATA_DIR__', $dataDir).Replace('__REPO_FALLBACK__', $pkgRoot).Replace('__PYTHON_FALLBACK__', $Python)
    Write-Utf8Bom -Path (Join-Path $binDir 'whale.ps1') -Content $ps1

    # .cmd 保持纯 ASCII，用 %~dp0 引用同目录的 ps1，避免中文路径在 cmd 里乱码
    $cmd = @'
@echo off
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0whale.ps1" %*
'@
    Set-Content -LiteralPath (Join-Path $binDir 'whale.cmd') -Value $cmd -Encoding ASCII
    Ok ("入口：{0}" -f (Join-Path $binDir 'whale.cmd'))
}

function Install-Skill {
    Step '安装 MiMo 技能'
    $skillSrc = Join-Path $pkgRoot 'skill\mimo-balance-whale'
    $skillDst = Join-Path $env:USERPROFILE '.config\mimocode\skills\mimo-balance-whale'
    if (-not (Test-Path -LiteralPath $skillSrc)) {
        Warn2 '仓库里没有 skill/mimo-balance-whale，跳过'
        return
    }
    New-Item -ItemType Directory -Path $skillDst -Force | Out-Null
    Copy-Item -Path (Join-Path $skillSrc '*') -Destination $skillDst -Recurse -Force
    Ok ("技能：{0}" -f $skillDst)
}

function Install-Autostart {
    Step '设置开机自启'
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $autostartScript -Action install -AppRoot $pkgRoot -DataDir $dataDir -WaitMimo
    if ($LASTEXITCODE -eq 0) { Ok '开机自启已设置' } else { Warn2 '开机自启设置失败（可稍后在设置面板里重试）' }
}

function Uninstall-All {
    Step '卸载开机自启'
    if (Test-Path -LiteralPath $autostartScript) {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $autostartScript -Action uninstall -AppRoot $pkgRoot -DataDir $dataDir
    }

    Step '移除 MiMo 技能与命令行入口'
    $skillDst = Join-Path $env:USERPROFILE '.config\mimocode\skills\mimo-balance-whale'
    if (Test-Path -LiteralPath $skillDst) {
        Remove-Item -LiteralPath $skillDst -Recurse -Force
        Ok ("已删除 {0}" -f $skillDst)
    }
    if (Test-Path -LiteralPath $binDir) {
        Remove-Item -LiteralPath $binDir -Recurse -Force
        Ok ("已删除 {0}" -f $binDir)
    }
    if (Test-Path -LiteralPath $pointerPath) {
        Remove-Item -LiteralPath $pointerPath -Force
        Ok ("已删除安装位置指针 {0}" -f $pointerPath)
    }

    Warn2 '个人数据（Cookie / 设置 / 日志）保留在数据目录，需要的话请手动删除：'
    Write-Host ("     {0}" -f $dataDir)
    Warn2 'node_modules 需要手动删除（或直接删掉整个目录）'
}

# ---------------------------------------------------------------- 体检

function Show-Check {
    $node = Test-NodeReady
    $python = Resolve-Python
    $pythonVersion = if ($python) { Get-PythonVersion $python } else { '' }

    Step '运行前置'
    # Chromium 对非 ASCII 路径的处理不完整，已知在中文目录下会闪退且不报错。
    # 这里放在最前面提示，比用户去猜"为什么双击没反应"有用。
    if ($pkgRoot -match '[^\x00-\x7F]') {
        Warn2 '安装目录含中文/非 ASCII 字符，可能导致启动闪退'
        Warn2 ("当前目录：{0}" -f $pkgRoot)
        Warn2 '建议移动到纯英文路径，例如 <英文字母盘>:\Apps\MiMo-Balance-Widget'
    }
    if (Test-ElectronComplete) {
        Ok 'Electron 运行时完整（可以启动）'
    } elseif (Test-Path -LiteralPath $electronExe) {
        Bad 'Electron 不完整：执行 setup.cmd -ForceRepair，或重新下载便携包'
    } else {
        Bad 'Electron 未安装：普通用户下载便携包，开发者 setup.cmd -InstallDeps'
    }
    if ($node.Ok) { Ok ("Node.js {0}（仅开发需要）" -f $node.Version) }
    else { Write-Host ("  --  Node.js 不可用（{0}；仅开发需要）" -f $node.Reason) }

    if ($python) {
        if (Test-PythonVersion $pythonVersion) { Ok ("Python {0} · {1}" -f $pythonVersion, $python) }
        else { Bad ("Python 版本过低或不可用：{0}" -f $pythonVersion) }
    } else {
        Bad '未找到 Python（余额与会话数据不可用，挂件仍能启动）'
    }

    Step '数据目录'
    if (Test-Path -LiteralPath $configPath) { Ok ("配置存在：{0}" -f $configPath) } else { Warn2 '还没有 config.json（首次保存 Cookie 时会生成）' }

    if ($python -and (Test-PythonVersion $pythonVersion)) {
        Step '数据层自检（不联网）'
        $diagnose = & {
            $env:PYTHONPATH = $pythonDir
            $env:MIMO_WHALE_HOME = $dataDir
            $env:PYTHONUTF8 = '1'
            & $python -X utf8 -m whale.cli diagnose 2>$null
        }
        if ($diagnose) {
            $info = $diagnose | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($info) {
                Ok ("Cookie：{0}" -f $info.cookie)
                if ($info.sessionDbFound) { Ok ("会话库：{0}" -f $info.sessionDb) }
                else { Warn2 '未找到 mimocode.db（会话统计不可用，其它功能正常）' }
                Ok ("数据目录：{0}" -f $info.home)
            }
        } else {
            Warn2 '数据层自检没有输出'
        }
    }

    Step '可选组件'
    $statePath = Join-Path $dataDir 'autostart.json'
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($state.enabled) { Ok '开机自启：已开启' } else { Write-Host '  --  开机自启：未开启' }
    } else {
        Write-Host '  --  开机自启：未开启'
    }
    $skillDst = Join-Path $env:USERPROFILE '.config\mimocode\skills\mimo-balance-whale'
    if (Test-Path -LiteralPath $skillDst) { Ok 'MiMo 技能：已安装' } else { Write-Host '  --  MiMo 技能：未安装' }
    if (Test-Path -LiteralPath (Join-Path $binDir 'whale.cmd')) { Ok '命令行入口：已生成' } else { Write-Host '  --  命令行入口：未生成' }

    Write-Host ''
    if (Test-ElectronComplete) {
        Write-Host '结论：可以启动，双击 start.cmd 即可。' -ForegroundColor Green
    } else {
        Write-Host '结论：还缺少 Electron 运行时，暂时无法启动（见上方两种方式）。' -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------- 主流程

if ($Uninstall) {
    Uninstall-All
    exit 0
}

if ($Check) {
    Show-Check
    exit 0
}

Write-Host ''
Write-Host 'MiMo 余额挂件 · 安装' -ForegroundColor Magenta
Write-Host ("目录: {0}" -f $pkgRoot)
Write-Host ("数据: {0}" -f $dataDir)
Write-Host ''

$electronOk = $false
$needsGuidance = $false

if ($ForceRepair) {
    $electronOk = Repair-ElectronFromCache
    if (-not $electronOk) { $needsGuidance = $true }
} elseif ($InstallDeps) {
    if (Test-ElectronComplete) {
        Step 'Electron 运行时'
        Ok '已就绪，跳过下载'
        $electronOk = $true
    } else {
        $electronOk = Install-ElectronDeps
        if (-not $electronOk) { $needsGuidance = $true }
    }
} else {
    Step 'Electron 运行时'
    if (Test-ElectronComplete) {
        Ok '已就绪'
        $electronOk = $true
    } else {
        Bad '未安装（启动必需）'
        $needsGuidance = $true
    }
}

# Python 与配置不依赖 Electron：先准备好，之后拿到便携包就能直接跑
Write-InstallPointer
$python = Resolve-Python
$pythonVersion = if ($python) { Get-PythonVersion $python } else { '' }
$pythonOk = ($python -and (Test-PythonVersion $pythonVersion))
if ($pythonOk) {
    Ok ("Python {0}" -f $pythonVersion)
    Write-Config -Python $python
    Write-CliShim -Python $python
} else {
    if ($python) { Bad ("Python 版本过低：{0}（需要 3.9+）" -f $pythonVersion) }
    else { Bad '未找到 Python：余额与会话数据将不可用' }
    Show-PythonGuidance
}

if ($InstallSkill) { Install-Skill }
if ($InstallAutostart) { Install-Autostart }

if ($needsGuidance) { Show-ElectronGuidance }

Write-Host ''
if ($electronOk) {
    Write-Host '运行时就绪，双击 start.cmd 启动。' -ForegroundColor Green
} else {
    Write-Host '安装未完成：还缺 Electron 运行时（见上面的方式 A / B）。' -ForegroundColor Yellow
}

if (-not $Quiet -and $electronOk) {
    Write-Host @'

下一步:
  1. 双击 start.cmd 启动挂件
  2. 点桌宠右上角 ☰ → 粘贴 Cookie → 保存
       控制台: https://platform.xiaomimimo.com/#/console/balance
       （Cookie 需包含 api-platform_serviceToken 与 userId）
  3. 体检: setup.cmd -Check

'@ -ForegroundColor DarkGray
}

if (-not $electronOk) { exit 2 }
if (-not $pythonOk) { exit 1 }
exit 0
