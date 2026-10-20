@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Orbit Node Execution Worker
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required.
  pause
  exit /b 1
)
if not exist "node_modules\qrcode" (
  call npm install
  if errorlevel 1 goto failed
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto failed
)
echo Orbit Node worker: http://127.0.0.1:4786
echo Existing FastAPI app mounts orbit_control.create_router at /orbit
echo The PC management console is served by FastAPI, not by a separate chat app.
set ORBIT_OPEN_BROWSER=0
node server/index.js
pause
exit /b 0
:failed
echo Setup failed.
pause
exit /b 1
