#Requires -Version 5.1
<#
  打一个"自带 Electron 运行时"的便携包，给没有 Node.js 的电脑用。

  前置：本机已经通过 setup.cmd -InstallDeps 装好 Electron（node_modules\electron\dist）。
  产物：release\MiMo-Balance-Widget-<版本>-win-x64.zip
        解压后双击 start.cmd 即可，不需要 Node.js、不需要联网。

  用法：
    powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1
    powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -SkipZip   # 只准备目录
    powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -IncludeDocs
#>
[CmdletBinding()]
param(
    [string]$OutDir = '',
    [switch]$SkipZip,
    [switch]$IncludeDocs
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
$name = "MiMo-Balance-Widget-$version-win-x64"

$electronDist = Join-Path $root 'node_modules\electron\dist'
$electronExe = Join-Path $electronDist 'electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
    Write-Host '找不到 node_modules\electron\dist\electron.exe' -ForegroundColor Red
    Write-Host '请先在本机执行:  setup.cmd -InstallDeps' -ForegroundColor Yellow
    exit 1
}

if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stage = Join-Path $OutDir $name
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host ("打包 {0} ..." -f $name) -ForegroundColor Cyan

# ---- 1. 代码与脚本 ----
$items = @(
    'app',
    'python',
    'skill',
    'scripts',
    'artwork-nc',
    'package.json',
    'package-lock.json',
    'README.md',
    'LICENSE',
    'NOTICE.md',
    'CHANGELOG.md',
    'setup.ps1',
    'setup.cmd',
    'start.cmd'
)
if ($IncludeDocs) { $items += 'docs' }

foreach ($item in $items) {
    $source = Join-Path $root $item
    if (-not (Test-Path -LiteralPath $source)) {
        Write-Host ("  !!  跳过缺失项 {0}" -f $item) -ForegroundColor Yellow
        continue
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stage $item) -Recurse -Force
}

# 测试与缓存不进发布包
$dropList = @(
    (Join-Path $stage 'python\tests'),
    (Join-Path $stage 'python\whale\__pycache__'),
    (Join-Path $stage 'python\tests\__pycache__')
)
foreach ($path in $dropList) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# ---- 2. 启动器 exe（双击即用，不闪黑框）----
# 也可以在解压后的目录里随时重建：scripts\build-launcher.ps1
$launcher = Join-Path $root 'MiMoBalanceWidget.exe'
$launcherScript = Join-Path $PSScriptRoot 'build-launcher.ps1'
if (Test-Path -LiteralPath $launcherScript) {
    Write-Host '  编译启动器 MiMoBalanceWidget.exe ...' -ForegroundColor Cyan
    & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcherScript -OutFile (Join-Path $stage 'MiMoBalanceWidget.exe') | Out-Null
}
if (Test-Path -LiteralPath (Join-Path $stage 'MiMoBalanceWidget.exe')) {
    Write-Host '  OK 启动器已打包' -ForegroundColor Green
} else {
    Write-Host '  !!  启动器编译失败，包里只有 start.cmd' -ForegroundColor Yellow
}

# ---- 3. Electron 运行时（只带 dist，不带 npm 包其余部分）----
Write-Host '  复制 Electron 运行时（约 317 MB，需要一点时间）...' -ForegroundColor Cyan
$distTarget = Join-Path $stage 'node_modules\electron\dist'
New-Item -ItemType Directory -Path $distTarget -Force | Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $distTarget -Recurse -Force

# ---- 4. 校验 ----
$required = @(
    'node_modules\electron\dist\electron.exe',
    'node_modules\electron\dist\icudtl.dat',
    'node_modules\electron\dist\resources\default_app.asar',
    'app\main.js',
    'app\src\index.html',
    'python\whale\sidecar.py',
    'setup.ps1',
    'start.cmd'
)
$missing = @()
foreach ($rel in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $rel))) { $missing += $rel }
}
if ($missing.Count -gt 0) {
    Write-Host '打包结果缺少文件：' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host ("  - {0}" -f $_) }
    exit 1
}

# 发布包里不该出现本机数据
$forbidden = @('config.json', 'settings.json', 'cache.json', 'ledger.json', 'logs')
foreach ($rel in $forbidden) {
    $hit = Get-ChildItem -LiteralPath $stage -Recurse -Filter $rel -ErrorAction SilentlyContinue
    if ($hit) {
        Write-Host ("发现不该分发的文件：{0}" -f $hit[0].FullName) -ForegroundColor Red
        exit 1
    }
}

# ---- 5. 打包 zip ----
$sizeMb = [math]::Round(((Get-ChildItem -LiteralPath $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ("  目录已就绪：{0}（{1} MB）" -f $stage, $sizeMb) -ForegroundColor Green

if (-not $SkipZip) {
    $zipPath = Join-Path $OutDir ("{0}.zip" -f $name)
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Write-Host '  正在压缩（Electron 体积较大，可能需要几分钟）...' -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $zipMb = [math]::Round(((Get-Item -LiteralPath $zipPath).Length / 1MB), 1)
    Write-Host ("  完成：{0}（{1} MB）" -f $zipPath, $zipMb) -ForegroundColor Green
    Write-Host ''
    Write-Host '把这个 zip 传到 GitHub Release 即可，用户解压后直接双击 start.cmd。' -ForegroundColor DarkGray
} else {
    Write-Host '  （已跳过压缩）' -ForegroundColor DarkGray
}

exit 0
