@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 (
  echo 无法进入测试包目录。请先完整解压 ZIP。
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装系统 Node.js 24 LTS 后重试。
  popd
  pause
  exit /b 1
)
echo RiverLab Crypto Lab - 仅供学习研究，历史表现不代表未来表现
echo 服务仅绑定 127.0.0.1。关闭前按 Enter、q 再 Enter，或 Ctrl+C。
node "%~dp0server.mjs" %*
set "riverlab_exit=%errorlevel%"
popd
if not "%riverlab_exit%"=="0" (
  echo 启动失败。请阅读上方错误，确认 Node 24、端口及完整解压路径。
  pause
)
exit /b %riverlab_exit%
