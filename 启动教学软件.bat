@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动象棋教学服务器...
start "象棋教学服务器" /min python "%~dp0tools\serve.py" 8000
timeout /t 2 >nul
start "" "http://127.0.0.1:8000/"
echo.
echo 软件已在浏览器中打开： http://127.0.0.1:8000/
echo 关闭服务器：在任务栏找到“象棋教学服务器”窗口关掉即可。
timeout /t 5 >nul
