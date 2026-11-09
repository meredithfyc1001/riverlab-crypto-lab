import { useState } from 'react';
import type { Dataset, DatasetSummary } from '../../core/data/dataset';
import { DEFAULT_CONFIG } from '../../core/backtests';
import { parameterGrid, validateResearch } from '../../core/research';
import type { Evaluation, ResearchInput } from '../../core/research';
import './research.css';

export function ResearchCenter({
  datasets,
  dataset,
  busy,
  onSelect,
  onRun,
  onRestore,
}: {
  datasets: DatasetSummary[];
  dataset: Dataset | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onRun: (input: ResearchInput) => void;
  onRestore: (file: File) => void;
}) {
  const [mode, setMode] = useState('compare');
  const [kind, setKind] = useState<'ma' | 'rsi' | 'breakout'>('ma');
  const [axisA, setAxisA] = useState('2, 3');
  const [axisB, setAxisB] = useState('5, 8');
  const [period, setPeriod] = useState('3');
  const [evaluation, setEvaluation] = useState('full');
  const [trainBars, setTrainBars] = useState('12');
  const [testBars, setTestBars] = useState('6');
  const [costs, setCosts] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(DEFAULT_CONFIG).map(([key, value]) => [
        key,
        String(value),
      ]),
    ),
  );
  const [risk, setRisk] = useState({ stopLossBps: '', takeProfitBps: '' });
  const [confirmedId, setConfirmedId] = useState('');
  const [error, setError] = useState('');
  const number = (value: string) => (value.trim() ? Number(value) : NaN);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (
        !dataset ||
        !datasets.some((d) => d.id === dataset.id) ||
        confirmedId !== dataset.id
      )
        throw new Error('请选择已保存数据并确认收盘与研究口径。');
      const end =
        dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
      if (end > Date.now()) throw new Error('数据尚未全部收盘。');
      const candidates =
        mode === 'compare'
          ? [
              { kind: 'ma' as const, fastPeriod: 2, slowPeriod: 5 },
              { kind: 'rsi' as const, period: 3, lower: 30, upper: 70 },
              { kind: 'breakout' as const, lookback: 3 },
            ]
          : parameterGrid(
              kind,
              axisA.split(',').map(number),
              axisB.split(',').map(number),
              number(period),
            );
      const split: Evaluation =
        evaluation === 'full'
          ? { kind: 'full' }
          : evaluation === 'split'
            ? { kind: 'split', trainBars: number(trainBars) }
            : {
                kind: 'rolling',
                trainBars: number(trainBars),
                testBars: number(testBars),
              };
      const input: ResearchInput = {
        dataset,
        completedThroughUtcMs: end,
        candidates,
        evaluation: split,
        config: {
          initialCash: costs.initialCash,
          minNotional: costs.minNotional,
          feeBps: number(costs.feeBps),
          buySlippageBps: number(costs.buySlippageBps),
          sellSlippageBps: number(costs.sellSlippageBps),
          quantityDecimals: number(costs.quantityDecimals),
        },
        risk: Object.fromEntries(
          Object.entries(risk)
            .filter(([, v]) => v !== '')
            .map(([key, value]) => [key, number(value)]),
        ),
      };
      validateResearch(input);
      onRun(input);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '参数无效。');
    }
  }
  return (
    <section className="panel research-controls">
      <h2>策略研究配置</h2>
      <p>
        比较与敏感度分析是描述性研究；所有候选事先锁定，不自动选优，不构成投资建议。
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={busy}>
          <legend>数据与候选</legend>
          <label>
            研究数据集
            <select
              value={
                dataset && datasets.some((d) => d.id === dataset.id)
                  ? dataset.id
                  : ''
              }
              onChange={(e) => {
                setConfirmedId('');
                setError('');
                onSelect(e.target.value);
              }}
            >
              <option value="">请选择已保存数据集</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.symbol} · {d.name}
                </option>
              ))}
            </select>
          </label>
          {dataset && (
            <div className="research-facts">
              <p>
                {dataset.symbol} · {dataset.candles.length} 根 · 周期{' '}
                {dataset.quality.intervalMs! / 1000} 秒 · {dataset.source.label}
              </p>
              <p>
                {new Date(dataset.candles[0].timestampUtcMs).toISOString()} 至{' '}
                {new Date(
                  dataset.candles.at(-1)!.timestampUtcMs +
                    dataset.quality.intervalMs!,
                ).toISOString()}
                （收盘，UTC）
              </p>
              <p>
                {dataset.source.note}；缺口 {dataset.quality.gapCount}，警告{' '}
                {dataset.quality.warningCount}，首尾完整性和来源真实性不能认证。
              </p>
              <details>
                <summary>来源文件哈希与质量警告</summary>
                <code>{dataset.file.sha256}</code>
                {dataset.quality.issues.map((q, i) => (
                  <p key={i}>
                    {q.code}：{q.message}
                  </p>
                ))}
              </details>
            </div>
          )}
          <label>
            研究模式
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="compare">三策略比较（固定公开参数）</option>
              <option value="grid">参数敏感度网格</option>
            </select>
          </label>
          {mode === 'compare' ? (
            <p>
              MA 2/5；RSI
              3/30/70；突破回看3。比较模式固定参数；使用网格可研究其他参数。
            </p>
          ) : (
            <>
              <label>
                网格策略
                <select
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value as typeof kind;
                    setKind(next);
                    setAxisA(next === 'rsi' ? '20, 30' : '2, 3');
                    setAxisB(next === 'rsi' ? '70, 80' : '5, 8');
                  }}
                >
                  <option value="ma">MA 交叉</option>
                  <option value="rsi">RSI 阈值</option>
                  <option value="breakout">价格突破</option>
                </select>
              </label>
              <div className="research-grid">
                <label>
                  {kind === 'ma'
                    ? '快线周期列表'
                    : kind === 'rsi'
                      ? '下阈值列表'
                      : '回看周期列表'}
                  <input
                    aria-label="网格第一轴"
                    value={axisA}
                    onChange={(e) => setAxisA(e.target.value)}
                  />
                </label>
                {kind !== 'breakout' && (
                  <label>
                    {kind === 'ma' ? '慢线周期列表' : '上阈值列表'}
                    <input
                      aria-label="网格第二轴"
                      value={axisB}
                      onChange={(e) => setAxisB(e.target.value)}
                    />
                  </label>
                )}
                {kind === 'rsi' && (
                  <label>
                    网格 RSI 周期
                    <input
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <p>
                英文逗号分隔；最多25个单元。周期1–50,000整数，MA快线&lt;慢线，RSI
                0≤下阈值&lt;上阈值≤100。空白、重复和任何无效组合阻止整批，不跳过单元。
              </p>
            </>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>时间隔离</legend>
          <label>
            评估方式
            <select
              value={evaluation}
              onChange={(e) => setEvaluation(e.target.value)}
            >
              <option value="full">全区间描述</option>
              <option value="split">样本内 / 样本外拆分</option>
              <option value="rolling">滚动训练 / 测试窗口</option>
            </select>
          </label>
          <div className="research-grid">
            {evaluation !== 'full' && (
              <label>
                训练根数
                <input
                  value={trainBars}
                  onChange={(e) => setTrainBars(e.target.value)}
                />
              </label>
            )}
            {evaluation === 'rolling' && (
              <label>
                每窗测试根数
                <input
                  value={testBars}
                  onChange={(e) => setTestBars(e.target.value)}
                />
              </label>
            )}
          </div>
          <p>
            测试严格晚于训练；各段至少2根。每窗重置本金、空仓、指标冷启动；不继承预热或信号。滚动测试不重叠，尾部不足完整窗口列为未评估。最多20折、100次子运行、1,000,000根求值。
          </p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>统一模拟成本与风险</legend>
          <div className="research-grid">
            {[
              ['initialCash', '研究初始资金 USDT'],
              ['feeBps', '研究双边手续费 bps'],
              ['buySlippageBps', '研究买入滑点 bps'],
              ['sellSlippageBps', '研究卖出滑点 bps'],
              ['quantityDecimals', '研究数量小数位'],
              ['minNotional', '研究最小名义额 USDT'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={costs[key]}
                  onChange={(e) =>
                    setCosts({ ...costs, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              研究止损 bps（空为关闭）
              <input
                value={risk.stopLossBps}
                onChange={(e) =>
                  setRisk({ ...risk, stopLossBps: e.target.value })
                }
              />
            </label>
            <label>
              研究止盈 bps（空为关闭）
              <input
                value={risk.takeProfitBps}
                onChange={(e) =>
                  setRisk({ ...risk, takeProfitBps: e.target.value })
                }
              />
            </label>
          </div>
          <p>
            1bps=0.01%。双边手续费与不利滑点均计入；资金18位BigInt。保留收盘信号→下根开盘、既有保护优先、根内双触发止损优先和末尾不强平规则；无限流动性是假设。买入持有同窗同本金同买入成本，末收盘估值不扣卖出成本。
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!dataset && confirmedId === dataset.id}
              disabled={!dataset}
              onChange={(e) =>
                setConfirmedId(e.target.checked ? dataset!.id : '')
              }
            />
            我确认研究数据全部已收盘，已阅读质量、成本与过拟合警告
          </label>
          {error && <p role="alert">{error}</p>}
          <button
            type="submit"
            disabled={
              !dataset ||
              confirmedId !== dataset.id ||
              dataset.quality.gapCount > 0
            }
          >
            运行策略研究
          </button>
        </fieldset>
      </form>
      <label>
        重新打开研究 JSON（25MiB以内，校验并重算）
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onRestore(file);
            e.target.value = '';
          }}
        />
      </label>
      <p>
        原数据集和原回测实验均不覆盖。研究报告仅在当前内存，刷新会清除；请导出JSON。导入不会写入数据集库。
      </p>
    </section>
  );
}
