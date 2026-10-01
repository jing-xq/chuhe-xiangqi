@echo off
title 象棋教学
cd /d "%~dp0"
echo 正在启动象棋教学服务器...

rem 端口 8000 已有服务在监听（上次的服务还在跑）就不重复启动，直接打开页面
netstat -ano | findstr ":8000" | findstr /i "LISTENING" >nul
if not errorlevel 1 goto open

rem 起一个最小化窗口跑服务器；python 不在时自动换 py 启动器；
rem 若两者都失败，窗口会停在报错画面（不再一闪而过）
start "象棋教学服务器" /min cmd /c "python tools\serve.py 8000 || py tools\serve.py 8000 & echo. & echo [服务器已退出] 请把上方报错截图反馈；按任意键关闭本窗口... & pause >nul"

rem 等服务就绪（最多约 5 秒），起不来就停在提示上
set /a tries=0
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":8000" | findstr /i "LISTENING" >nul
if not errorlevel 1 goto open
set /a tries+=1
if %tries% geq 5 goto fail
goto wait

:fail
echo.
echo [启动失败] 服务器没有起来。请看任务栏「象棋教学服务器」窗口里的报错信息。
pause
exit /b 1

:open
start "" "http://127.0.0.1:8000/"
echo.
echo 软件已在浏览器打开：http://127.0.0.1:8000/
echo 服务器在任务栏的「象棋教学服务器」最小化窗口里，关闭它即停止服务。
timeout /t 4 >nul
