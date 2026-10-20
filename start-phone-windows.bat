@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo Node.js 22 or higher is required.
 pause
 exit /b 1
)
set ORBIT_OPEN_BROWSER=phone
node server/index.js
pause
