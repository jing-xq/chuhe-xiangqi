@echo off
setlocal
cd /d "%~dp0.."
echo ===== 本地全量回归：5 套无头测试 + 谱库校验 =====
set FAIL=0

node tools/test_opening_logic.js
if errorlevel 1 set FAIL=1

node tools/test_stability.js
if errorlevel 1 set FAIL=1

node tools/test_core_content.js
if errorlevel 1 set FAIL=1

node tools/test_import_corpus.js
if errorlevel 1 set FAIL=1

node tools/check_lessons.js
if errorlevel 1 set FAIL=1

python -B tools/build_openings.py --check
if errorlevel 1 set FAIL=1

echo ================================================
if "%FAIL%"=="1" (
  echo 结果：有测试未通过，见上方输出
) else (
  echo 结果：全部通过
)
pause
