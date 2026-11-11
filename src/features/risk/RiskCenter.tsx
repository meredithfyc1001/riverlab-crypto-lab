import { useState } from 'react';
import type { ExperimentSummary } from '../../core/experiments';
import { normalizeRiskSettings } from '../../core/risk-analysis';
import type {
  RiskSettings,
  RiskStudy,
  RiskSummary,
  SourcePreview,
  Frequency,
} from '../../core/risk-analysis';
import { RiskPlots } from './RiskPlots';
import './risk.css';
interface Props {
  experiments: ExperimentSummary[];
  preview: SourcePreview | null;
  record: RiskStudy | null;
  records: RiskSummary[];
  busy: boolean;
  saved: boolean;
  onSelect: (id: string) => void;
  onRun: (settings: RiskSettings) => void;
  onSave: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (file: File) => void;
  onExport: (format: 'json' | 'csv') => void;
}
const utc = (ms: number) => new Date(ms).toISOString();
const percent = (v: string) => (Number(v) * 100).toFixed(2) + '%';
const frequency = (v: Frequency) =>
  v.count + ' / ' + v.total + '（' + percent(v.fraction) + '）';
export function RiskCenter(props: Props) {
  const [sourceId, setSourceId] = useState(''),
    [method, setMethod] = useState<'iid' | 'block'>('iid'),
    [settings, setSettings] = useState({
      seed: '42',
      paths: '500',
      steps: '100',
      blockSize: '5',
      thresholdPct: '50',
    }),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (!props.preview || !confirmed)
        throw new Error('请先检查源实验并确认重采样口径。');
      const number = (s: string) => (s.trim() ? Number(s) : NaN);
      props.onRun(
        normalizeRiskSettings(
          {
            method,
            seed: number(settings.seed),
            paths: number(settings.paths),
            steps: number(settings.steps),
            blockSize: method === 'iid' ? 1 : number(settings.blockSize),
            thresholdPct: number(settings.thresholdPct),
          },
          props.preview.periods,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '参数无效。');
    }
  }
  return (
    <div className="risk-center">
      <section className="panel risk-panel">
        <h2>Monte Carlo 风险分析</h2>
        <p>
          将已扣原手续费/滑点的历史收盘权益比例做条件情景重采样，包括未平仓浮动盈亏。输出不是未来收益预测、置信区间、真实亏损概率或最佳策略排名。
        </p>
        <label>
          源回测实验
          <select
            value={sourceId}
            disabled={props.busy}
            onChange={(e) => {
              setSourceId(e.target.value);
              setConfirmed(false);
              setError('');
              props.onSelect(e.target.value);
            }}
          >
            <option value="">请选择已保存的三策略回测实验</option>
            {props.experiments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.symbol} · {e.name} · {e.strategy}
              </option>
            ))}
          </select>
        </label>
        {!props.experiments.length && (
          <p>
            先在<a href="#/backtests">回测中心</a>
            运行正式策略并保存实验。源需至少20根、权益严格为正且有变化；不把空数据或常量权益报告为0%风险。
          </p>
        )}
        {props.preview && <SourceFacts preview={props.preview} />}
        <form onSubmit={submit} noValidate>
          <fieldset disabled={props.busy}>
            <legend>锁定重采样设置</legend>
            <label>
              抽样方法
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                <option value="iid">IID 独立有放回</option>
                <option value="block">连续区块有放回</option>
              </select>
            </label>
            <div className="risk-grid">
              {[
                ['seed', '随机种子 uint32'],
                ['paths', '模拟路径数（20–2000）'],
                ['steps', '每路径步数（1–50000）'],
                ...(method === 'block' ? [['blockSize', '连续区块长度']] : []),
                ['thresholdPct', '触及本金比例阈值 %（1–99）'],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={settings[key as keyof typeof settings]}
                    onChange={(e) =>
                      setSettings({ ...settings, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              总路径×步数最多200万，超限阻止运行。固定PCG32/stream54，seed0–4294967295；连续区块最长min(源长度,1000)。同源、同种子和配置输出完全一致，不使用系统随机或网络。
            </p>
            <p>
              IID破坏自相关；区块仅保留块内顺序。阈值是初始本金比例，不是峰值回撤。重采样不会重新撮合/重算费用/保护，不能保证原策略能实现重采样路径。
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!props.preview}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认源成本、浮动盈亏、抽样假设和分位并非未来保证
            </label>
            {error && <p role="alert">{error}</p>}
            <button disabled={!props.preview || !confirmed}>
              运行风险分析
            </button>
          </fieldset>
        </form>
      </section>
      {props.record && (
        <RiskResults
          key={props.record.id}
          record={props.record}
          busy={props.busy}
          saved={props.saved}
          onSave={props.onSave}
          onExport={props.onExport}
        />
      )}
      <section className="panel risk-panel">
        <h2>已保存风险报告</h2>
        <p>
          刷新仅保留明确保存的列表，需主动打开；未保存结果会丢失。JSON导入仅内存，仍需保存；源复现输入已内嵌，源实验删除后也可重算，原数据和实验不覆盖。IndexedDB不是永久备份。
        </p>
        <label>
          恢复风险 JSON（25MiB以内）
          <input
            type="file"
            accept=".json,application/json"
            disabled={props.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onRestore(file);
              e.target.value = '';
            }}
          />
        </label>
        {!props.records.length && <p>尚无保存的风险报告。</p>}
        {props.records.map((r) => (
          <div className="risk-snapshot" key={r.id}>
            <strong>
              {r.name} · {r.symbol}
            </strong>
            <p>
              {utc(r.createdUtcMs)} · 源 {r.sourceName}
            </p>
            <button disabled={props.busy} onClick={() => props.onOpen(r.id)}>
              打开风险报告 {r.name}
            </button>{' '}
            <button disabled={props.busy} onClick={() => props.onDelete(r.id)}>
              删除风险报告 {r.name}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
function SourceFacts({ preview: p }: { preview: SourcePreview }) {
  return (
    <section data-testid="risk-source-preview">
      <h3>已校验源实验：{p.name}</h3>
      <p>
        {p.symbol} · {p.source} · {p.periods}根 · 周期{p.intervalMs / 1000}秒 ·{' '}
        {utc(p.startUtcMs)} 至 {utc(p.endUtcMs)}
      </p>
      <p>
        源本金 {p.initialCash} USDT；累计手续费 {p.fees} USDT；已实现{' '}
        {p.realizedPnl}；未平仓浮动 {p.unrealizedPnl}。只有源完成交易数{' '}
        {p.completedTrades} 用于原胜率，重采样频率不是交易胜率。
      </p>
      <p>
        原策略{JSON.stringify(p.strategy)}；原成本{JSON.stringify(p.config)}
        ；原保护{JSON.stringify(p.risk)}。
      </p>
      <details>
        <summary>源质量、身份与复现hash</summary>
        <p>
          payloadHash <code>{p.payloadHash}</code>；dataHash{' '}
          <code>{p.dataHash}</code>；runHash <code>{p.runHash}</code>；原文件{' '}
          <code>{p.fileHash}</code>
        </p>
        {p.warnings.map((w, i) => (
          <p key={i}>{w}</p>
        ))}
      </details>
    </section>
  );
}
function RiskResults({
  record: r,
  busy,
  saved,
  onSave,
  onExport,
}: {
  record: RiskStudy;
  busy: boolean;
  saved: boolean;
  onSave: () => void;
  onExport: (format: 'json' | 'csv') => void;
}) {
  const [page, setPage] = useState(0),
    s = r.payload.simulation,
    maxPage = Math.ceil(s.paths.length / 20) - 1;
  return (
    <section data-testid="risk-results">
      <section className="panel risk-panel">
        <h2>风险重采样结果</h2>
        <p>
          {s.settings.paths}条路径×{s.settings.steps}步；源{s.sourcePeriods}
          个净权益比例；方法{s.settings.method}，seed{s.settings.seed}，区块
          {s.settings.blockSize}。Worker耗时{r.elapsedMs.toFixed(0)}ms；
          {saved ? '当前报告已保存' : '当前报告尚未保存'}。
        </p>
        <SourceFacts preview={r.payload.preview} />
        <dl className="risk-grid">
          <div>
            <dt>模型内最终低于本金频率</dt>
            <dd data-risk-metric="loss">{frequency(s.loss)}</dd>
          </div>
          <div>
            <dt>模型内触及本金{s.settings.thresholdPct}%频率</dt>
            <dd data-risk-metric="threshold">{frequency(s.thresholdHits)}</dd>
          </div>
          <div>
            <dt>模型内归零（含18位舍入）</dt>
            <dd>{frequency(s.zeros)}</dd>
          </div>
          <div>
            <dt>平均终值 USDT（向下至18位）</dt>
            <dd>{s.meanFinalEquity}</dd>
          </div>
        </dl>
        <p>
          阈值金额 {s.thresholdEquity}{' '}
          USDT。0/路径数仅表示本次未观测，不意味着真实风险为0。所有资金18位BigInt，每步向下舍入；归零吸收；极端金额超限整批失败，不删极端路径。
        </p>
        <div className="risk-scroll">
          <table aria-label="风险分位摘要">
            <caption>
              终值/收益与最大回撤分别排序，同行分位不代表同一条路径。
            </caption>
            <thead>
              <tr>
                <th>分位</th>
                <th>终值 USDT</th>
                <th>收益率</th>
                <th>最大收盘回撤</th>
              </tr>
            </thead>
            <tbody>
              {s.quantiles.map((q) => (
                <tr key={q.percentile}>
                  <th>{q.percentile}%</th>
                  <td>{q.finalEquity}</td>
                  <td>{percent(q.totalReturn)}</td>
                  <td>{percent(q.maxDrawdown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.warnings.map((w, i) => (
          <p key={i} role={i === 0 ? 'note' : undefined}>
            {w}
          </p>
        ))}
        <div className="risk-actions">
          <button disabled={busy || saved} onClick={onSave}>
            保存风险报告
          </button>
          <button disabled={busy} onClick={() => onExport('json')}>
            导出风险 JSON
          </button>
          <button disabled={busy} onClick={() => onExport('csv')}>
            导出风险 CSV
          </button>
        </div>
        <details>
          <summary>算法、随机与指标定义</summary>
          <p>
            {r.payload.version} / {s.version} / {s.rngVersion}
          </p>
          {r.payload.definitions.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
          <p>
            payloadHash <code>{r.payloadHash}</code>
          </p>
        </details>
        <p>{r.payload.disclaimer}。</p>
      </section>
      <RiskPlots simulation={s} />
      <section className="panel risk-panel">
        <h3>模拟路径摘要（全路径CSV可导出）</h3>
        <div className="risk-scroll">
          <table aria-label="模拟路径摘要">
            <thead>
              <tr>
                <th>路径</th>
                <th>终值 USDT</th>
                <th>净盈亏 USDT</th>
                <th>收益率</th>
                <th>最大回撤</th>
                <th>触及阈值</th>
              </tr>
            </thead>
            <tbody>
              {s.paths.slice(page * 20, page * 20 + 20).map((p) => (
                <tr key={p.path}>
                  <td>{p.path}</td>
                  <td>{p.finalEquity}</td>
                  <td>{p.netPnl}</td>
                  <td>{percent(p.totalReturn)}</td>
                  <td>{percent(p.maxDrawdown)}</td>
                  <td>{p.thresholdHit ? '是' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          上一页路径
        </button>{' '}
        第{page + 1}/{maxPage + 1}页{' '}
        <button disabled={page === maxPage} onClick={() => setPage(page + 1)}>
          下一页路径
        </button>
      </section>
    </section>
  );
}
