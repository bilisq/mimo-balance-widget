#Requires -Version 5.1
<#
  开机自启管理：本项目里唯一会创建/删除启动快捷方式的地方。

  用法：
    powershell -File scripts\autostart.ps1 -Action install   -AppRoot <仓库> -DataDir <数据目录> [-WaitMimo]
    powershell -File scripts\autostart.ps1 -Action uninstall -AppRoot <仓库> -DataDir <数据目录>
    powershell -File scripts\autostart.ps1 -Action status    -DataDir <数据目录>

  设计：
  - 启动项指向固定位置 <数据目录>\bootstrap.ps1，bootstrap 里写的是当前安装路径；
  - 目录搬移后，挂件启动时会用 -Action install 重写一次（自愈），也可手动跑本脚本；
  - 状态写在 <数据目录>\autostart.json，供 Node 侧读取。
#>
[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall', 'status')]
    [string]$Action = 'status',

    [string]$AppRoot = '',
    [string]$DataDir = '',

    [switch]$WaitMimo
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $encoding = New-Object System.Text.UTF8Encoding $false
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}
function Write-Utf8Bom {
    param([string]$Path, [string]$Content)
    $encoding = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
if (-not $DataDir) {
    if ($env:MIMO_WHALE_HOME) { $DataDir = $env:MIMO_WHALE_HOME }
    else { $DataDir = Join-Path $env:APPDATA 'MiMoWhale' }
}

$statePath = Join-Path $DataDir 'autostart.json'
$bootstrapPath = Join-Path $DataDir 'bootstrap.ps1'
$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startupDir 'MiMoBalanceWidget.lnk'
$electron = Join-Path $AppRoot 'node_modules\electron\dist\electron.exe'

# 旧版的启动项叫 MiMoWhalePet.lnk，安装/卸载时顺手清掉，避免开机启动两个旧挂件
$legacyLnks = @('MiMoWhalePet.lnk', 'MiMoWhale.lnk') | ForEach-Object { Join-Path $startupDir $_ }

function Remove-LegacyShortcuts {
    foreach ($path in $legacyLnks) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
            Write-Host ("已清理旧版启动项: {0}" -f $path)
        }
    }
}

function Save-State {
    param([bool]$Enabled, [bool]$Wait)
    $payload = [ordered]@{
        enabled  = $Enabled
        target   = $AppRoot
        waitMimo = $Wait
        lnk      = $lnkPath
        updated  = (Get-Date).ToUniversalTime().ToString('o')
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Write-Utf8NoBom -Path $statePath -Content ($payload | ConvertTo-Json -Depth 3)
}

if ($Action -eq 'status') {
    if (Test-Path -LiteralPath $lnkPath) {
        Write-Host '开机自启：已开启'
        Write-Host ("  启动项: {0}" -f $lnkPath)
    } else {
        Write-Host '开机自启：未开启'
    }
    exit 0
}

if ($Action -eq 'uninstall') {
    foreach ($path in @($lnkPath, $bootstrapPath)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
            Write-Host ("已删除: {0}" -f $path)
        }
    }
    Remove-LegacyShortcuts
    Save-State -Enabled $false -Wait $false
    Write-Host '已取消开机自启'
    exit 0
}

# ---------------- install ----------------

if (-not (Test-Path -LiteralPath $electron)) {
    Write-Error ("找不到 electron.exe：{0}（请先运行 setup.ps1）" -f $electron)
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'app\main.js'))) {
    Write-Error ("目录不像挂件安装位置：{0}" -f $AppRoot)
    exit 1
}

$waitBlock = ''
if ($WaitMimo) {
    $waitBlock = @'
# 等 MiMo 桌面端就绪，最多 10 分钟；没等到也照常启动，不阻塞开机
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
    $mimo = Get-Process -Name 'Xiaomi MiMo', 'MiMo', 'mimo-desktop' -ErrorAction SilentlyContinue
    if ($mimo) { break }
    Start-Sleep -Seconds 3
}
Start-Sleep -Seconds 2
'@
}

$bootstrapTemplate = @'
# 由 MiMo 余额挂件自动生成，请勿手工编辑（移动目录或重装后会自动重写）
$ErrorActionPreference = 'SilentlyContinue'

# 安装目录不写死一处：先试安装时记录的路径，再试程序每次启动写下的位置历史。
# 这样目录搬移后，只要在新位置启动过一次挂件，下次开机就能自己找回来。
$dataHome = '__DATA_DIR__'
$roots = @('__APP_ROOT__')

# 用 .NET 的存在性检查：候选路径可能指向已经不存在的盘符，Join-Path 会抛错
function Test-File([string]$path) {
    if (-not $path) { return $false }
    try { return [System.IO.File]::Exists($path) } catch { return $false }
}

$known = $dataHome + '\pet-paths.json'
if (Test-File $known) {
    try {
        $parsed = Get-Content -LiteralPath $known -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($parsed.roots) { $roots += @($parsed.roots) }
    } catch { }
}

$pointer = $dataHome + '\pet-path.txt'
if (Test-File $pointer) {
    try { $roots += ([System.IO.File]::ReadAllText($pointer)).TrimStart([char]0xFEFF).Trim() } catch { }
}

# 便携模式：数据目录放在程序目录里（MIMO_WHALE_HOME=.\data），上一级就是程序根
$roots += (Split-Path -Parent $dataHome)

function Test-AppRoot([string]$dir) {
    if (-not $dir) { return $false }
    return (Test-File ($dir + '\app\main.js')) -and (Test-File ($dir + '\package.json'))
}

$petDir = $null
$electron = $null
foreach ($candidate in $roots) {
    $candidate = ([string]$candidate).Trim()
    if (-not (Test-AppRoot $candidate)) { continue }
    $exe = $candidate + '\node_modules\electron\dist\electron.exe'
    if (Test-File $exe) {
        $petDir = $candidate
        $electron = $exe
        break
    }
}

# 找不到就安静退出：不要弹窗打扰用户，也不要启动半截
if (-not $petDir) { return }

__WAIT_BLOCK__

# 重复启动由挂件的单实例锁兜底，这里不需要额外判断
Start-Process -FilePath $electron -ArgumentList $petDir -WorkingDirectory $petDir
'@

$bootstrapBody = $bootstrapTemplate.Replace('__APP_ROOT__', $AppRoot).Replace('__DATA_DIR__', $DataDir).Replace('__WAIT_BLOCK__', $waitBlock)
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
Write-Utf8Bom -Path $bootstrapPath -Content $bootstrapBody

Remove-LegacyShortcuts

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $bootstrapPath)
$shortcut.WorkingDirectory = $DataDir
$shortcut.WindowStyle = 7
$shortcut.IconLocation = ('{0},0' -f $electron)
$shortcut.Save()

Save-State -Enabled $true -Wait ([bool]$WaitMimo)

Write-Host '已设置开机自启'
Write-Host ("  启动项:   {0}" -f $lnkPath)
Write-Host ("  引导脚本: {0}" -f $bootstrapPath)
Write-Host ("  安装目录: {0}" -f $AppRoot)
if ($WaitMimo) { Write-Host '  模式: 检测到 MiMo 桌面端后再启动（最多等 10 分钟）' }
exit 0
