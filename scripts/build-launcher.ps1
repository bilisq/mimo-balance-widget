#Requires -Version 5.1
<#
  编译一个真正的启动器 exe：MiMoBalanceWidget.exe

  为什么不用 electron-builder：
  - 本项目的分发形态是"免安装目录 + 自带运行时"，不是 NSIS 安装包；
  - electron-builder 需要额外下载 NSIS/winCodeSign（几十 MB），且产物未签名会触发 SmartScreen。
  这个启动器只做一件事：双击后找到同目录的 electron.exe 并启动，不闪黑框。

  依赖：Windows 自带的 .NET Framework 4.x（csc.exe），不需要联网、不需要 SDK。
  用法：
    powershell -ExecutionPolicy Bypass -File scripts\build-launcher.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-launcher.ps1 -OutFile <目录>\app.exe
#>
[CmdletBinding()]
param(
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'launcher\Program.cs'
if (-not (Test-Path -LiteralPath $source)) { throw "找不到源文件：$source" }
if (-not $OutFile) { $OutFile = Join-Path $root 'MiMoBalanceWidget.exe' }

$cscCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
    Write-Host '找不到 csc.exe（.NET Framework 4.x）' -ForegroundColor Red
    Write-Host 'Windows 10/11 默认自带；若被精简请安装 .NET Framework 4.8 后重试' -ForegroundColor Yellow
    exit 1
}

# /win32icon 需要 .ico；仓库里只有 png，所以默认不带图标（资源管理器中显示为默认程序图标）
$cscArgs = @(
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    '/codepage:65001',
    "/out:$OutFile",
    '/reference:System.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    $source
)

Write-Host ("  编译器: {0}" -f $csc)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host '编译失败' -ForegroundColor Red
    exit 1
}

$size = (Get-Item -LiteralPath $OutFile).Length
Write-Host ("  已生成: {0} ({1} KB)" -f $OutFile, [math]::Round($size / 1KB, 1)) -ForegroundColor Green

# 不在脚本里自动跑 --check：GUI 子系统程序的 stdout 在部分宿主里拿不到（退出码也会丢）。
# 需要自检时手动执行：  .\MiMoBalanceWidget.exe --check
$electronExe = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (Test-Path -LiteralPath $electronExe) {
    Write-Host '  当前目录已有 Electron 运行时，双击即可启动' -ForegroundColor Green
} else {
    Write-Host '  当前目录没有 Electron 运行时：便携包里会自带；源码方式请先跑 setup.cmd -InstallDeps' -ForegroundColor Yellow
}
exit 0
