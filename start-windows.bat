@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Orbit AI Assistant - Windows
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22+ is required. https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\qrcode" (
  echo [1/3] Installing packages (first launch only)...
  call npm install
  if errorlevel 1 goto failed
)
echo [2/2] Orbit operator starting at http://127.0.0.1:4786
set ORBIT_OPEN_BROWSER=1
node server/index.js
pause
exit /b 0
:failed
echo [ERROR] Setup failed. Check network and Node.js installation.
pause
exit /b 1
