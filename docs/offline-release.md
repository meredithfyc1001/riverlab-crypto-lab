# Windows 本地测试包与离线验收

V1.0 RC 通过 Draft PR 的 GitHub Actions 提供限期 Windows 测试包。安装 Node.js 24 后，解压内层 ZIP、核对 build-info 和逐文件摘要，双击 BAT 通过本机 HTTP 访问静态资源、分包和 Worker。通过备份恢复旧数据前，请核对实验的内嵌数据与算法版本。[包内操作说明](../scripts/local-test/README-local-test.md) · [备份恢复](rc-backup.md)

2026-11-25 用户 Windows Chrome 基线实测六项通过。物理断网由用户暂缓，状态为 NOT TESTED。当前候选的 Windows 包验证和用户实测采用单独的验收记录。[RC 清单](rc-acceptance.md)

## 源码开发验证

Node.js 24 且依赖已安装的本机运行 npm run build 和 npm run preview -- --port 4173 --strictPort，Edge/Chrome 打开本机地址。浏览器使用同源本机 HTTP 加载本地资源。

生产包 E2E 只允许本机 HTTP 源，阻止其他请求，检查无外部请求与控制台错误。这不证明操作系统断网、全新 Windows 安装、file:// 或单文件已验收。

不能直接双击 dist/index.html，原生 ES module 的 file:// 加载常受限制。当前无 Service Worker，停止本机服务后不能保证刷新。

## 早期发行方案比较（历史）

1. 静态目录配仅绑定 127.0.0.1 的便携服务/启动器：验证无开发工具启动、端口冲突、退出、中文/空格路径、版本身份。
2. 单 HTML：独立入口内联资源，避免外部模块；后续 Worker 要验证 Blob Worker、CSP、取消和资源释放，不能仅改 Vite base 就宣称完成。
3. PWA/桌面封装：有明确需求后选型，不使核心离线功能依赖联网。

正式发布前核对：Windows 两浏览器及版本、离线刷新、路径/权限、数据备份恢复、哈希清单、许可、使用/风险说明与回退。联网/服务范围变化前按原计划另行核查地区法规和平台条款；构建成功不等于获批发布。

## Phase 2C 本地测试 ZIP 增量

本轮授权并实现Node24（系统预装）前台静态服务与BAT生产测试包，仍不是file://、单HTML、嵌入运行时安装器、PWA、正式Release或公开部署。只监听127.0.0.1，原静态资源本地打包，无上传/遥测/远程行情。三平台质量及Windows ZIP验证全部成功后上传head SHA绑定artifact，14天有效。包内清单/停止/路径/失败说明见[README-local-test](../scripts/local-test/README-local-test.md)，后续各版实机执行状态见 [进度记录](../progress.md)。
