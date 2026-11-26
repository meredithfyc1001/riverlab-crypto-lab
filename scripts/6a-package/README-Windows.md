# RiverLab Crypto Lab · Phase 6A Windows 验收包

本包供 Windows x64 用户在独立测试环境试用桌面壳。使用测试样本。构建没有正式发行签名；可在 `build-info.json` 查看所属 Draft PR 提交、制品字节数、SHA-256 和 Authenticode 检查结果。

1. 用 PowerShell 的 `Get-FileHash -Algorithm SHA256 <ZIP路径>` 检查收到的 ZIP，与 Actions 附带的 `.sha256` 对照，再解压到含中文和空格的目录。
2. 在已安装 Microsoft Edge WebView2 Evergreen Runtime 的 Windows 11 x64 设备上双击 `RiverLab-6A-x64-setup.exe`，以当前用户安装，再通过安装生成的入口打开应用。也可从解压目录直接启动 `riverlab-6a.exe`。桌面应用运行无需安装 Node.js；此包依赖机器上已有的 WebView2。
3. 使用内置样本打开研究工作台，按本提交的 Phase 6A 验收说明执行功能与离线检查。测试数据与浏览器版分开记录。本包用于验证原型，用户原历史库保留在原浏览器中。
4. 记录 Windows 和 WebView2 版本、所用入口、结果及错误现象。Windows CI 的证据与人工实机记录分别保存。
