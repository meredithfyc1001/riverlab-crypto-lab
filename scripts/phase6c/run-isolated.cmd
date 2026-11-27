@echo off
setlocal
set "PYTHONUTF8=1"
pushd "%~dp0" || exit /b 1
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3 -B scripts\phase6c\package_test_kit.py run
goto done
:usepython
python -B scripts\phase6c\package_test_kit.py run
:done
set "rc=%errorlevel%"
popd
exit /b %rc%
