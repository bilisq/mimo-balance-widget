@echo off
rem MiMo Balance Widget launcher.
rem ASCII only on purpose: cmd.exe reads .bat/.cmd with the system code page,
rem so non-ASCII text here would be mojibake on some machines.
rem pushd (instead of cd /d) so that a UNC share as install location still works:
rem cmd maps it to a temporary drive for the duration of this script.
setlocal
pushd "%~dp0"

rem %~dp0 always ends with a backslash. Passing "...\dir\" as an argument makes
rem CommandLineToArgvW treat that backslash as escaping the closing quote, so the
rem child process receives a path with a stray quote and cannot find the app.
rem Strip it before use - this bit is easy to lose in a rewrite.
set "PETDIR=%~dp0"
if "%PETDIR:~-1%"=="\" set "PETDIR=%PETDIR:~0,-1%"

set "ELECTRON=%PETDIR%\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" goto needruntime
if not exist "%PETDIR%\app\main.js" goto badpath

:launch
start "" "%ELECTRON%" "%PETDIR%"
popd
exit /b 0

:needruntime
echo.
echo [MiMo] Electron runtime not found - it is required to start the widget.
where npm >nul 2>&1
if errorlevel 1 goto guidance

rem Node.js is present, so installing is one step away. Ask instead of only
rem printing instructions: a bare "run setup.cmd -InstallDeps" message looks
rem like a failure to most people and they stop there.
echo.
echo [MiMo] Node.js found. Install the runtime into this folder now?
echo [MiMo] Press Enter to install (a few minutes), or N to see manual options.
set "ANSWER="
set /p "ANSWER=  > "
if /i "%ANSWER%"=="n" goto guidance
echo.
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PETDIR%\setup.ps1" -InstallDeps
if not exist "%ELECTRON%" goto guidance
goto launch

:guidance
echo.
echo [MiMo] Showing setup options:
echo.
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PETDIR%\setup.ps1"
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
if "%SETUP_EXIT%"=="2" (
  echo [MiMo] Cannot start yet. Follow option A or B above, then run start.cmd again.
) else (
  echo [MiMo] Setup did not finish successfully. Please read the messages above.
)
popd
pause
exit /b 1

:badpath
echo [MiMo] Cannot find app\main.js under: %PETDIR%
echo [MiMo] The folder looks incomplete or was moved. Re-extract the package and try again.
popd
pause
exit /b 1
