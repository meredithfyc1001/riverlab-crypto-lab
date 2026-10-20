import { utc } from './format';
import { useState } from 'react';
import type { Dataset, DatasetSummary } from '../../core/data/dataset';
import { DEFAULT_CONFIG, normalizeConfig } from '../../core/backtests';
import { normalizeStrategy } from '../../core/strategies';
import type { StrategyInput } from '../../core/strategies';
import { normalizeRisk } from '../../core/risk';
import type { WorkbenchInput } from '../../core/experiments';
import { parseDecimal } from '../../core/math';
import './backtests.css';
export function BacktestCenter({
  datasets,
  dataset,
  busy,
  onSelect,
  onRun,
}: {
  datasets: DatasetSummary[];
  dataset: Dataset | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onRun: (input: WorkbenchInput) => void;
}) {
  const [kind, setKind] = useState<'ma' | 'rsi' | 'breakout'>('ma');
  const [params, setParams] = useState({
    fastPeriod: '10',
    slowPeriod: '30',
    period: '14',
    lower: '30',
    upper: '70',
    lookback: '20',
  });
  const [costs, setCosts] = useState(
    Object.fromEntries(
      Object.entries(DEFAULT_CONFIG).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [risk, setRisk] = useState({ stopLossBps: '', takeProfitBps: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (!dataset || !datasets.some((d) => d.id === dataset.id))
        throw new Error('请先选择已保存的数据集。');
      if (!confirmed)
        throw new Error('必须确认全部K线已收盘，未确认数据不能运行。');
      if (dataset.quality.gapCount)
        throw new Error('数据含缺口，阻止运行；不会填补或忽略。');
      const end =
        dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
      if (end > Date.now()) throw new Error('数据包含尚未到收盘时间的K线。');
      const strategy = normalizeStrategy(
        (kind === 'ma'
          ? {
              kind,
              fastPeriod: num(params.fastPeriod),
              slowPeriod: num(params.slowPeriod),
            }
          : kind === 'rsi'
            ? {
                kind,
                period: num(params.period),
                lower: num(params.lower),
                upper: num(params.upper),
              }
            : { kind, lookback: num(params.lookback) }) as StrategyInput,
      );
      const config = normalizeConfig({
        initialCash: costs.initialCash,
        minNotional: costs.minNotional,
        feeBps: num(costs.feeBps),
        buySlippageBps: num(costs.buySlippageBps),
        sellSlippageBps: num(costs.sellSlippageBps),
        quantityDecimals: num(costs.quantityDecimals),
      });
      if (parseDecimal(config.initialCash) === 0n)
        throw new Error('初始资金必须大于0。');
      const protection = normalizeRisk(
        Object.fromEntries(
          Object.entries(risk)
            .filter(([, v]) => v !== '')
            .map(([k, v]) => [k, num(v)]),
        ),
      );
      onRun({
        dataset,
        strategy,
        risk: protection,
        config,
        completedThroughUtcMs: end,
      });
    } catch (failure) {
      setError(
        `无法运行：${failure instanceof Error ? failure.message : '参数无效'}。周期必须为1–50,000整数，MA快线<慢线，RSI为0≤下阈值<上阈值≤100，成本bps为0–9999，保护bps为1–9999。`,
      );
    }
  }
  const fields =
    kind === 'ma'
      ? [
          ['fastPeriod', 'MA 快线周期'],
          ['slowPeriod', 'MA 慢线周期'],
        ]
      : kind === 'rsi'
        ? [
            ['period', 'RSI 周期'],
            ['lower', 'RSI 下阈值'],
            ['upper', 'RSI 上阈值'],
          ]
        : [['lookback', '突破回看周期']];
  return (
    <section className="panel backtest-controls">
      <h2>回测配置</h2>
      <p>
        现货 · 单币种 · 多头 · 无杠杆 · 虚拟
        USDT。请先在数据中心保存通过检查的数据集。
      </p>
      <form onSubmit={submit} noValidate>
        <label>
          回测数据集
          <select
            aria-label="回测数据集"
            value={dataset?.id ?? ''}
            disabled={busy}
            onChange={(e) => {
              setConfirmed(false);
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
          <div className="backtest-facts">
            <h3>
              {dataset.symbol} · {dataset.name}
            </h3>
            <p>
              {dataset.source.label} · {dataset.candles.length} 根 · 周期{' '}
              {dataset.quality.intervalMs! / 1000} 秒
            </p>
            <p>
              {utc(dataset.candles[0].timestampUtcMs)} 至{' '}
              {utc(
                dataset.candles.at(-1)!.timestampUtcMs +
                  dataset.quality.intervalMs!,
              )}
              （末根收盘）
            </p>
            <p>{dataset.source.note}</p>
            <p>
              缺口 {dataset.quality.gapCount}；警告{' '}
              {dataset.quality.warningCount}。来源与首尾完整性不能认证。
            </p>
            <details>
              <summary>数据身份与质量警告</summary>
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
          策略
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="ma">MA 交叉</option>
            <option value="rsi">RSI 阈值</option>
            <option value="breakout">价格突破</option>
          </select>
        </label>
        <div className="backtest-grid">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="any"
                disabled={busy}
                value={params[key as keyof typeof params]}
                onChange={(e) =>
                  setParams({ ...params, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <p>
          样本不足会保留预热/hold，不伪造交易。MA 至少慢线周期+1根，RSI
          至少周期+1根，突破至少回看周期+1根。
        </p>
        <div className="backtest-grid">
          {[
            ['initialCash', '虚拟初始资金 USDT'],
            ['feeBps', '双边手续费 bps'],
            ['buySlippageBps', '买入滑点 bps'],
            ['sellSlippageBps', '卖出滑点 bps'],
            ['quantityDecimals', '数量小数位'],
            ['minNotional', '最小名义额 USDT'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="text"
                inputMode="decimal"
                disabled={busy}
                value={costs[key]}
                onChange={(e) => setCosts({ ...costs, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="backtest-grid">
          {[
            ['stopLossBps', '止损 bps（留空关闭）'],
            ['takeProfitBps', '止盈 bps（留空关闭）'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                disabled={busy}
                value={risk[key as keyof typeof risk]}
                onChange={(e) => setRisk({ ...risk, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p>
          1
          bps=0.01%。买入/卖出分别扣手续费；滑点已进入成交价。买价/费用向上、卖价/估值/数量向下，18位定点。
        </p>
        <details open>
          <summary>本次成交假设与风险</summary>
          <p>
            收盘形成信号，下一根开盘成交；末根信号到期，不自动平仓。已有仓开盘风控优先，取消待执行信号；根内双触发保守止损优先，时间未知。止损跳空按开盘，止盈跳空按阈值；保护基于含滑点买价、不含手续费，仍扣卖出成本。无限流动性、无盘口冲击、不参考整根量，成交不裁剪到高低价；历史结果不保证实际成交。缺口/重复/异常/未确认数据一律阻断，不自动修复。
          </p>
        </details>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={busy || !dataset}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我确认本数据集全部 K 线已收盘并已阅读警告和成交假设
        </label>
        {error && (
          <p role="alert" className="import-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={
            busy || !dataset || !confirmed || dataset.quality.gapCount > 0
          }
        >
          运行回测
        </button>
      </form>
    </section>
  );
}
