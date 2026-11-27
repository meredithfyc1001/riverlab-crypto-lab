@echo off
call "%~dp0start-local.bat" --snapshot %*
exit /b %errorlevel%
