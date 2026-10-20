@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo Node.js 22 or higher is required.
 pause
 exit /b 1
)
start "" "http://127.0.0.1:4786/phone"
node server/index.js
pause
