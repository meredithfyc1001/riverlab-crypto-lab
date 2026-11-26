# RiverLab Crypto Lab · Phase 6A Windows 验收包

本包供 Windows x64 用户在独立测试环境试用桌面壳。使用测试样本。构建没有正式发行签名；可在 `build-info.json` 查看所属 Draft PR 提交、制品字节数、SHA-256 和 Authenticode 检查结果。

1. 用 PowerShell 的 `Get-FileHash -Algorithm SHA256 -LiteralPath '内层 ZIP 路径'` 检查收到的 ZIP，与 Actions 附带的 `.zip.sha256` 对照。解压到含中文和空格的目录，在该目录运行 `Get-FileHash -Algorithm SHA256 -LiteralPath '.\RiverLab-6A-x64-setup.exe','.\riverlab-6a.exe'`，逐项与 `SHA256SUMS.txt` 核对，并记录 `build-info.json` 的源提交。
2. 在已安装 Microsoft Edge WebView2 Evergreen Runtime 的 Windows 11 x64 设备上双击 `RiverLab-6A-x64-setup.exe`，以当前用户安装，再通过安装生成的入口打开应用。也可从解压目录直接启动 `riverlab-6a.exe`。桌面应用运行无需安装 Node.js；此包依赖机器上已有的 WebView2。
3. 从工作台首页点“打开桌面技术验证”，再点“运行验证”。使用内置合成行情检查中文、红绿 K 线、各类 Worker 和 50,000 根研究；预期 100,000 次求值、2,082 笔已平仓交易、实际两路候选。串行和并行的完整结果 SHA-256 均为 `e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b`。
4. 在新 Windows 测试账户的“下载”目录放置合成占位文件 `riverlab-6a-synthetic-50000.json`，记录其 SHA-256。若已有同名文件，只记录其摘要。点“下载合成研究报告”两次，每次等待页面显示保存结果。安装版和独立 EXE 会将报告直接保存到系统“下载”目录，同名时保留原文件并另取编号文件名。按页面所示实际路径，对两份新文件分别运行 `Get-FileHash -Algorithm SHA256 -LiteralPath '实际报告路径'`，与这次页面的 `downloadSha256` 对照，再核对占位文件原 SHA-256。在测试账户中分别重复占位文件被独占、下载目录拒写两个情形，记录成功文件名或失败原因；恢复写入权限后重试。
5. 点“验证事务、备份与恢复”，核对 `status` 为 PASS，提交、回滚后、恢复后各为一行，`integrityCheck` 为 ok。在 Windows 深色模式下检查技术验证页及 11 个工作台页面的正文、次级文字、禁用标签和提示，并记录最低实测比值。普通文字至少 4.5:1，大文字和传递信息的图形至少 3:1。保留实际 Windows / WebView2 版本、显示缩放、实测比值和错误原文。安装版与独立 EXE 分别记录 PASS / FAIL / BLOCKED / NOT TESTED。
6. 退出并重启后独立复测。原型使用独立目录，请只使用合成数据。物理断网仍由用户决定，暂缓测试。缺失或低于 120 的 WebView2 应在原生中文窗口给出安装指引；完整离线运行时须另备微软官方 Evergreen Standalone Installer。正式最低支持版本由真机覆盖决定。
