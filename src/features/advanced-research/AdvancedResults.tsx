import { useState } from 'react';
import { sealRule, type RuleRecord } from '../../core/rule-library';
import type { AdvancedReport } from '../../core/advanced-research/report';
import type { CandidateRow } from '../../core/advanced-research/types';
import { axisLabel, metricNames, percent } from './presentation';

type Props = {
  report: AdvancedReport;
  rules: RuleRecord[];
  busy: boolean;
  onSaveRule: (rule: RuleRecord) => Promise<boolean>;
};
function Scatter({ rows }: { rows: CandidateRow[] }) {
  const points = rows.flatMap((r) =>
    r.metrics?.maxDrawdown != null && r.metrics.totalReturn != null
      ? [
          {
            id: r.candidateId,
            x: Number(r.metrics.maxDrawdown) * 100,
            y: Number(r.metrics.totalReturn) * 100,
          },
        ]
      : [],
  );
  if (!points.length) return <p>该训练窗口缺少可绘制的收益与回撤。</p>;
  const xMax = Math.max(...points.map((p) => p.x), 0.01),
    yMin = Math.min(0, ...points.map((p) => p.y)),
    yMax = Math.max(0, ...points.map((p) => p.y));
  const projectY = (v: number) => 168 - ((v - yMin) / (yMax - yMin || 1)) * 140;
  const label = (v: number) =>
    v.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  return (
    <figure className="advanced-scatter">
      <figcaption>训练候选收益与回撤</figcaption>
      <svg
        viewBox="0 0 480 216"
        role="img"
        aria-label="训练候选的收益率与最大回撤散点图"
      >
        <g stroke="var(--muted)" fill="none">
          <path d="M80 20 V168 H456" />
          <line x1={80} x2={456} y1={projectY(0)} y2={projectY(0)} />
        </g>
        <g fill="var(--muted)" fontSize="11">
          <text x="8" y="14">
            收益率 (%)
          </text>
          <text textAnchor="end" x="73" y="170">
            {label(yMin)}
          </text>
          {yMax !== yMin && (
            <text textAnchor="end" x="73" y="32">
              {label(yMax)}
            </text>
          )}
          <text x="79" y="186">
            0
          </text>
          <text textAnchor="end" x="455" y="186">
            {label(xMax)}
          </text>
          <text x="210" y="205">
            最大回撤 (%)
          </text>
        </g>
        {points.map((p) => (
          <circle
            key={p.id}
            cx={80 + (p.x / xMax) * 376}
            cy={projectY(p.y)}
            r={4.5}
            fill="var(--accent)"
            opacity=".75"
          >
            <title>{`候选 ${p.id}，收益 ${label(p.y)}%，回撤 ${label(p.x)}%`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}
function Regimes({ row }: { row: CandidateRow }) {
  return (
    <div className="advanced-scroll">
      <table>
        <caption>
          {row.window.role === 'test' ? '测试' : '训练'}窗口 · 候选{' '}
          {row.candidateId} 的市场状态归因
        </caption>
        <thead>
          <tr>
            {[
              '状态',
              '根数',
              '净盈亏',
              '已实现变化',
              '浮动变化',
              '成交数',
              '手续费',
            ].map((t) => (
              <th key={t}>{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row.regimes?.map((s) => (
            <tr key={s.state}>
              <th scope="row">{s.state}</th>
              <td>{s.bars}</td>
              <td>{s.netPnl}</td>
              <td>{s.realizedDelta}</td>
              <td>{s.unrealizedDelta}</td>
              <td>{s.fills}</td>
              <td>{s.fees}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function FoldResults({
  report,
  foldIndex,
  rules,
  busy,
  onSaveRule,
}: Props & { foldIndex: number }) {
  const fold = report.result.folds[foldIndex];
  const [choice, setChoice] = useState('');
  const [promotion, setPromotion] = useState('');
  const [saving, setSaving] = useState(false);
  const candidate = report.result.plan.candidates.find(
    (c) => String(c.id) === choice,
  );
  const selected = fold.train.find((r) => r.candidateId === candidate?.id);
  const locked = fold.train.find((r) => r.candidateId === fold.selectedId);
  const test = fold.test;
  const { input } = report;
  const params = (id: number) =>
    report.result.plan.candidates.find((c) => c.id === id)!.values.join(' / ');
  const windows = report.result.plan.windows.slice(
    foldIndex * 2,
    foldIndex * 2 + 2,
  );
  const range = (start: number, end: number) => {
    const bars = input.dataset.candles;
    return `[${new Date(bars[start].timestampUtcMs).toISOString()}, ${new Date(bars[end - 1].timestampUtcMs + input.dataset.quality.intervalMs!).toISOString()})`;
  };
  async function promote() {
    if (!candidate || saving) return;
    setSaving(true);
    const source = input.ruleRecord;
    try {
      const revision =
        1 +
        Math.max(
          source.rule.revision,
          ...rules
            .filter((r) => r.familyId === source.familyId)
            .map((r) => r.rule.revision),
        );
      const next = sealRule(
        { ...candidate.rule, revision },
        {
          familyId: source.familyId,
          name: source.name,
          createdUtcMs: Date.now(),
        },
      );
      const saved = await onSaveRule(next);
      setPromotion(
        saved
          ? `已保存候选 ${candidate.id} 为「${next.name}」v${revision}。`
          : '候选版本保存失败，请检查策略版本库。',
      );
    } catch (e) {
      setPromotion(e instanceof Error ? e.message : '无法保存新规则版本。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="advanced-ranges">
        {windows.map((w) => (
          <p key={w.role}>
            <strong>{w.role === 'train' ? '训练' : '测试'}窗口</strong> · 第{' '}
            {w.start + 1}–{w.end} 根 · {range(w.start, w.end)} UTC
          </p>
        ))}
      </div>
      <h3>锁定参数与样本外验证</h3>
      {locked ? (
        <>
          <p>
            训练锁定候选 <strong>{locked.candidateId}</strong> · 参数{' '}
            {params(locked.candidateId)}
          </p>
          <div className="advanced-scroll">
            <table>
              <caption>同一锁定候选的独立账户表现</caption>
              <thead>
                <tr>
                  {[
                    '窗口',
                    '收益率',
                    '最大回撤',
                    '利润因子',
                    '完成交易数',
                    '期末权益',
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[locked, test].map(
                  (row, i) =>
                    row && (
                      <tr key={i}>
                        <th>{i ? '样本外测试' : '训练'}</th>
                        <td>{percent(row.metrics?.totalReturn)}</td>
                        <td>{percent(row.metrics?.maxDrawdown)}</td>
                        <td>{row.metrics?.profitFactor ?? 'NA'}</td>
                        <td>{row.metrics?.completedTrades ?? 'NA'}</td>
                        <td>{row.metrics?.finalEquity ?? 'NA'}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
          </div>
          {test?.metrics?.totalReturn != null &&
            locked.metrics?.totalReturn != null && (
              <p>
                测试相对训练的收益率差{' '}
                {(
                  100 *
                  (Number(test.metrics.totalReturn) -
                    Number(locked.metrics.totalReturn))
                ).toLocaleString('zh-CN', { maximumFractionDigits: 5 })}{' '}
                个百分点。
              </p>
            )}
          {test?.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </>
      ) : (
        <p>没有训练候选满足筛选条件，本窗口跳过独立测试。</p>
      )}
      <p className="advanced-warning">
        过拟合风险随尝试的参数组合增多。反复查看测试结果后调参会影响样本外证据。各窗独立核算收益。
      </p>
      <Scatter rows={fold.train} />
      <div className="advanced-scroll">
        <table>
          <caption>
            训练结果 ·{' '}
            {input.axes.map((a) => axisLabel(a, input.ruleRecord)).join(' / ')}
          </caption>
          <thead>
            <tr>
              {[
                '候选',
                '参数',
                '收益率',
                '最大回撤',
                '利润因子',
                '完成交易数',
                '筛选 / 执行结果',
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fold.train.map((row) => (
              <tr key={row.candidateId}>
                <th>{row.candidateId}</th>
                <td>{params(row.candidateId)}</td>
                <td>{percent(row.metrics?.totalReturn)}</td>
                <td>{percent(row.metrics?.maxDrawdown)}</td>
                <td>{row.metrics?.profitFactor ?? 'NA'}</td>
                <td>{row.metrics?.completedTrades ?? 'NA'}</td>
                <td>
                  {row.reasons.join(' ') ||
                    (row.candidateId === fold.selectedId ? '已锁定' : '通过')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>查看候选与另存版本</h3>
      <label>
        查看训练候选
        <select
          value={choice}
          disabled={saving}
          onChange={(e) => {
            setChoice(e.target.value);
            setPromotion('');
          }}
        >
          <option value="">请选择候选</option>
          {fold.train.map((row) => (
            <option key={row.candidateId} value={row.candidateId}>
              候选 {row.candidateId} · {params(row.candidateId)}
            </option>
          ))}
        </select>
      </label>
      {selected && candidate && (
        <>
          <p>
            该规则全部启用条件的预热长度为 {candidate.warmupBars}{' '}
            根。状态按上一根收盘标签归因本根盈亏。
          </p>
          {selected.regimes && <Regimes row={selected} />}
          {test?.candidateId === selected.candidateId && test.regimes && (
            <Regimes row={test} />
          )}
          <button
            disabled={busy || saving || !!promotion.startsWith('已保存')}
            onClick={() => void promote()}
          >
            将选中候选保存为新规则版本
          </button>
          {promotion && <p role="status">{promotion}</p>}
        </>
      )}
    </>
  );
}
export function AdvancedResults(props: Props) {
  const [foldIndex, setFoldIndex] = useState(0);
  const { report: r } = props;
  const i = r.input;
  return (
    <section className="panel">
      <h2>{r.name}</h2>
      <p>
        {i.dataset.symbol} · {i.dataset.candles.length} 根 · {i.ruleRecord.name}{' '}
        v{i.ruleRecord.rule.revision} · {r.algorithmVersion}
      </p>
      <p>
        报告 SHA-256{' '}
        <code data-testid="advanced-report-hash">{r.reportHash}</code>
      </p>
      <details>
        <summary>本次研究配置与结构拒绝</summary>
        <p>
          搜索方式{' '}
          {i.search.kind === 'grid'
            ? '有界网格'
            : `随机抽样 ${i.search.count}，种子 ${i.search.seed}`}{' '}
          · 候选 {r.result.plan.candidates.length} · 排序{' '}
          {i.sort.map((x) => metricNames[x]).join(' → ')}
        </p>
        {i.axes.map((a, j) => (
          <p key={j}>
            {axisLabel(a, i.ruleRecord)} · {a.min}–{a.max}，步长 {a.step}
          </p>
        ))}
        <p>
          最低收益率 {percent(i.filters.minReturn)} · 最大允许回撤{' '}
          {percent(i.filters.maxDrawdown)} · 最低利润因子{' '}
          {i.filters.minProfitFactor ?? '未设'} · 最少完成交易{' '}
          {i.filters.minTrades} 次
        </p>
        <p>
          本金 {i.config.initialCash} · 手续费 {i.config.feeBps} 基点 · 买卖滑点{' '}
          {i.config.buySlippageBps} / {i.config.sellSlippageBps} 基点 ·
          状态观察周期 {i.regime.lookback} 根 / 阈值 {i.regime.thresholdBps}{' '}
          基点
        </p>
        <p>结构拒绝 {r.result.plan.invalid.length} 组。</p>
        {r.result.plan.invalid.length > 0 && (
          <ul>
            {r.result.plan.invalid.map((v, j) => (
              <li key={j}>
                {v.values.join(' / ')} · {v.reason}
              </li>
            ))}
          </ul>
        )}
      </details>
      <label>
        查看训练 / 测试窗口
        <select
          value={foldIndex}
          onChange={(e) => setFoldIndex(Number(e.target.value))}
        >
          {r.result.folds.map((_, j) => (
            <option key={j} value={j}>
              第 {j + 1} 组
            </option>
          ))}
        </select>
      </label>
      <FoldResults key={foldIndex} {...props} foldIndex={foldIndex} />
    </section>
  );
}
