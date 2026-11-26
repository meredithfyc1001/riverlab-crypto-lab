# RiverLab Crypto Lab · Phase 6A Windows 验收包

本包供 Windows x64 用户在独立测试环境试用桌面壳。使用测试样本。构建没有正式发行签名；可在 `build-info.json` 查看所属 Draft PR 提交、制品字节数、SHA-256 和 Authenticode 检查结果。

1. 用 PowerShell 的 `Get-FileHash -Algorithm SHA256 <ZIP路径>` 检查收到的 ZIP，与 Actions 附带的 `.sha256` 对照，再解压到含中文和空格的目录。
2. 在已安装 Microsoft Edge WebView2 Evergreen Runtime 的 Windows 11 x64 设备上双击 `RiverLab-6A-x64-setup.exe`，以当前用户安装，再通过安装生成的入口打开应用。也可从解压目录直接启动 `riverlab-6a.exe`。桌面应用运行无需安装 Node.js；此包依赖机器上已有的 WebView2。
3. 从工作台首页点“打开桌面技术验证”，再点“运行验证”。使用内置合成行情检查中文、红绿 K 线、各类 Worker 和 50,000 根研究；预期 100,000 次求值、2,082 笔已平仓交易、实际两路候选。串行和并行的完整结果 SHA-256 均为 `e3fb4410dc0bac12ca6dc1d108d4a6ae2f56107a47fc20bbda789469cbaf5d6b`。
4. 点“下载合成研究报告”，将 JSON 保存到含中文及空格的目录。对文件运行 PowerShell 的 `Get-FileHash -Algorithm SHA256 -LiteralPath '下载文件路径'` 并与本次页面的 `downloadSha256` 对照。点“验证事务、备份与恢复”，核对 `status` 为 PASS，提交、回滚后、恢复后各为一行，`integrityCheck` 为 ok。
5. 点“返回研究工作台”，逐页检查中文文字、图表缩放与显示。退出并重启后独立复测；在测试机断网时重复以上步骤。原型使用独立目录，请只使用合成数据。每组记录 PASS、FAIL 或未测，并附 Windows / WebView2 版本、显示缩放、实际 ZIP SHA、截图或错误原文。缺失或低于 120 的 WebView2 应在原生中文窗口给出安装指引；完整离线运行时须另备微软官方 Evergreen Standalone Installer。正式最低支持版本由真机覆盖决定。
