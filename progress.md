# RiverLab Crypto Lab 进度

## 当前恢复入口：Phase 3 待审（2026-11-09）

用户明确授权“启动 Phase 3 设计与开发”。main仍为PR#6合并33b1d669；PR#7独立分支交付，不自动合并、Release或部署。原规划/成交/策略/风险/统计/18位账本均未修改。新增core/research、专用Worker、策略中心比较/网格/split/rolling、JSON校验重算与CSV摘要；窗口独立重置，不自动选优、不拼接收益。见[设计](docs/phase-3-design.md)和[验收清单](docs/phase-3-acceptance.md)。

已验证实现快照85e933affc06c906fb8b0de402c4d63ddad8aa25：[run42614794507](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42614794507)四作业completed/success，已实际读取三组质量及WindowsZIP完整日志。每平台npm ci、format/lint、316项Vitest、严格core/app/test类型、生产构建、30项E2E全部通过，原307/24回归保留。三个独立Python参考也通过。

| 平台            | 浏览器        | CPU / 逻辑核                        | 50k三策略墙钟ms | 主线程最大观察间隔ms |
| --------------- | ------------- | ----------------------------------- | --------------- | -------------------- |
| Ubuntu Chromium | 156.0.8078.4  | AMD EPYC 7763 64-Core Processor / 2 | 7214            | 134.8                |
| Windows Chrome  | 156.0.8078.80 | AMD EPYC 7763 64-Core Processor / 2 | 4752            | 171.4                |
| Windows Edge    | 156.0.4314.58 | AMD EPYC 9V74 80-Core Processor / 2 | 4121            | 141.3                |

Node24.22.2；Ubuntu内核7.0.0-1019-azure，Windows10.0.26100。阈值20秒/1000ms均通过；只代表这些CI机器及50k人工合成样本，不承诺所有资源预算组合耗时。完整机器/版本/限制见[证据JSON](docs/phase-3-evidence.json)。生产主JS约501kB（gzip164kB）有Vite默认体积提示，未提高告警阈值；现有性能门槛全部通过。

WindowsZIP job129153773186：Chrome156.0.8078.80、Edge156.0.4314.58，真实中文空格路径解压、BAT前台127.0.0.1启动、HTTP/Worker/图表、旧回测保存重开/导出、新研究批次和JSON/CSV、无外部origin请求/无页面错误、路径穿越/Host/POST拒绝、端口冲突与缺dist失败、Enter停止释放端口均通过。归档包artifact13672092574属于85e933a，内层630576bytes，SHA256为0871376b7e3c7e2222b876aa5cd2ed5e008b1a51b2edcbf85014acef1e9187c2，至北京时间2026-11-23 20:17:07。它是已验证快照；之后补上JSON导入“完成时间不能晚于当前时间”的入口校验及测试，并归档记录，最新PR提交必须重新完整CI。**下载以PR#7说明绑定当前完整headSHA的最新成功artifact为准，不把此归档包当最新。**

失败保留：run42614089752（8321a96）14个新增文件格式失败，独立Decimal通过；按只读诊断提交Prettier结果。run42614354882（8a83342）三组316项测试通过，严格类型因报告literal拓宽及测试直接修改readonly Candle失败；改为类型化报告payload与替换完整Candle对象，原断言未删除/跳过，未放宽阈值。run42614794507修正后完整成功。最后归档run42616047702（6dae708）仅新证据JSON短数组和进度表格格式失败，按同一只读诊断格式化后重新提交，未更改检查门槛。最后导入时间校验增加1项核心测试，预期317项，以后续实际CI为准。

当前云执行环境配置失败，exec_command实际不可用；本机npm ci/check未执行，不把GitHubCI写成本机执行。通过GitHub树/提交API仅写独立分支，读取真实CI日志；内容只读的格式诊断不修改checkout或绕过check。Windows用户实机/物理断网待反馈，合并和CI都不补签此前验收。

后续先由用户下载最终当前head包、按清单在Windows常规浏览器验证和反馈，再决定合并。按原规划下一阶段为Phase4历史回放，范围须单独确认。

## Phase 2C 合并后交接记录（2026-11-09，随后用户已授权Phase3）

- 已通过 GitHub 核实 PR #6 merged=true，合并提交为 `33b1d6695ca1115efefce59132d96f8534c43e72`，合并时间北京时间 2026-11-09 19:36:50；main 当前正是此提交。下方“Draft 待审”等文字属于当时的历史记录。
- 本轮用户要求继续；先完成合并状态、下载包与 Windows 验收交接。当时向用户询问Phase3范围；用户随后明确授权“启动 Phase 3 设计与开发”，见当前Phase3记录。
- 2026-10-20 的 artifact 已于 2026-11-03 到期，旧运行 artifact 列表现为空。合并已自动触发 [main CI run 42610440364](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364)，无需重复触发或修改代码以重建旧包。
- Ubuntu Chromium：job 129137160598，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 2764ms，最大主线程间隔 219.2ms；Intel(R) Xeon(R) 6975P-C / 2 逻辑核，浏览器 156.0.8078.4。
- Windows Chrome：job 129137160463，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 2677ms，最大主线程间隔 231.3ms；AMD EPYC 9V45 96-Core Processor / 2 逻辑核，浏览器 156.0.8078.80。
- Windows Edge：job 129137160153，已读日志确认 307 项 Vitest、24 项 E2E 全部通过；50,000 根 3574ms，最大主线程间隔 317.9ms；INTEL(R) XEON(R) PLATINUM 8573C / 2 逻辑核，浏览器 156.0.4314.58。
- Windows ZIP job 129138532233 已 completed/success，已读完整日志：Node v24.22.2，Windows Chrome 156.0.8078.80 / Edge 156.0.4314.58，真实解压到中文空格路径、BAT前台启动、HTTP资源/回测/保存重开/JSON与CSV、0外部请求/0页面错误、路径/方法/Host拒绝、端口占用/缺dist失败和Enter退出均成功。
- [新的 main ZIP artifact](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/42610440364/artifacts/13670985121) 已生成，完整SHA为 `33b1d6695ca1115efefce59132d96f8534c43e72`，expired=false，保留14天，至北京时间2026-11-23 19:41:32。内层ZIP 569520 bytes，SHA-256：`5c223439630cf093899c545f76f4a36beda393a3e001f5bd8748a11e211c9b99`。外层含内层ZIP、校验清单及双浏览器证据；不创建正式Release。
- 当前执行环境显示启动失败；shell 实际返回“No usable execution environment”，因此本轮本机 npm ci/check 未执行，也未读取或改写用户本地工作区。通过 GitHub 连接以已确认 main 的不可变内容创建独立文档分支，初始交接提交范围仅Markdown，随后明确授权Phase3功能开发；CI与此前本机结果分列。
- PR #6 的合并不证明用户 Windows 验收通过。本轮未收到逐项结果或版本，清单标为待反馈；历史“未测试/未执行”保留当时事实，不补签。
- 本轮不直接修改 main，不自动合并文档 PR，不创建正式 Release 或公开部署；18 位账本、成交时序、策略/统计版本和所有回归保持原样。

## Phase 2C 历史恢复入口（2026-10-20）

- 初始工作区干净。已 fetch main，GitHub确认PR #5 merged=true，实际合并SHA为0ee6d8483bd6a5226a6d01a1d21b990b134bab46；从该提交建立feat/phase-2c-backtest-workbench。已创建Draft PR #6，不修改main或自动合并。
- 完整阅读AGENTS、plan、progress、README、原始规划、2A/2B设计和现有数据/策略/成交/账本/存储接口。已向用户汇报实施计划、选型、风险及验收标准。
- 2B最终CI run39284322892：已实际读取Ubuntu Chromium118165850327、Windows Chrome118165850402、Windows Edge118165850114日志，各256项Vitest/17项E2E通过，npm ci/check成功。这补充旧排队记录；不替代用户1B/2A/2B Windows未测事实。
- 初次git fetch因沙箱无法连proxy失败，受支持network权限后成功；未修改代理。2C测试尚在实施，不预记通过。

## Phase 2C 实施与验证事实

- 已实现core/statistics、core/experiments、Worker运行/校验/导出、React配置/结果/实验、复用IndexedDB事务适配器的独立实验库、Node24回环静态服务/BAT/ZIP与三平台后置打包CI。原成交规则/策略版本未改；identity只有ASCII字节填充的等价性能优化，SHA保持一致。
- npm ci首次259包通过；新增统计首轮10通过/8失败，因年化测试修改共享fixture解析配置，改为复制后复验18/18通过。实验首轮3通过/10失败：质量issue的optional undefined不是规范JSON；在报告边界明确JSON快照后31/31通过，未删断言。新增精度余数后合计288项（原256+32）。
- 初期typecheck失败（图表callback隐式any，Testing Library不支持exact选项）、lint失败（导出非组件函数/捕获错误cause/ref清理警告）均按严格规则修正。原日志保留。一次工作流文件名误写quality.yml未找到，已改实际ci.yml；不影响现有workflow。首次打包在沙箱内execFileSync git报EPERM，受支持network执行后通过，未改代理或凭据。
- 第一次浏览器命令在构建尚未完成时启动，随后中止（退出130，未记通过）。策略选择getByLabel精确定位超时，改为combobox角色，MA专项1/1通过；首次专项grep锚点不匹配为0项执行，不记通过。
- 三策略/存储异常4项通过时，50,000根默认5秒等待未通过；独立剖析：引擎1585ms、统计271ms、JSON393ms、38,603,435字节报告哈希3647ms。改ASCII字节填充避免字符迭代临时数组后哈希1008ms、原报告SHA完全相同。浏览器原阈值复验通过3851ms/最大定时器间隔321.6ms，没有放宽断言或超时。
- 初次完整check：288项Vitest通过、23项E2E通过/1项失败，保护事件断言误选图表内部layout table；已给账本与事件表明确可访问名，保留原内容断言。截图复核发现结果容器横向溢出，修正grid min-width/容器宽度/表格滚动，增加已打开结果在390px和浅色主题下的断言；没有隐藏全页面溢出。
- 布局修正后完整check退出0：14文件/288项Vitest、24项E2E（原17+7）、格式/lint/独立core/app/test严格类型与生产构建全部通过，无失败或跳过。50,000根实际MA策略8331笔成交的全点结果就绪3743ms，最大主线程定时器间隔285.1ms；Linux6.18.55、Node24.19.0、Chromium154.0.8037.57、AMD EPYC9V74，cgroup配额2CPU。测试的Desktop Chrome UA为模拟值，不将Windows UA视为Windows系统证据。
- 代码复核又纠正根项目版本更新误触的yocto-queue锁文件版本元信息（实际tarball与integrity未改、恢复0.1.0）；所有依赖精确版本不变。极小/极大图表刻度改科学计数避免长数值标签。随后重新执行最终npm ci/check，最终日志/CI状态在后续归档补充。
- 本机Linux开发dirty ZIP解压到中文空格路径、文件SHA、HTTP资源/实际Worker与图表、保存刷新重开/JSON/CSV、外部origin拦截（0请求）、路径穿越/POST/Host拒绝、端口占用失败、Enter退出释放端口、缺dist失败均通过。该包build-info明确dirty=true、基线SHA，仅开发证据，不冒充最终PR artifact；Linux未执行BAT，Windows实际BAT/Expand-Archive/Chrome/Edge由CI单列。
- 用户1B/2A/2B/2C Windows实机均未执行；2C新[验收清单](docs/phase-2c-acceptance.md)保持待签。无物理网卡断网、真实磁盘耗尽/断电/全部受管策略验证，origin拦截与异常注入不伪装成此类测试。限50,000根，完整报告可数十MB，Worker不消除全部克隆/绘图内存成本；浏览器存储不可靠，请JSON备份。

## Phase 2C 最终本机工程验证

- 最终 `npm ci --cache work/npm-cache` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check` 均退出0；288项Vitest、24项E2E及格式/lint/严格类型/构建全部通过，无失败/跳过。原256项核心/集成与17项浏览器回归保留（占位页断言升级为已实现功能，风险/无账户约束保留）。[最终原日志](docs/phase-2c-evidence/local-final-check.log)、[npm ci](docs/phase-2c-evidence/npm-ci.log)。
- 最终50,000根实际回测3775ms，主线程定时器最大间隔292.3ms；机器/浏览器同上。原5秒结果等待、20秒就绪预算、1秒主线程间隔阈值全部保留。数据为人工合成，不是行情速度/无限数据保证；未测浏览器总进程内存峰值。
- 独立Python Decimal90统计与2B Decimal100策略/风控参考均执行--check通过；原规划SHA与全部本地文档链接检查通过。依赖锁仅根项目版本0.2.0-test更新，依赖版本/完整性不改。
- 最终dirty开发ZIP与Linux smoke退出0，[原日志](docs/phase-2c-evidence/local-package-smoke.log)明确BAT未在Linux执行；1280px截图宽1280，结果页不再撑宽。服务原子退出与端口重绑、穿越/Host/方法拒绝、0外部请求/0页面错误及导出均已实际验证。
- 历次失败和性能剖析原日志在[证据目录](docs/phase-2c-evidence)，不把中止/0项/失败记为通过。设计边界与复核见[实现复核](docs/phase-2c-review.md)。
- 工程将提交独立Draft PR #6，三平台与Windows ZIP CI尚待这个实际提交运行，未提前声明通过；最终下载artifact须与PR实际head SHA一致。用户Windows实机未验收，待本人按清单下载执行，不自动合并。

## Phase 2C 首次跨平台CI与性能修正

- [PR #6](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6)已创建，open/draft；工程提交10ae07aeaa9a7938fe7931e281c3f1e1d68542e9，main仍为0ee6d8483bd6a5226a6d01a1d21b990b134bab46，未合并/发布/部署。该提交clean本机ZIP已验证SHA身份、dirty=false并通过Linux烟测。
- 首轮[CI run39371336286](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39371336286)：已读取三组实际日志。Ubuntu Chromium job118459651304成功，288/24通过，50,000根4207ms/最大间隔330ms；Windows Chrome118459651465、Edge118459651046均288项Vitest通过、23项E2E通过/1项失败，唯一失败均为50,000根回测的默认5000ms结果等待。不是排队或用户验收成功。ZIP后置job118460470469按规则skipped，未上传ZIP。Windows两组[原始失败日志](docs/phase-2c-evidence)保留。
- 继续优化而不放宽任何等待/性能阈值：SHA对相同规范JSON分块计算，加入Unicode/64KiB边界/非JSON输入的Node SHA等价测试；报告只规范化必要元信息并复制行情，避免对整份账本重复stringify/parse，保留完整结果和运行输入快照。新增输入快照隔离回归，307项Vitest和24项E2E在本机完整通过；50,000根3348ms/最大间隔196.6ms。继续将基准每根市值直接按既定18位floor规则计算，保留派生权益上限，避免五个不用的快照字符串格式化后再解析。
- 上述优化不删测试、不截断/降采样、不放宽阈值，不改成交/保护规则或hash定义。将对实际新提交重新运行三平台并验证Windows ZIP，尚未预记为通过。

性能修正后最终本机完整check退出0：15文件/307项Vitest、24项E2E全部通过，无失败/跳过；50,000根3430ms/最大主线程间隔251.3ms，[原日志](docs/phase-2c-evidence/local-performance-fixed-check.log)。Windows需实际新CI确认，尚未宣称通过。

## Phase 2C 三平台307/24通过与Windows ZIP启动修正

- 性能修正提交3106d0e796c8116af5762e3a9e41ecd81d26d2df的[run39372297528](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528)三平台质量job全部success。已逐一读取[Ubuntu118462640422](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640422)、[Chrome118462640513](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640513)、[Edge118462640624](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372297528/job/118462640624)完整日志，各307项Vitest、24项E2E，npm ci/check与独立参考全部通过，无测试失败/跳过。文本日志保存在docs/phase-2c-evidence/ci-*-quality.log。

| 实际平台          | 浏览器实际版本       | CPU                | 50,000根结果+图表就绪ms | 最大主线程间隔ms |
| ----------------- | -------------------- | ------------------ | ----------------------: | ---------------: |
| Ubuntu Linux6.17  | Chromium156.0.8078.4 | EPYC7763 / 2逻辑核 |                    5103 |            418.1 |
| Windows10.0.26100 | Chrome155.0.8059.40  | EPYC7763 / 2逻辑核 |                    5233 |            462.7 |
| Windows10.0.26100 | Edge154.0.4258.62    | EPYC9V74 / 2逻辑核 |                    3654 |            292.9 |

总耗时包含控件设置/Worker传输/全点绘图，结果消息的原5秒等待和总20秒预算、主线程1秒阈值均通过，未改测试阈值。仅人工合成样本，不是用户机器保证。

- 后置Windows ZIP job118463697212实际build/打包成功、dirty=false且SHA为3106d0e；真实Expand-Archive之后，Chrome测试在10秒启动READY等待处失败，未上传artifact。完整[失败日志](docs/phase-2c-evidence/ci-windows-package-initial-failure.log)保存。该失败不能记为Windows包启动成功。
- 复核CI通过cmd调用BAT时，增加windowsVerbatimArguments以保留既定外层/路径引号，避免Node对含中文空格的cmd命令再次转义；并转发子进程启动日志以保留失败原因。不修改用户BAT、原服务、等待阈值或断言。此修改提交后，全部质量与Windows ZIP仍需实际新CI核验；当前最终状态及下载以[PR #6 Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6/checks)及PR交付说明为准，不提前记成功。用户Windows实机仍未测试。

## Phase 2C 交付技术验证通过（Windows用户未验收）

- 提交a4198f2e6c7c3c265fa1abf8c6e612f476561fcf的[CI run39372868072](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372868072)四个job全部success。已读取三个质量job原始日志：Ubuntu118464406857、Windows Chrome118464406686、Windows Edge118464406775，各307项Vitest/24项E2E及npm ci/check/独立参考全部通过。50,000根到全点曲线就绪分别4675/4796/2896ms，主线程最大间隔355.6/385.9/256.8ms，原阈值保留。
- 已读取Windows ZIP job118465250033完整日志：[原日志](docs/phase-2c-evidence/ci-windows-package-success.log)。Node24.21.0、Chrome155.0.8059.40/Edge154.0.4258.62，实际Expand-Archive到含中文空格路径，经BAT前台启动127.0.0.1，检查实际监听地址、HTTP/核心资源/Worker回测/曲线、保存刷新重开/JSON/CSV、0外部请求/0页面错误、端口占用/缺dist失败、Enter退出和端口重绑均成功。cmd引用修正已由此实际Windows日志确认。
- 该验证包[artifact12242343011](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39372868072/artifacts/12242343011)绑定完整a4198f2 SHA，expired=false；有效期14天，至北京时间2026-11-03 13:08:10。内层ZIP SHA256为ab3919216e7d388b3e04030e29ea39bfa746f2374a6606f9f596578a0683a1f6，569357 bytes。原始校验清单及双浏览器证据在artifact内。此记录对应这个实际提交，不冒充后续head。
- 收尾仅归档上述事实、明确报告/恢复边界并修正首页回测入口残留“待开发”标签；不改策略/成交/统计计算。收尾提交仍执行相同完整CI和Windows ZIP；最新head的下载链接/有效期与实际检查结果统一在[PR #6交付说明](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/6)维护，避免将旧SHA的包当成最终产物。
- 工作区独立分支、main保持0ee6d8483bd6a5226a6d01a1d21b990b134bab46；无合并/tag/Release/公开部署。用户Windows实机、物理断网、真实配额耗尽/断电/全部受管环境尚未验收。当前建议先下载按清单实测，再决定是否合并；Phase3仍需另行授权。

## Phase 2B 历史恢复入口：Phase 2B（2026-10-19）

- 初始 work 分支干净；已 fetch origin/main，核实 PR #4 merged=true，实际合并 a7b57cbecf7b25cd50da6647426e99ca6738dfa5，UTC 15:49:17。从该提交建立 feat/phase-2b-strategies-risk；[PR #5](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5)已创建，open/draft，工程提交509164f5c2aa27ec4083a45696a27ff5ad8b8f3f；不修改main、不合并/发布/部署。
- 重新读取最终 CI run 39277844255 的三个job：Ubuntu Chromium 118146578981、Windows Chrome 118146578936、Windows Edge 118146578753，均completed/success，npm ci/check步骤成功；随后已重新读取三个job原始日志，逐一确认每组159项Vitest及17项E2E通过，无失败/跳过。
- 2A Codex本机完整check未通过：旧UI 5000ms及浏览器30s超时、一次浏览器中止；原日志路径/数量/失败事实在下文完整保留。Windows用户1B/2A未测试，2B亦未测试，不以CI替代。
- 已阅读AGENTS、plan、progress、Phase2A设计/自查、原规划相关条款及回测/账本/指标/数据契约与测试。先更新2B设计，随后只交付三策略与风控执行内核。
- 本轮首次沙箱git fetch无法连接proxy:8080；使用受支持network权限后成功，未改代理或读取凭据。2B npm ci与check事实将逐项补充，尚不声明通过。

## Phase 2B 实施与真实验证

- npm ci --cache work/npm-cache：通过，259 packages，Node24.19.0/Linux；锁文件与依赖未改。日志work/phase-2b-npm-ci.log。
- 新增递进策略接口、MA交叉/RSI阈值/历史high-low突破、合法参数和long/flat执行；保护从实际滑点entry设置，已有仓开盘风控优先、根内双触发明确stop-first。未知根内时间为null并保留区间，绝不编造先后。
- 延续18位BigInt、双边成本/数量舍入/最小名义额/逐笔守恒；抽出core/math叶模块，已逐字节核对与2A原算术相同，backtests/decimal保留兼容导出。策略/风险不反向依赖回测。无UI、依赖、原数据/指标/存储/回归断言/测试阈值或CI配置更改。
- 首次类型检查失败：重复kind默认键及旧fixture返回联合类型导致TS2783/TS2345。修正默认展开和fixture精确固定信号返回类型，原测试断言不变。原日志[initial-typecheck.log](docs/phase-2b-evidence/initial-typecheck.log)随仓库保存。
- 独立Python参考脚本首轮遇到全零sum变成int、除法得到float，触发TypeError，未生成JSON；随后的策略测试套件因此缺少JSON、0项运行（[initial-strategies.log](docs/phase-2b-evidence/initial-strategies.log)）。把独立脚本零种子改成Decimal后成功，参考不来自TS输出。实际python3 tests/reference/phase2b_reference.py --check通过：100位Decimal、18组策略/5组风控固定案例；日志work/phase-2b-reference-check.log。
- 原2A专项40/40、新增首轮93/93通过；加入3组完整引擎逐前缀因果测试后，首次完整PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check通过：12文件/255项Vitest、17项E2E、格式/lint/strict类型/构建全通过，0失败/跳过，日志work/phase-2b-full-check.log。该记录为下述激活边界修正之前，不冒充最终代码验证。
- 自查发现新仓买滑点很大、stop已高于open时，原稿按更好的stop退出会高估结果。新增回归先复现44通过/1失败（[activation-before.log](docs/phase-2b-evidence/activation-before.log)）；随后新仓保护激活立即检查open并按已知open退出。同根两笔开盘事件明确保持先买后保护顺序；没有改断言/阈值。修正后三核心文件137/137通过，日志work/phase-2b-activation-fixed.log。
- 修正后最终完整check退出0：12文件/256项Vitest（原159全部保留，新增97项）、17项E2E、格式/lint/核心+应用+测试strict类型/构建全部通过，无失败/跳过。本机Linux、Node24.19.0、Chromium154.0.8037.57，[完整原日志](docs/phase-2b-evidence/local-final-check.log)随仓库保存。2B这次通过不覆盖2A当时本机超时事实，也不等于Windows用户测试。
- [PR #5](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5)已创建，open/draft，未合并/发布/部署。工程提交509164f5c2aa27ec4083a45696a27ff5ad8b8f3f的[CI run 39283091782](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782)于UTC16:08:19触发；持续轮询至UTC16:17后仍是queued，三个job均未开始、steps为空，conclusion=null。这不是测试通过或失败，也不称为测试超时；尚无2B跨平台通过证据。原始工具状态快照随[ci-status.json](docs/phase-2b-evidence/ci-status.json)保存。
- 排队job：[Ubuntu Chromium 118161397623](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161397623)、[Windows Edge 118161397975](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161397975)、[Windows Chrome 118161398163](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39283091782/job/118161398163)。没有重跑/取消队列、改runner矩阵或放宽测试。收尾仅文档归档提交，最新状态见[PR Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/5/checks)；后续须等runner实际执行后读取日志归档，不能用本机或2A旧CI替代。
- 最终设计/边界与剩余风险见[2B设计](docs/phase-2b-design.md)及[实现后自查](docs/phase-2b-review.md)；用户[Windows清单](docs/phase-2b-acceptance.md)全部保持未签署。RSI仍为IEEE754指标，接近阈值有舍入边界；资金无Number累加。无限流动性/原Number精度/同步内核限制保留，不宣称整个M2完成。
- 本地文档相对链接51条核对无损坏；原规划SHA256仍为0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。生产UI构建仍70 modules、JS453.56kB/gzip148.08kB、Worker11.77kB、CSS16.26kB；内核没有UI入口，不把旧UI E2E当成策略面板验收。

## Phase 2A 历史记录（保留当时状态，PR #4现已合并）

## Phase 2A 历史恢复入口：Phase 2A（2026-10-19）

- 已 fetch origin/main 并核实 GitHub PR #3 merged=true；合并 SHA 3282475ecea8f0c42332eab8515e90b74cef6bde，UTC 14:37:28。初始 work 分支干净；从 origin/main 建立 feat/phase-2a-deterministic-backtest，目标独立 PR #4，不直接修改 main。
- Phase 1B 云端技术复核通过；用户 Windows 实机尚未执行，不伪造验收。已重新读取 CI run 39269144185 三个 job：Ubuntu Chromium / Windows Chrome / Windows Edge 均 success，npm ci/check 步骤均成功。
- 已完整阅读 AGENTS、plan、本文件、原始产品规划、Phase 1 数据/保存契约及代码，先审查设计再实施；保留旧功能、测试、失败事实和用户验收边界。下方均为历史时间点记录。
- 本轮完成 2A 内核/固定信号/虚拟账本，工程提交 fd9aed7edb151e4a705dd30a3ed125d9374ef841。正式策略、止盈止损、收益面板在 2B/2C；不宣称整个M2完成。
- [PR #4](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/4) 已创建，open/draft，待审，未合并/发布/部署。工程提交三平台CI均成功（下节实际日志）；本机常规浏览器受到超时影响，保留失败；相同提交的临时内存目录复验也有旧UI测试超时，详见下节。本机完整check不标记通过。

## Phase 2A 实施与验证

- 新增 core/backtests 的事件/执行/定点/配置/身份/账本审计模块；不改原 UI、CSV、图表、指标、存储或备份逻辑。SHA-256 使用固定 @noble/hashes 2.4.0，锁文件只增加该依赖，无新交易/联网能力。
- npm ci --cache work/npm-cache 已通过，259 packages，日志 work/phase-2a-npm-ci.log。最初沙箱 Git fetch 无法连代理，使用受支持 network 权限后成功；没有更换代理或读取凭据。
- 首轮类型检查发现测试直接写 readonly volume，已改为替换测试副本。随后 typecheck/lint 通过。首轮38项核心测试因共享 tests/setup.ts 在 Node 环境访问 window 而全部标记失败；另缺口测试截止时间先触发未完成根，已将截止时间覆盖缺口末根。只给共享清理增加 Node 判断，浏览器原清理与断言不变；失败日志 work/phase-2a-first-unit.log 保留。
- 设计/字段独立自查发现初稿按执行根的整根 volume=0 拒单会偷看开盘时尚未知的成交量，已移除：执行函数仅接收 open，H/L/C/volume 均不参与成交；明确无限流动性/忽略成交量假设（包括零量），加入改变 volume 不影响成交回归。没有用未来高低价裁剪滑点价格。
- 首次完整check因新写自查文档未格式化而停在format:check，未进入后续测试；随后格式化，失败日志 work/phase-2a-full-check.log 保留，完整复验使用新日志。
- 修复后 Node 核心专项39/39通过，日志 work/phase-2a-unit-fixed.log；随后新增派生数值上限回归，需随完整检查复验。派生现金/数量/市值/权益小于10^78，超限阻断整次运行，不裁剪或返回部分结果。
- 完整复验格式/lint通过，159项中156通过、数据中心3项5000ms超时，未进入构建/E2E（work/phase-2a-final-check.log）。未修改实现/断言/超时；同一数据中心文件独立复验4/4通过、测试部分4.19秒（work/phase-2a-dataset-recheck.log）。已确认 src/app/features/infrastructure/data/indicators 与原集成/E2E文件均无变化，随后完整重跑。
- 已实际执行 Python Decimal 80位独立直接公式，buy/sell/totalFees 与固定JSON完全一致；不调用 TS 内核生成参考。原产品规划 SHA256 仍为 0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。

## Phase 2A 工程提交CI与本机边界

- 工程提交 fd9aed7edb151e4a705dd30a3ed125d9374ef841 的 [CI run 39275693273](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273) completed/success。已读取三组实际日志，每组 **10文件/159项Vitest +17项E2E全部通过**，无失败/跳过；npm ci、格式/lint、独立core/app/test严格类型与构建全部通过。
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304755)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304507)、[Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39275693273/job/118139304143)。原0/1A/1B共119项Vitest及全部17项E2E保留，新增40项内核测试。
- 本机再次完整重跑：159/159测试、格式/lint、严格类型和生产构建通过；E2E在30秒整项期限出现旧CSV/图表/存储案例超时。trace显示等待UI操作时用尽总期限，没有数值/账本断言失败。出现多项超时后中止剩余浏览器运行，报告为3通过/4失败/10未运行，退出130；不记作完整通过（work/phase-2a-complete-check.log及test-results/）。没有改断言、默认超时或生产功能。
- 本机 Linux / Node24.19.0 / Chromium154.0.8037.57，CPU额度2核。工作区overlayfs与CI表现差异尚未归因，不将推测写成结论。为排查文件系统影响，git archive同一fd9aed7到/tmp内存目录并复制npm ci恢复的依赖，执行原npm run check：格式/lint通过，158/159通过、旧数据中心1项5000ms超时，未进入构建/E2E（exit1）。迁到tmpfs未消除问题，不能确认文件系统为根因；不继续放宽检查或重复运行。临时路径 work/phase-2a-tmp-check-path.txt，日志 work/phase-2a-tmp-check.log。
- 本轮成功的完整 `npm ci` / `npm run check` 证据为上述三个独立CI runner；本机只确认159项测试/类型/构建曾全部通过，不能把中止的浏览器套件记作17项通过。最终文档提交最新CI以PR Checks为准。
- 设计/成交模型/精度/固定案例和实现后自查见 [2A设计](docs/phase-2a-design.md)、[清单](docs/phase-2a-acceptance.md)、[自查](docs/phase-2a-review.md)。独立Decimal直接公式、Node SHA-256对照及历史前缀验证已执行通过。
- 尚无正式策略、止盈止损/双触发、收益/基准/回撤面板、实验持久化/导出、Worker执行适配或浏览器内核大数据性能承诺。来源Number精度不能恢复；开盘模型忽略流动性/成交量/市场冲击；截止时间是调用方声明。完整M2在后续验收。
- Phase1B用户Windows实机仍未测试；Phase2A也没有用户手工验收结果。CI与云端证据不代替用户机器。下方均保留历史时间点的事实。

## Phase 1 历史记录

## 最新技术验收复核（2026-10-19）

用户要求协助验收，并明确暂时不能在Windows上运行，先获取复核结果。基线4515782和三组旧CI已核实，重新npm ci及119/16完整检查通过；新人工样本发现保存长名称后的390px横向溢出（实测489px），未沿用旧绿灯作无条件通过。已限制select宽度并允许长标题换行，新增回归修正前失败、修正后完整119项Vitest/17项E2E及格式/lint/类型/构建通过。随后加强78字符无空格币种，构建及针对回归1/1通过。

独立7根人工样本的MA3=106、EMA3=105.708333333333、Wilder RSI3=82.8947368421053，与手算参考一致；UTC转换、保存/导出/关闭页面重开/删除/显式恢复通过，外部请求与页面异常均0。50,000根合成重开图表910ms、缩放114ms、定时器最大间隔262.8ms；完整结果/失败事实/未测范围见 [技术验收复核](docs/phase-1b-agent-acceptance.md)。当前修改仍在PR #3，不改main，不代替Windows用户实机签署。新增回归后的最终跨平台状态以PR Checks为准；下方119/16与117/16保留为之前版本历史。

## 当前恢复入口：Phase 1B（2026-10-19）

- GitHub PR #2 merged=true，实际合并 c17c0a4ba4084bad06e572da48d3da1fb5cf4720，UTC 10:44:13。已 fetch origin/main 并从该提交创建 feat/phase-1b-charts-storage；初始工作区干净，不直接修改 main。
- 用户明确确认 Phase 1A Windows 验收通过。仅记录总体通过，不补写未提供的逐项结果/版本。下方旧记录是各时间点历史，不代表最新状态。
- 已阅读 AGENTS、plan、本文件、原规划和 1A 数据接口。先更新授权/计划，随后实施 1B，目标 PR #3 待审；无 Phase 2、交易、Release 或部署。
- 已完成：本地打包 Lightweight Charts 5.2.1、OHLC/量/交互、纯 TS MA/EMA/Wilder RSI、IndexedDB 显式保存/打开/删除、JSON 备份校验/显式恢复、新数据契约与 app 装配。1A 核心解析和质量逻辑未改，上限保持。
- npm ci 已成功；数值边界修正后完整 npm run check 通过 **9文件/119项 Vitest、16项 E2E**，格式/lint/严格类型/构建全通过，无失败/跳过。日志 work/phase-1b-numeric-final-check.log（本机临时证据）。持久浏览器测试使用 work/ 短路径避免 Windows 嵌套路径问题。修正后的跨平台最终结果/日志见 PR #3 Checks；下方117项CI归档仅为修正前版本。
- 27 条本地文档链接与原规划 SHA256 核对通过。[PR #3](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/3) 已创建，open/draft，待用户审查；工程提交3ac1469三组CI全部通过（下节证据）；随后数值边界修正见专项记录，最新提交状态见 PR Checks。Phase 1B 用户 Windows 手工未测试，清单见 docs/phase-1b-acceptance.md。不得用 1A 用户通过替代本轮验收。

## Phase 1B 实施和测试事实

- 文档先行提交 8e8c38a，完整阅读原规划，核实 PR #2 合并与 1A 用户总体验收；不补写浏览器版本或逐项通过。
- MA：N 根收盘价 SMA；EMA 首 N 根 SMA 初始化，α=2/(N+1)；RSI 首 N 个差值初始化后 Wilder，α=1/N，常量50/单涨100/单跌0。独立 Decimal 60位闭式参考逐点核验、历史前缀不变、缺口重置、样本不足 NA。
- 图表：UTC 毫秒转秒仅在适配边界，支持亚秒读数；MA/EMA 叠加、RSI 独立面板；缺口提示并最多一个空白位置，不扩展假行情；深浅/390px/缩放/平移/十字准星。极小价格采用科学计数，超出可靠刻度范围明确失败。
- 存储：原生 IndexedDB 两 store 原子事务，complete 后成功；拒写/配额/abort/同步异常不假成功。重新打开校验结构/价格/UTC/质量；备份20 MiB独立格式上限，CSV仍10 MiB/50,000根；恢复前校验并再次确认为新副本。保存全部已检查记录和警告，无错误子集；不保存原 CSV。
- 首轮新增指标测试 111/112 通过，一处手填 EMA 种子期望值错误（独立参考已经通过），核算首14根均值后改为45.114285714285714；修正事务闭包的 TypeScript 可空检查后复验全部通过。
- 首轮 1B 浏览器4/7：指针停留自动进入十字准星，末根断言需先移开；一条手填末根价格修为原 CSV 的69962.21；恢复状态 locator不唯一。随后MA断言错误匹配EMA子串，改为独立指标节点；删除失败测试停留数据中心却期待行情空状态，改为明确进入行情。保留功能断言，修正后完整16/16通过，未跳过。
- 第一轮 50,000 根人工合成：CSV 1,600,036 bytes；同步连续构建图表约3,041ms，10ms定时器最大间隔2,749.8ms。按序列分段让出浏览器后复验降至约310–596ms；不降采样/不截断。
- 完整检查中的 50,000 根实测（Linux Node24.19.0 / Chromium154.0.8037.57）：检查预览484ms，质量报告361ms，重新检查+保存971ms，重新打开+图表就绪1594ms，缩放304ms；JSON4,401,567bytes，导出377ms，恢复预检165ms，明确恢复495ms。四时点 CDP 观测最大 JS 堆252,986,748 bytes（约241.3MiB，非进程总内存或精确峰值），定时器最大间隔407.1ms。性能受机器负载影响；完整输出随测试 artifact保存。
- 实际浏览器覆盖：关闭持久配置浏览器进程后重启并恢复；阻断全部非本机 origin 后导入/保存/重开/图表/导出/恢复，无外部请求；两个数据集选择；损坏已存记录拒绝；删除失败保留记录；实际 Worker/哈希/亚秒/原1A/壳测试均保留。配额/拒写通过异常注入验证，不冒充实际填满磁盘或全部隐私模式测试。
- 边界修正前生产代码复验 117/16 全通过；50,000根：预览523ms、报告341ms、准备+保存532ms、重开+图表895ms、缩放129ms、JSON导出359ms、预检146ms、恢复525ms；最大观测 JS 堆256,907,272bytes（约245.0MiB），定时器最大间隔243.6ms。与上轮数值均为实际记录，不选择性隐去较慢结果。当时构建70 modules、Worker11.77kB、应用JS452.93kB（gzip147.85kB）、CSS16.19kB；没有外部运行依赖。
- 人工 React 复核：无条件 Hooks、纯计算 memo、feature props 经 app、异步失败显式状态、Worker generation/终止、图表取消/移除/分帧事件、稳定 dataset id、输入可访问 label、事务完成后列表更新。四项 ESLint API 探针拒绝 core→infrastructure、core→indexedDB、shared→infrastructure、feature→兄弟模块，全部符合预期。

遗留与下一步：浏览器存储并非永久可靠；同源/配置隔离，跨标签页列表无实时同步需刷新；单序列绘图、JSON和克隆仍在主线程，非无限/流式方案。未实测用户 Windows、真实磁盘耗尽、断电、所有受管/隐私策略、移动触屏、file://、单 HTML/PWA/安装器；原生2025微秒归档仍未补充。先执行 Phase 1B Windows 清单并审查 PR #3；通过后另行授权 Phase 2 事件/账本/回测设计，本轮不开发。

## 收尾数值边界修正（仍在 PR #3）

三组初版 CI 通过后，人工复核发现极大有限价格离开滚动 MA 窗口时减法更新会丢失小值，EMA周期1也可能因相减抵消归零。先新增两项回归实际复现（18通过/2失败，work/phase-1b-numeric-regression-before.log），再将 MA 改为双栈聚合均值（摊销 O(n)、额外 O(N) 内存），EMA/初始化使用以较小端点为基准的凸组合。定义、初始化、因果性和缺口规则不变；原1A质量约定不变，没有丢弃或修复行情。该修正后已完整复验：119项 Vitest、16项 E2E及格式/lint/类型/构建全通过。50,000根：预览524ms、报告441ms、准备保存565ms、重开图表991ms、缩放102ms、导出420ms、备份预检131ms、恢复574ms，最大观测JS堆256,444,160bytes，定时器最大间隔273.7ms。构建JS453.56kB/gzip148.08kB，CSS16.19kB，Worker11.77kB。最终CI以PR Checks为准，下方117项证据仅为修正前版本。

## Phase 1B 工程提交 CI 归档

- 工程提交 **3ac1469f2f90c88957a2f32471d7b2bd29608644**；[CI run 39242981786](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786) completed/success。已读取三组实际日志，各9文件/117项 Vitest、16项 E2E，0失败/跳过，npm ci、格式/lint/类型/构建通过。
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005532)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005377)、[Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39242981786/job/118028005247)。Windows CI 不是用户实机手工验收，具体浏览器版本未采集，不补写。
- 三组均实际执行浏览器进程关闭/同配置重开、外网 origin 阻断、原1A回归、图表/指标、IndexedDB、JSON恢复和50,000根合成性能测试。报告及性能 JSON 由 workflow artifact 保存14天。

| 平台            | 重开+图表就绪 ms | 缩放 ms | 备份预检/恢复 ms | 定时器最大间隔 ms | 四时点最大观测JS堆 bytes |
| --------------- | ---------------: | ------: | ---------------: | ----------------: | -----------------------: |
| Ubuntu Chromium |              827 |      75 |        148 / 415 |             270.3 |                217061820 |
| Windows Chrome  |              647 |      72 |         84 / 621 |             183.6 |                261459008 |
| Windows Edge    |              978 |     163 |        223 / 665 |             316.2 |                245772928 |

规模相同：50,000根，CSV1,600,036bytes、JSON4,401,567bytes。并非性能保证或真实行情测量，堆值不是进程总内存/精确峰值。完整各阶段耗时随日志保留。

PR #3 保持 open/draft；远端 main 仍为 c17c0a4ba4084bad06e572da48d3da1fb5cf4720，未直接修改。随后仅归档本文档/计划，最新文档提交 CI 以 [PR Checks](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/3/checks) 为准；不自动合并、Release 或部署。下一行动：用户按独立 Phase 1B 清单验收并审查；Phase 2 未启动。

## Phase 1A 与 Phase 0 历史归档（以下保留当时事实）

## 当前恢复入口（2026-10-19，Asia/Shanghai）

- 已同步并核对 main：6ffe6a3186699ae85a26331efa932c3bcec500a2，即 PR #1 实际合并提交。GitHub 显示 merged=true，合并时间北京时间 2026-10-19 17:57:48。
- 用户本轮明确确认 Phase 0 已验收、Windows Edge/Chrome 本地测试均通过，M0 通过。版本/逐项结果未提供，清单只更新总体状态。
- 当前授权 Phase 1，仅实施 **1A：CSV 导入/映射、UTC 毫秒、数据质量与来源样本**。从 main 建立 feat/phase-1a-csv-import，目标独立 PR #2，未修改 main。
- 已完整重读 AGENTS、plan、本文件和产品规划；先更新文档，再完成 1A 解析、UI/Worker、样本与报告。[PR #2](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/2) 已创建，open/draft，等待用户审查和 Phase 1A Windows 手工验收；不自动合并或推进 1B。
- 图表、技术指标、回测、真实账户/API Key/资金/交易、实时抓取不在本轮范围。
- 本轮 npm ci 通过。原文保留修正后完整 npm run check 通过：76 项 Vitest、7 项 E2E；最新 CI 结果见 PR #2 Checks（自动更新），此前初版三组 75/7 通过证据在下方保留。Phase 1A 用户 Windows 手工仍未测试。

## Phase 1A 实施与验证

- 文档先行提交 0cf370f：核实 PR #1 合并与用户总体验收，授权 1A，原规划全文不修改。
- core/data：严格 CSV、唯一字段映射、ms/us/带时区 ISO、UTC 整毫秒、重复/降序/缺口/数值/OHLC/格式检查、错误总数与有限明细、资源上限。不猜测周期/单位，不补价、不排序或去重原数据。
- 数据中心：实际 Worker 读取/哈希/校验，映射和确认界面、导入摘要/错误行/警告/缺口、来源身份、取消/旧结果失效；仅当前页面内存报告。
- 样本：固定上游提交的 BTCUSDT 2024-10-28 24 条历史记录（原 ZIP、CSV、哈希/变换/核验边界），合成 ms/us、人工错误样本分别标记。未获取原生 2025 微秒归档，不把合成测试当作真实微秒样本。
- npm ci 已执行通过（依赖和锁文件未修改）。首轮 74 项 Vitest 通过；扩展 ZIP 证据测试时发现 Node 测试类型缺失和 Vite 对静态 ZIP URL 的转换，已用独立 tsconfig.test 与 Node 路径读取修正，75 项完整复验通过。
- 第一轮生产包浏览器 5 通过/2 失败：均为时间单位精确 label 定位超时；改为同名 combobox 角色后，针对两项复验 2/2 通过，最终完整 E2E 7/7 通过，断言未删减。首轮证据暂存 work/phase-1a-initial-e2e-failure，失败事实在此归档。
- 初版完整命令 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run check 已实际执行通过：格式、lint、6 文件/75 项 Vitest、独立核心/应用/测试类型检查、生产构建、7 项 E2E，0 失败/跳过。日志 work/phase-1a-final-check.log 为本机临时证据，CI 将独立保留报告。
- 平台：Linux、Node.js 24.19.0、Chromium 154.0.8037.57。E2E 包含真实 Worker/哈希、历史 24 行/UTC、微秒和歧义确认、手动映射/ISO 偏移、错误/重复/缺口、UTF-8/空/超限、旧结果失效、离线本机资源、390px。React 人工复核：无条件 Hook、事件内异步任务、旧任务 generation 失效、卸载终止、分页和有上限渲染、可访问 label/role。
- 初版构建：56 modules；Worker 11.54 kB，应用 JS 253.54 kB（gzip 80.83 kB），CSS 14.06 kB。原始规划 SHA256 仍为 0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b。22 条本地文档链接检查通过。

| 验收项目                              | 当前结果                                                      |
| ------------------------------------- | ------------------------------------------------------------- |
| Phase 0 用户 Windows Edge/Chrome 总体 | 通过（用户 2026-10-19 明确反馈）                              |
| Phase 0 逐项未提供证据                | 不补写，保留原清单记录                                        |
| Phase 1A 本机自动检查                 | 原文修正后通过：76 项 Vitest + 7 项 E2E + 类型/lint/格式/构建 |
| Phase 1A CI                           | 初版三组 75/7 通过；原文修正后的最终提交状态见 PR #2 Checks   |
| Phase 1A 用户 Windows 手工            | 未测试，不继承 Phase 0 成绩                                   |

遗留：仅当前页面内存报告、固定周期、有明确文件/明细上限；首尾完整与来源真实性不能自动证明；原生 2025 微秒/更多币种归档待后续真实样本补充。无 ZIP 导入、持久化、图表、指标、回测和交易能力。

## 原文保留修正与最终本机复验

收尾发现错误明细曾以解析后单元格重拼，丢失 CSV 原始引号/转义。现以原记录起止偏移保留原文片段（含记录内部 CRLF、引号、转义，不含终止换行），报告和界面使用该片段，不冒充重建文本。新增纯 TS 回归及实际 Worker/浏览器原文断言，原有物理行号与解析值断言保留。

原文修正后完整 npm run check 已执行通过：6 文件/76 项 Vitest、7 项 E2E、格式/lint/类型/构建，0 失败/跳过，日志 work/phase-1a-final-check-with-raw.log。新增 E2E 断言后一次格式检查未通过，重新格式化后完整复验通过；未删断言。最终 CSS 14.11 kB，其余构建量级不变。

修正代码与本节作为独立 fix 提交进入同一 PR #2；最终 CI 由 PR Checks 自动记录，下面旧 CI 只证明修正前初版。用户 Phase 1A Windows 手工验收仍未测试，等待审查，不自动合并。

## Phase 1A 初版 CI 与提交归档（原文修正前）

- 实现提交：9c19b17f392f5256c18fc59ec3d700ff9dd51287；文档先行提交 0cf370f。基线 main 仍为 6ffe6a3，已核对远端，未直接修改 main。
- [PR #2](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/2) open/draft，未合并、未发布；随后仅归档本文档，最新 Checks 以 PR 为准。
- [工程提交 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637) 三组 completed/success，已读实际日志，各 6 文件/75 项 Vitest、7 项 E2E，无失败/跳过；格式/lint/类型/构建亦通过。
- [Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565150)、[Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565358)、[Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39237660637/job/118010565360)。具体 Windows/浏览器版本未采集，不补写。
- 额外用 Python 标准 zipfile 解压保留的来源 ZIP，逐字节比较应用 CSV：完全相同，共 24 行，SHA256 与 provenance 一致。该一次性核验不引入 Python 运行/测试依赖。
- 后续：用户按 docs/phase-1a-acceptance.md 验收并审查 PR #2，下一轮再安排 1B。Phase 0 用户通过不等于 Phase 1A 用户通过；原生 2025 微秒样本、持久化与完整 Phase 1 能力尚未验收。

当前验收状态：Phase 0 用户 Edge/Chrome 总体通过；Phase 1A 用户 Windows 未测试，逐项清单见 [Phase 1A 验收](docs/phase-1a-acceptance.md)。后续计划为 1A 审查/验收后再安排 1B 图表/基础指标/存储，不在本轮开发。

## Phase 0 历史归档（保留当时事实，已由上述最新状态覆盖）

- 日期：2026-10-18（Asia/Shanghai），Phase 0 工程已实现，本机及三组 CI 全通过；等待用户 Windows 手工验收，M0 尚未最终验收。
- 独立仓库 meredithfyc1001/riverlab-crypto-lab；main 基线 3867029fe4bc23290b4a616c1bed6ae6b700d4a0；分支 feat/phase-0-foundation。
- 完整阅读附件 v0.1，原文 docs/product-plan-v0.1.md；参考 GTO 的 AGENTS/脚本，无业务复用。
- [PR #1](https://github.com/meredithfyc1001/riverlab-crypto-lab/pull/1) 已创建，open/draft，未合并、未发布。工程提交 85f55c3ac1e2d5f5d4618650eeb625cdd995a71a。
- 下一行动：按 Windows 清单手工验收后评审 PR。Phase 1 及后续均未启动。

## 本轮改动

React/TypeScript/Vite、中文八入口、深浅主题、4 条明确标识的合成只读示例、永久风险提示；纯 TS 数据/策略/回测/风险边界；格式/lint/类型/Vitest/Playwright 与 Linux/Windows CI；开发、规划、离线/验收文档。

## 验证账本

| 项目                   | 状态                 | 证据/备注                                             |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| 依赖安装               | 通过                 | npm install 后再用 npm ci 重装成功，锁文件可复现      |
| 首轮 lint              | 通过                 | npm run lint                                          |
| 首轮 Vitest            | 通过                 | 3 文件、11 测试                                       |
| 首轮类型检查           | 失败已修复、复验通过 | E2E 配置补 DOM lib；core 独立无 DOM 检查通过          |
| npm run check          | 通过                 | 格式、lint、11 项 Vitest、类型、构建、2 项 E2E 全通过 |
| 开发启动               | 通过                 | Vite 5173 启动，浏览器中文工作台/导航/键盘跳转通过    |
| 生产包 Linux Chromium  | 通过                 | Chromium 154.0.8037.57，1440×1000 与 390×844          |
| Ubuntu CI Chromium     | 通过                 | 首轮 workflow 39055867895，11 项 Vitest + 2 项 E2E    |
| Windows CI Chrome/Edge | 两组均通过           | 同一 workflow，两组均为完整 npm run check             |
| 用户 Windows 实机      | 未测试               | docs/testing-checklist.md                             |

生产包 E2E 验证八入口、刷新、后退、深浅主题、合成样例、各页风险提示、仅本机 HTTP 请求、无页面或控制台错误、窄屏无页面溢出。另执行 5 项 ESLint API 边界探针：拒绝 core→React、core→window、feature→兄弟模块、shared→core；允许 feature→core 公共类型，全部通过。人工查看工作台截图，布局与标识正常。

本地构建：40 modules，HTML 0.72 kB，CSS 10.25 kB，JS 232.70 kB（gzip 73.28 kB）。附件原文 SHA256：0a3081d44d3557e6d0f1b1eda3378c2e83282b3c6677dcd45b88a3190b86f84b，与保存原件一致。

## CI 归档

工程提交 85f55c3 的 [首轮 CI](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895) 三组均 completed/success，已核对实际日志，每组均为 3 文件/11 项 Vitest 与 2 项生产包 E2E，无失败/跳过测试。

- [Windows Edge](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593468)
- [Windows Chrome](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593642)
- [Ubuntu Chromium](https://github.com/meredithfyc1001/riverlab-crypto-lab/actions/runs/39055867895/job/117463593692)

本次随后仅归档文档；最新提交的自动检查以 PR Checks 为准。Windows CI 是真实 Windows runner 自动化证据，不代替用户机器的手工验收；未获取实际浏览器版本，不补写版本号。浏览器报告由 CI artifact 保存 14 天。

## 环境与遗留

初始代理不可连；使用受支持的网络权限后 npm/Git 恢复。初次 npm 安装触及不可写的默认缓存，已将缓存放到项目 work/。未输出密钥。

首轮 E2E 的本机服务因沙箱网络权限无法启动，使用受支持网络权限后完整通过。Linux 检查显式使用系统 Chromium，不将其描述为 Windows 原生测试。GH CLI 登录检查未能确认有效认证；Git 和 GitHub connector 分别用于推送和 PR。

没有真实数据导入、图表、业务计算或存储，没有账户/资金连接。静态包经本机 HTTP；单 HTML、file:// 和离线安装器未实施。Windows 用户验收待完成，M0 尚未通过。

建议先完成 Windows 两浏览器手工验收和 PR 评审，再由用户启动 Phase 1，优先真实 CSV 样本、毫秒/微秒识别、无效行和缺口报告。

## 2026-11-09 Phase 3 启动时记录

用户明确回复“启动 Phase 3 设计与开发”，替代此前范围待定状态。基线main33b1d669不变，继续独立分支PR#7并按最终实现重写描述；禁止自动合并。设计/授权/验收清单已更新，新增纯TS研究、Worker、策略UI和确定复现报告、独立Decimal参考及时间隔离/离线/性能测试。原307/24回归保留。

本轮云执行环境配置失败，exec_command不可用，本机npm ci/check未执行。使用GitHub树/提交API仅写独立分支并由CI实际执行；启动时新CI尚待结果；后续实际结果已归档于当前恢复入口。格式失败后只读Prettier诊断不修改checkout，修正必须提交后重新完整检查。
