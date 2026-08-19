@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [Nexus QA] Node.js was not found in PATH.
  echo Install the project prerequisites, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [Nexus QA] npm was not found in PATH.
  echo Install the project prerequisites, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [Nexus QA] Dependencies are missing. Installing the locked dependency set...
  call npm ci
  if errorlevel 1 (
    echo [Nexus QA] Dependency installation failed.
    pause
    exit /b 1
  )
)

set "QA_MODE=quick"
if /I "%~1"=="full" set "QA_MODE=full"

echo [Nexus QA] Running %QA_MODE% validation...
node scripts\qa.cjs %QA_MODE%
set "QA_EXIT=%ERRORLEVEL%"

echo.
if "%QA_EXIT%"=="0" (
  echo [Nexus QA] PASS
) else (
  echo [Nexus QA] FAIL - see .validation\qa\latest.md
)

echo.
echo Tip: Run-QA.bat full runs the complete suite used by release validation.
pause
exit /b %QA_EXIT%
