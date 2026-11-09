import { useState } from 'react';
import type { DatasetSummary } from '../../core/data/dataset';
import type { Candle } from '../../core/data';
import { DEFAULT_CONFIG, normalizeConfig } from '../../core/backtests';
import { normalizeRisk } from '../../core/risk';
import type { ReplaySummary, ReplayView } from '../../core/replay';
import type { Metric } from '../../core/statistics';
import type { ReplayRequest } from '../../infrastructure/replay-worker';
import { ReplayChart } from './ReplayChart';
import './replay.css';

type Model = {
  view: ReplayView;
  candles: Candle[];
  curve: ReplayView['curve'];
};
interface Props {
  datasets: DatasetSummary[];
  model: Model | null;
  records: ReplaySummary[];
  busy: boolean;
  playing: boolean;
  speed: number;
  saved: boolean;
  theme: 'dark' | 'light';
  onSpeed: (v: number) => void;
  onStart: (request: Extract<ReplayRequest, { kind: 'start' }>) => void;
  onAdvance: (count?: number) => void;
  onToggle: () => void;
  onPause: () => void;
  onTrade: (action: 'buy' | 'sell', quantity: string) => void;
  onNote: (text: string) => void;
  onCheckpoint: (name: string, exportOnly?: boolean) => void;
  onCsv: () => void;
  onOpen: (id: string) => void;
  onRestore: (file: File) => void;
  onDelete: (id: string) => void;
  onEnd: () => void;
}
const utc = (ms: number) => new Date(ms).toISOString();
const metric = (m: Metric, percent = false) =>
  m.value === null
    ? 'NA：' + m.reason
    : percent
      ? (Number(m.value) * 100).toFixed(2) + '%'
      : m.value;
const reason: Record<string, string> = {
  'risk-priority': '已有保护订单优先，手工单取消',
  'stop-loss': '止损',
  'take-profit': '止盈',
  'insufficient-cash': '资金不足',
  'insufficient-position': '持仓不足',
  'position-already-open': '已有持仓，保护模式禁止加仓',
  'position-already-flat': '当前空仓',
  'below-min-notional': '低于最小名义额',
  'zero-quantity': '数量为零或舍入为零',
  'zero-notional': '名义额为零',
  'price-underflow': '价格低于精度',
  'no-next-candle': '没有下一根',
};
export function ReplayCenter(props: Props) {
  const { model, records, busy } = props;
  const [quantity, setQuantity] = useState('all');
  const [note, setNote] = useState('');
  const [name, setName] = useState('历史回放快照');
  const view = model?.view,
    ended = !!view && view.cursor === view.total;
  return (
    <div className="replay-center">
      <section className="panel replay-panel">
        <h2>历史逐根回放与模拟账户</h2>
        <p>
          仅研究与虚拟USDT。每根收盘决策→下一根开盘成交；每根最多一笔，无未来预热、无倒退、末尾不强平。切换页面暂停，刷新只保留明确保存的快照。
        </p>
        {!model ? (
          <ReplaySetup
            datasets={props.datasets}
            busy={busy}
            onStart={props.onStart}
          />
        ) : (
          <>
            <p>
              {view!.source.symbol} · {view!.source.source.label} · 周期{' '}
              {view!.source.quality.intervalMs! / 1000} 秒；缺口{' '}
              {view!.source.quality.gapCount}，警告{' '}
              {view!.source.quality.warningCount}。来源与完整性不能认证。
            </p>
            <p>{view!.source.source.note}</p>
            <details>
              <summary>数据身份、锁定成本及质量</summary>
              <code>{view!.source.file.sha256}</code>
              <p>
                {JSON.stringify(view!.config)}；保护{' '}
                {JSON.stringify(view!.risk)}
              </p>
              {view!.source.quality.issues.map((q, i) => (
                <p key={i}>
                  {q.code}：{q.message}
                </p>
              ))}
            </details>
            <p role="status" data-testid="replay-cursor">
              已播放 {view!.cursor} / {view!.total} 根 ·{' '}
              {ended ? '已结束' : props.playing ? '自动播放中' : '已暂停'} ·{' '}
              {props.saved ? '当前状态已保存' : '当前状态尚未保存'}
            </p>
            <p data-testid="replay-readout">
              当前收盘 UTC{' '}
              {utc(
                model.candles.at(-1)!.timestampUtcMs +
                  view!.source.quality.intervalMs!,
              )}{' '}
              · 开 {model.candles.at(-1)!.open} · 高{' '}
              {model.candles.at(-1)!.high} · 低 {model.candles.at(-1)!.low} · 收{' '}
              {model.candles.at(-1)!.close} · 量 {model.candles.at(-1)!.volume}
            </p>
            <div className="replay-actions">
              <button
                disabled={busy || ended || props.playing}
                onClick={() => props.onAdvance()}
              >
                前进一根
              </button>
              <button
                disabled={ended || (busy && !props.playing)}
                onClick={props.onToggle}
              >
                {props.playing ? '暂停回放' : '自动播放'}
              </button>
              <label>
                播放间隔
                <select
                  disabled={busy}
                  value={props.speed}
                  onChange={(e) => props.onSpeed(Number(e.target.value))}
                >
                  <option value={2000}>2秒 / 根</option>
                  <option value={1000}>1秒 / 根</option>
                  <option value={250}>0.25秒 / 根</option>
                </select>
              </label>
              <button
                disabled={busy || ended || props.playing}
                onClick={() => props.onAdvance(100)}
              >
                快进最多100根
              </button>
              <button
                disabled={busy || ended || props.playing}
                onClick={() => props.onAdvance(50000)}
              >
                推进到末尾（逐根执行）
              </button>
            </div>
            <p>
              快进期间不接受中途决策；暂停在当前在途命令完成后生效。再次回看已知历史或恢复旧快照属于练习，不是盲测证据。
            </p>
            {view!.pending && (
              <p data-testid="replay-pending">
                待执行：{view!.pending.side === 'buy' ? '虚拟买入' : '虚拟卖出'}{' '}
                {view!.pending.quantity}
                ；下一根开盘成交，可能被已有保护优先取消或拒单。尚未成交，不扣款。
              </p>
            )}
            {ended && (
              <p>
                回放结束，无下一根可成交；未强制平仓，未平仓浮盈不算已完成胜负。
              </p>
            )}
            <div className="replay-actions">
              <label>
                虚拟订单数量（all或币数量）
                <input
                  disabled={busy || props.playing || ended}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <button
                disabled={busy || props.playing || ended || !!view!.pending}
                onClick={() => props.onTrade('buy', quantity)}
              >
                排队虚拟买入
              </button>
              <button
                disabled={busy || props.playing || ended || !!view!.pending}
                onClick={() => props.onTrade('sell', quantity)}
              >
                排队虚拟卖出
              </button>
            </div>
            <p>
              双边手续费 {view!.config.feeBps} bps，买/卖不利滑点{' '}
              {view!.config.buySlippageBps}/{view!.config.sellSlippageBps}{' '}
              bps。1bps=0.01%。数量/买价/卖价/费用沿用原舍入，资金或持仓不足明确拒单，不补款或透支。已有保护开盘优先、根内双触发止损优先，根内准确时间未知；无限流动性是假设。
            </p>
            <label>
              当前收盘交易日记（最多2000字符）
              <textarea
                value={note}
                disabled={busy || props.playing}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              disabled={
                busy || props.playing || !note.trim() || note.length > 2000
              }
              onClick={() => props.onNote(note)}
            >
              加入当前日记
            </button>
            <p>
              日记 {view!.notes.length}{' '}
              条（最多1000）；每次点击追加一条，不自动修改旧条目。
            </p>
            <label>
              回放快照名称
              <input
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="replay-actions">
              <button disabled={busy} onClick={() => props.onCheckpoint(name)}>
                保存回放状态
              </button>
              <button
                disabled={busy}
                onClick={() => props.onCheckpoint(name, true)}
              >
                导出回放 JSON
              </button>
              <button disabled={busy} onClick={props.onCsv}>
                导出回放交易 CSV
              </button>
              <button disabled={busy} onClick={props.onEnd}>
                结束当前回放
              </button>
            </div>
            <p>
              状态JSON不含行情；恢复须原保存数据集仍在且hash一致。未保存进度刷新丢失，IndexedDB不是永久备份。
            </p>
          </>
        )}
      </section>
      {model && (
        <>
          <ReplayAccount view={model.view} />
          <ReplayChart
            candles={model.candles}
            curve={model.curve}
            theme={props.theme}
          />
          <ReplayHistory view={model.view} />
        </>
      )}
      <section className="panel replay-panel">
        <h2>已保存回放状态</h2>
        <p>
          明确打开后校验数据身份并逐根重算，保持暂停。删除不影响原数据集或当前内存。JSON导入也不覆盖任何原记录。
        </p>
        <label>
          恢复回放 JSON（10MiB以内）
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onRestore(file);
              e.target.value = '';
            }}
          />
        </label>
        {!records.length && <p>尚无保存快照。</p>}
        {records.map((r) => (
          <div className="replay-snapshot" key={r.id}>
            <strong>
              {r.name} · {r.symbol} · 第 {r.cursor} 根
            </strong>
            <p>{utc(r.createdUtcMs)}</p>
            <button disabled={busy} onClick={() => props.onOpen(r.id)}>
              打开回放 {r.name}
            </button>{' '}
            <button disabled={busy} onClick={() => props.onDelete(r.id)}>
              删除回放 {r.name}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
function ReplaySetup({
  datasets,
  busy,
  onStart,
}: Pick<Props, 'datasets' | 'busy' | 'onStart'>) {
  const [id, setId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(DEFAULT_CONFIG).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [risk, setRisk] = useState({ stopLossBps: '', takeProfitBps: '' });
  const dataset = datasets.find((d) => d.id === id);
  const number = (s: string) => (s.trim() ? Number(s) : NaN);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (!dataset || !confirmed)
        throw new Error('请选择保存数据并确认全部收盘及质量警告。');
      if (dataset.quality.gapCount)
        throw new Error('缺口数据阻止回放，不自动修复。');
      onStart({
        kind: 'start',
        datasetId: id,
        confirmed: true,
        observedUtcMs: Date.now(),
        config: normalizeConfig({
          initialCash: config.initialCash,
          minNotional: config.minNotional,
          feeBps: number(config.feeBps),
          buySlippageBps: number(config.buySlippageBps),
          sellSlippageBps: number(config.sellSlippageBps),
          quantityDecimals: number(config.quantityDecimals),
        }),
        risk: normalizeRisk(
          Object.fromEntries(
            Object.entries(risk)
              .filter(([, v]) => v !== '')
              .map(([k, v]) => [k, number(v)]),
          ),
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '回放参数无效。');
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <legend>新建回放</legend>
        <label>
          回放数据集
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setConfirmed(false);
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
          <div>
            <p>
              {dataset.source.label} · {dataset.quality.validRows} 根 · 周期{' '}
              {dataset.quality.intervalMs! / 1000} 秒；缺口{' '}
              {dataset.quality.gapCount}，警告 {dataset.quality.warningCount}。
            </p>
            <p>{dataset.source.note}</p>
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
        <div className="replay-grid">
          {[
            ['initialCash', '回放初始资金 USDT'],
            ['feeBps', '回放双边手续费 bps'],
            ['buySlippageBps', '回放买入滑点 bps'],
            ['sellSlippageBps', '回放卖出滑点 bps'],
            ['quantityDecimals', '回放数量小数位'],
            ['minNotional', '回放最小名义额 USDT'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={config[key]}
                onChange={(e) =>
                  setConfig({ ...config, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            回放止损 bps（空为关闭）
            <input
              value={risk.stopLossBps}
              onChange={(e) =>
                setRisk({ ...risk, stopLossBps: e.target.value })
              }
            />
          </label>
          <label>
            回放止盈 bps（空为关闭）
            <input
              value={risk.takeProfitBps}
              onChange={(e) =>
                setRisk({ ...risk, takeProfitBps: e.target.value })
              }
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!dataset}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我确认回放数据全部已收盘，已阅读质量、费用、滑点与保护假设
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={!dataset || !confirmed || !!dataset.quality.gapCount}>
          开始历史回放
        </button>
      </fieldset>
    </form>
  );
}
function ReplayAccount({ view }: { view: ReplayView }) {
  const s = view.statistics;
  const values: [string, string][] = [
    ['现金 USDT', view.account.cash],
    ['持仓数量', view.account.position.quantity],
    ['持仓市值 USDT', view.account.marketValue],
    ['总权益 USDT', view.account.equity],
    ['回放总净盈亏 USDT', s.netPnl],
    ['回放已实现 USDT', s.realizedPnl],
    ['回放浮动盈亏 USDT', s.unrealizedPnl],
    ['回放手续费 USDT', s.fees],
    ['回放收益率', metric(s.totalReturn, true)],
    ['回放最大回撤', metric(s.maxDrawdown, true)],
    ['完成交易数', String(s.completedTradeCount)],
    ['回放胜率', metric(s.winRate, true)],
    ['回放利润因子', metric(s.profitFactor)],
    ['回放年化收益', metric(s.annualizedReturn, true)],
    ['同前缀买入持有收益', metric(s.benchmark.return, true)],
    ['回撤最长持续 ms', String(s.maxDrawdownDurationMs)],
  ];
  return (
    <section className="panel replay-panel">
      <h3>模拟账本与风险看板</h3>
      <dl className="replay-grid">
        {values.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-replay-metric={key}>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        权益=现金+持仓市值；已实现+未平仓浮动=净盈亏。胜负仅已完成空仓周期且已扣费用/滑点；不把浮盈计胜率。按已播放每根收盘市值计量，不扣未发生的平仓费。
      </p>
      <p>{s.benchmark.assumption}</p>
      <details>
        <summary>运行假设与统计定义</summary>
        <p>
          {view.version} / {view.engineVersion}
        </p>
        {[...view.assumptions, ...view.definitions].map((v, i) => (
          <p key={i}>{v}</p>
        ))}
        <code>{view.stateHash}</code>
      </details>
    </section>
  );
}
function ReplayHistory({ view }: { view: ReplayView }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(view.notes.length / 20)),
    current = Math.min(page, pages - 1);
  return (
    <section className="panel replay-panel">
      <h3>已播放成交、事件与日记</h3>
      <p>
        成交共{view.fillCount}笔、订单事件共{view.orderCount}
        项，下表各展示最近100项；完整成交与日记可导出CSV。
      </p>
      <div className="replay-scroll">
        <table aria-label="回放逐笔成交">
          <thead>
            <tr>
              {[
                '序号',
                'K线序号 / UTC',
                '方向 / 原因',
                '价格 / 数量',
                '费用 USDT',
                '现金 / 持仓 / 权益（成交后）',
              ].map((v) => (
                <th scope="col" key={v}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.fills.map((f) => (
              <tr key={f.sequence}>
                <td>{f.sequence}</td>
                <td>
                  {f.candleIndex + 1} /{' '}
                  {f.timestampUtcMs === null
                    ? '根内时间未知：' +
                      utc(f.trigger!.barOpenUtcMs) +
                      ' 至 ' +
                      utc(f.trigger!.barCloseUtcMs)
                    : utc(f.timestampUtcMs)}
                </td>
                <td>
                  {f.side === 'buy' ? '虚拟买入' : '虚拟卖出'} /{' '}
                  {reason[f.reason] ?? f.reason}{' '}
                  {f.trigger?.assumption === 'ambiguous-stop-first'
                    ? '双触发保守止损优先'
                    : ''}
                </td>
                <td>
                  {f.price} / {f.quantity}
                </td>
                <td>{f.fee}</td>
                <td>
                  {f.after.cash} / {f.after.position.quantity} /{' '}
                  {f.after.equity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="replay-scroll">
        <table aria-label="回放订单事件">
          <thead>
            <tr>
              <th>订单</th>
              <th>状态</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {view.orders.map((o, i) => (
              <tr key={o.intent.id + '-' + i}>
                <td>{o.intent.id}</td>
                <td>
                  {
                    {
                      filled: '已成交',
                      rejected: '拒绝',
                      cancelled: '取消',
                      expired: '到期',
                    }[o.status]
                  }
                </td>
                <td>
                  {reason[o.reason ?? o.intent.reason] ??
                    o.reason ??
                    o.intent.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>交易日记</h4>
      <ol aria-label="回放交易日记">
        {view.notes.slice(current * 20, current * 20 + 20).map((n, i) => (
          <li key={current * 20 + i}>
            第{n.cursor}根收盘：{n.text}
          </li>
        ))}
      </ol>
      <button disabled={current === 0} onClick={() => setPage(current - 1)}>
        上一页日记
      </button>{' '}
      第{current + 1}/{pages}页{' '}
      <button
        disabled={current === pages - 1}
        onClick={() => setPage(current + 1)}
      >
        下一页日记
      </button>
    </section>
  );
}
