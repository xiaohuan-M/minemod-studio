@echo off
cd /d "%~dp0"
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<24||(major===24&&minor<5)){console.error('Node.js 24.5+ required');process.exit(1)}"
if errorlevel 1 goto failed
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
