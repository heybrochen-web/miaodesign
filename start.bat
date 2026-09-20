@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   AI Game Asset Platform - Starting...
echo   地址: http://127.0.0.1:8787
echo   关闭此窗口即停止服务
echo ==============================================
start /b "" "C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" server.js
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787"
