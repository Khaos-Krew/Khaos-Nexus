@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Khaos Nexus Bot Manager Setup

set "MIN_NODE_MAJOR=22"
set "NODE_READY=0"

echo ==================================================
echo   Khaos Nexus Bot Manager - One-Click Setup
echo ==================================================
echo.
echo This setup can download a private Node.js LTS runtime.
echo It does not require administrator access or change your system Node.js.
echo.

call :detect_node
if "%NODE_READY%"=="0" (
  echo Preparing the included Node.js runtime installer...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\bootstrap-node.ps1" -MinimumMajor %MIN_NODE_MAJOR% -ProjectRoot "%CD%"
  if errorlevel 1 goto :node_failed
  call :load_private_node
  call :detect_node
)

if "%NODE_READY%"=="0" goto :node_failed

echo Using Node.js:
node --version
echo Using npm:
call npm --version
if errorlevel 1 goto :node_failed

echo.
if not exist node_modules (
  echo Installing application dependencies for the first launch...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :dependency_failed
) else (
  echo Dependencies are already installed.
)

echo.
echo Starting Khaos Nexus Bot Manager...
call npm start
if errorlevel 1 (
  echo.
  echo The manager stopped with an error. Review the output above.
  pause
)
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

:node_failed
echo.
echo Node.js setup could not finish.
echo Check your internet connection and try Install-and-Run.bat again.
echo No Discord token or server password was accessed.
pause
exit /b 1

:dependency_failed
echo.
echo Dependency installation failed. Check the message above and run this file again.
pause
exit /b 1
