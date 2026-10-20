# Phase 2C 实现复核

本轮保留2A/2B数据契约、策略版本、下一根开盘成交、保护跳空/双触发stop-first、根内时间未知、费用/数量/18位BigInt账本。原identity的ASCII字节转换与分块SHA做等价性能优化；38,603,435字节人工报告优化前后hash同为414b0787438b8b827f1e8d9a732f76c2f13885930dbe7fce011328b6da6044bc，规范JSON、字节和SHA定义未改。

## 模块及正确性复核

- UI只调用公开normalizeConfig/normalizeStrategy/normalizeRisk，app经Worker调用原runBacktest；没有React交易计算。core/statistics以原名义额/费用/收盘账本计算成本与指标，不重新模拟正式策略。
- 独立Python Decimal90参考含两次完整平仓和一笔未平仓、100bps双边费及滑点：净盈亏15.592、已实现7.602、浮动7.99、费用7.208、末权益1015.592；同本金/区间基准末权益1078.3256543151。参考不调用TS。回撤另以手工权益序列和参考峰值核验；成本部分退出与最后1e-18余数覆盖。
- 报告保存完整dataset快照、manifest、全部实际信号/成交/收盘账本、统计及版本/定义。Optional undefined元信息在JSON边界明确省略；行情复制为独立快照，账本不重复JSON克隆；重开校验payload hash并从快照重算比对，版本不支持/损坏报错。
- IndexedDB事务适配器从原数据存储抽出；原数据库名称/版本/两个store不变。实验用独立数据库、add创建新记录，禁止覆盖；complete才成功，abort/同步抛错均拒绝。配额/策略为异常注入，未声称物理磁盘耗尽实测。
- React检查应用[react-best-practices技能](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)：无条件Hooks、异步generation隔离、卸载/取消终止Worker且reject promise，图表卸载remove，结果大表每页50笔，全点图表序列间让出。只对Worker显示取消，DB提交期间不误报取消。labels/状态/错误与有名账本表；组件不反向依赖兄弟feature。
- 结果图表仅绘制边界转Number，精确金额和比例仍在表格/JSON。主题与窄屏结果状态均验证；不以隐藏全页面溢出代替容器修复。

## 测试包复核

ZIP仅复制Vite dist与必要server/BAT/说明/身份/校验文件，无node_modules、开发缓存、.env、用户数据或非必要源码。ZIP使用内置模块生成，Windows用系统Expand-Archive独立解压，逐文件SHA256验证。build-info保存完整git HEAD和dirty标记，CI拒绝dirty。质量三组全部成功后才启动Windows打包job；Chrome及Edge从含中文空格路径运行解压产物，通过后才上传14天artifact。

server仅listen127.0.0.1、Host限定127.0.0.1:端口、GET/HEAD、dist内已枚举文件/扩展白名单、decode后路径段与realpath根内检查；无上传/代理/数据API。CSP限本机，禁止外部脚本/网络/字体。Enter关闭所有连接并退出，端口可重新绑定；占用/缺dist明确失败，BAT保留错误窗口。WindowsCI额外读取实际监听地址，核对仅127.0.0.1。自动浏览器打开失败可复制URL；自动打开本身不等同用户双击验收。

## 证据与剩余边界

实际执行/失败/未执行以[progress](../progress.md)及对应原日志为准。第一次大报告哈希导致5秒断言失败，等价优化后原阈值通过；没有删除断言/skip或放宽阈值。旧占位页测试更新到已实现配置/实验，原导航/风险/无账户/数据/图表/成交回归保留。

数据上限50,000根；全量报告的克隆、存储和绘图仍占主线程/内存，Worker并非无限/流式方案。报告可能数十MB，请备份与注意浏览器配额。完整性/来源和Number原精度无法认证；流动性与根内路径为模型假设。暴露为区间上界；CAGR无量纲近似。自动化只拦截非本机origin，物理断网、用户设备/受管策略、真实磁盘耗尽及异常断电恢复未由CI代签。用户Windows清单仍未执行，不宣称M2最终用户验收通过；无Release、公开部署或合并。
