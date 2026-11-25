import { useRef, useState } from 'react';
import type { DatasetSummary } from '../../core/data/dataset';
import type { RuleRecord } from '../../core/rule-library';
import { decimal, parseDecimal, SCALE } from '../../core/math';
import {
  previewAlignment,
  MAX_PORTFOLIO_BARS,
} from '../../core/portfolio/alignment';
import type { AlignmentPreview } from '../../core/portfolio/alignment';
import { AllocationEditor } from './AllocationEditor';
import { newAllocation, buildAllocation } from './allocation';
import type { AllocationDraft } from './allocation';
import type { PortfolioWorkbench } from './model';
import { PortfolioResults } from './PortfolioResults';
import './portfolio.css';

import { AlignmentTable } from './AlignmentTable';
const utc = (value: number) => new Date(value).toISOString();
export default function PortfolioCenter({
  datasets,
  rules,
  ruleError,
  workbench: w,
  theme,
}: {
  datasets: DatasetSummary[];
  rules: RuleRecord[];
  ruleError: string;
  workbench: PortfolioWorkbench;
  theme: 'dark' | 'light';
}) {
  const [rows, setRows] = useState(() => [
    newAllocation(1, '50'),
    newAllocation(2, '50'),
  ]);
  const nextKey = useRef(3);
  const [quote, setQuote] = useState('USDT'),
    [capital, setCapital] = useState('1000'),
    [name, setName] = useState('组合实验');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [removeId, setRemoveId] = useState('');
  const selected = rows.map((row) =>
    datasets.find((dataset) => dataset.id === row.datasetId),
  );
  const complete = selected.every((d): d is DatasetSummary => d !== undefined);
  let full: AlignmentPreview | undefined,
    preview: AlignmentPreview | undefined,
    alignmentError = '';
  if (complete) {
    try {
      full = previewAlignment(selected, quote);
      const first = start === '' ? full.commonStartUtcMs : Number(start);
      const last = end === '' ? full.commonEndUtcMs : Number(end);
      preview = previewAlignment(selected, quote, first, last);
    } catch (e) {
      alignmentError = e instanceof Error ? e.message : '无法对齐行情。';
    }
  }
  let totalWeight: bigint | undefined;
  try {
    totalWeight = rows.reduce(
      (sum, row) => sum + parseDecimal(row.weightPercent),
      0n,
    );
  } catch {
    /* Incomplete input while typing. */
  }
  function reset() {
    setConfirmed(false);
    setError('');
  }
  function update(key: number, patch: Partial<AllocationDraft>) {
    reset();
    if (patch.datasetId !== undefined) {
      setStart('');
      setEnd('');
    }
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }
  function run(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (
      !complete ||
      !preview ||
      !confirmed ||
      alignmentError ||
      totalWeight !== 100n * SCALE
    )
      return;
    try {
      if (preview.endUtcMs + preview.intervalMs > Date.now())
        throw new Error('选定的末根 K 线尚未收盘。');
      const assets = rows.map((row, index) =>
        buildAllocation(row, selected[index], rules),
      );
      w.run(
        {
          assets,
          initialCash: capital,
          quoteCurrency: quote,
          startUtcMs: preview.startUtcMs,
          endUtcMs: preview.endUtcMs,
          rangeConfirmed: true,
          completedThroughUtcMs: preview.endUtcMs + preview.intervalMs,
        },
        name,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '组合输入无效。');
    }
  }
  return (
    <div className="portfolio">
      <section className="panel">
        <div className="section-heading">
          <h2>组合配置</h2>
          <a className="text-link" href="#/backtests">
            单币种回测
          </a>
        </div>
        <p>
          选择 2–5
          个不同交易对，以同一报价币建立独立虚拟子账户。子策略在共同区间首根冷启动。持仓随各自策略变化，资金始终留在原子账户。
        </p>
        {datasets.length < 2 && (
          <p>
            <a href="#/datasets" className="text-link">
              前往数据中心保存不同交易对的历史行情 →
            </a>
          </p>
        )}
        {ruleError && <p role="alert">{ruleError}</p>}
        <form onSubmit={run} noValidate>
          <fieldset className="portfolio-form" disabled={w.busy}>
            <div className="portfolio-grid">
              <label>
                实验名称
                <input
                  value={name}
                  maxLength={160}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                组合初始虚拟本金
                <input
                  value={capital}
                  inputMode="decimal"
                  onChange={(e) => {
                    reset();
                    setCapital(e.target.value);
                  }}
                />
              </label>
              <label>
                统一报价货币
                <input
                  value={quote}
                  onChange={(e) => {
                    reset();
                    setQuote(e.target.value.trim().toUpperCase());
                  }}
                />
              </label>
            </div>
            {rows.map((row, i) => (
              <AllocationEditor
                key={row.key}
                row={row}
                index={i}
                datasets={datasets}
                rules={rules}
                update={(patch) => update(row.key, patch)}
                remove={
                  rows.length > 2
                    ? () => {
                        reset();
                        setStart('');
                        setEnd('');
                        setRows((list) =>
                          list.filter((r) => r.key !== row.key),
                        );
                      }
                    : undefined
                }
              />
            ))}
            <div className="portfolio-actions">
              <button
                type="button"
                disabled={rows.length >= 5}
                onClick={() => {
                  reset();
                  setStart('');
                  setEnd('');
                  setRows([...rows, newAllocation(nextKey.current++, '')]);
                }}
              >
                添加子账户
              </button>
              <span>
                初始分配合计{' '}
                {totalWeight === undefined
                  ? '待填写'
                  : decimal(totalWeight) + '%'}
                （须为 100%）
              </span>
            </div>
            <p>
              初始本金按 18
              位定点分配。各账户先向下取整，余下的最小单位依次给小数余数最大的账户，余数相同按交易对名称排序。
            </p>
            <h3>共同历史区间</h3>
            <p>
              所有源行情合计最多 {MAX_PORTFOLIO_BARS.toLocaleString('en-US')}{' '}
              根，包含被截去的部分。可缩小下方区间，首尾必须落在各币种共同的开盘时间上。
            </p>
            {full && (
              <div className="portfolio-grid">
                <label>
                  起始开盘时间（UTC 毫秒）
                  <input
                    inputMode="numeric"
                    value={start || String(full.commonStartUtcMs)}
                    onChange={(e) => {
                      reset();
                      setStart(e.target.value);
                    }}
                  />
                </label>
                <label>
                  末根开盘时间（UTC 毫秒）
                  <input
                    inputMode="numeric"
                    value={end || String(full.commonEndUtcMs)}
                    onChange={(e) => {
                      reset();
                      setEnd(e.target.value);
                    }}
                  />
                </label>
              </div>
            )}
            {preview && <AlignmentTable value={preview} />}
            {alignmentError && <p role="alert">{alignmentError}</p>}
            {!complete && <p>选齐数据集后可预览共同区间和各自的截取范围。</p>}
            <label className="portfolio-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!preview || !!alignmentError}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认共同区间、截取范围及全部选定 K
              线已收盘，各子策略自区间首根启动。
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              className="portfolio-run"
              disabled={
                !confirmed ||
                !preview ||
                !!alignmentError ||
                totalWeight !== 100n * SCALE ||
                !name.trim()
              }
            >
              运行组合回测
            </button>
          </fieldset>
        </form>
      </section>
      {w.message && <p role="status">{w.message}</p>}
      {w.error && <p role="alert">{w.error}</p>}
      {w.canCancel && <button onClick={w.cancel}>取消组合任务</button>}
      {w.record && (
        <PortfolioResults
          key={w.record.payloadHash}
          record={w.record}
          workbench={w}
          theme={theme}
        />
      )}
      <section className="panel">
        <h2>已保存组合实验</h2>
        <p>
          完整 JSON 包含所有行情、策略版本、配置和结果，报告上限 32
          MiB。导入后会在 Worker
          中校验并重算，点击保存即可在新浏览器中重新打开。
        </p>
        <label>
          导入组合 JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={w.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) w.restore(file);
              e.target.value = '';
            }}
          />
        </label>
        {w.records.length === 0 && <p>本机暂无已保存的组合实验。</p>}
        {w.records.map((item) => (
          <div key={item.id} className="portfolio-saved">
            <h3>{item.name}</h3>
            <p>
              {item.symbols.join(' · ')} · {utc(item.createdUtcMs)}
            </p>
            <div className="portfolio-actions">
              <button disabled={w.busy} onClick={() => w.open(item.id)}>
                重新打开 {item.name}
              </button>
              <button disabled={w.busy} onClick={() => setRemoveId(item.id)}>
                删除组合实验 {item.name}
              </button>
              {removeId === item.id && (
                <>
                  <button
                    disabled={w.busy}
                    onClick={() => {
                      setRemoveId('');
                      w.remove(item.id);
                    }}
                  >
                    确认删除组合实验
                  </button>
                  <button onClick={() => setRemoveId('')}>取消删除</button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
