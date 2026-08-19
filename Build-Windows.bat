@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Build Khaos Nexus Desktop

set "MIN_NODE_MAJOR=22"
set "NODE_READY=0"

echo ==================================================
echo   Build Khaos Nexus Windows Installer and Portable App
echo ==================================================
echo.

call :detect_node
if "%NODE_READY%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\bootstrap-node.ps1" -MinimumMajor %MIN_NODE_MAJOR% -ProjectRoot "%CD%"
  if errorlevel 1 goto :failed
  call :load_private_node
  call :detect_node
)
if "%NODE_READY%"=="0" goto :failed

call npm install --no-audit --no-fund
if errorlevel 1 goto :failed
call npm test
if errorlevel 1 goto :failed
call npm run check
if errorlevel 1 goto :failed
call npm run dist:win
if errorlevel 1 goto :failed

echo.
echo Build complete. Open the dist folder for the installer and portable executable.
explorer "%CD%\dist"
pause
exit /b 0

:load_private_node
if exist "%CD%\.runtime\node-path.txt" (
  set /p "NODE_HOME="<"%CD%\.runtime\node-path.txt"
  if defined NODE_HOME set "PATH=!NODE_HOME!;!PATH!"
)
exit /b 0

:detect_node
set "NODE_READY=0"
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if defined NODE_MAJOR if !NODE_MAJOR! GEQ %MIN_NODE_MAJOR% set "NODE_READY=1"
if "%NODE_READY%"=="0" call :load_private_node
if "%NODE_READY%"=="0" (
  for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
  if defined NODE_MAJOR if !NODE_MAJOR! GEQ %MIN_NODE_MAJOR% set "NODE_READY=1"
)
exit /b 0

:failed
echo.
echo Build failed. Review the output above.
pause
exit /b 1
