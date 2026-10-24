@echo off
rem MiMo Balance Widget setup wrapper (ASCII only on purpose: cmd.exe codepage)
setlocal
cd /d "%~dp0"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
exit /b %ERRORLEVEL%
