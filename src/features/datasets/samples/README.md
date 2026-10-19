# Phase 1A 样本来源

| 文件                        | 类型             | 用途                                                                 |
| --------------------------- | ---------------- | -------------------------------------------------------------------- |
| real-btcusdt-2024-10-28.csv | 真实历史来源存档 | Binance Spot BTCUSDT，2024-10-28，24 条 1h K 线，12 列、无表头、毫秒 |
| synthetic-ms.csv            | 人工合成         | DEMO/USDT，4 条 1min，毫秒                                           |
| synthetic-us.csv            | 人工合成         | 与上项同值，时间戳乘 1000；不是原生交易所 2025 微秒归档              |
| error-cases.csv             | 人工构造错误     | 重复、缺口、坏价格/量/OHLC/时间、列数错误，不是真实行情              |

## 历史存档

来源固定到 Freqtrade 提交 [3ce38b587d6c7a1ea479fb3e59d724dee5195561](https://github.com/freqtrade/freqtrade/commit/3ce38b587d6c7a1ea479fb3e59d724dee5195561) 下的 [spot-klines-BTCUSDT-1h-2024-10-28.zip](https://github.com/freqtrade/freqtrade/blob/3ce38b587d6c7a1ea479fb3e59d724dee5195561/tests/testdata/binance/binance_public_data/spot-klines-BTCUSDT-1h-2024-10-28.zip)。该存档对应 Binance Public Data 的 BTCUSDT 1h 日文件。

2026-10-19 在开发环境读取固定上游 ZIP，仅解压、去 BOM/统一 LF，保留全部 24 条记录和原始 12 列，无行情数值修改。原 ZIP 作为来源证据保存在 tests/fixtures，应用不提供 ZIP 导入能力。原始 CSV 已为 LF，因此解压前后 CSV 字节哈希相同。

完整元信息见 [provenance JSON](real-btcusdt.provenance.json)：上游提交/路径、原归档 URL、归档与 CSV SHA256、采集日期、变换说明和核验边界。SHA256：

- ZIP：744d4a991858208ead11e682457c452cd56067d113888d7323ba849ce221bc09。
- CSV：0cf21b6f475479a8b8918ed983e924cfce2057dde6ccd864aaa0d97fd14f9727。

可从固定上游 ZIP 解压 BTCUSDT-1h-2024-10-28.csv，用任意 SHA256 工具重验；不依赖当前交易所 API、登录或密钥。没有另外访问 Binance 域名或核对官方 CHECKSUM，因此这是可追溯的历史来源样本，不是独立真实性认证或无限制再分发授权。上游仓库代码 GPL-3.0 不自动决定交易所市场数据许可；对外分发时按原规划核查数据条款。

内置历史样本在 Worker 中校验 CSV 哈希，单元测试核验 ZIP/CSV 哈希与 24 行的 UTC 范围/原值。用户自选文件即使同名也标为“来源未核实”。以上样本不提供任何策略或收益结论。
