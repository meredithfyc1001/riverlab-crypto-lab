import type { DatasetSummary } from '../../core/data/dataset';
import type { RuleRecord } from '../../core/rule-library';
import { useAdvancedWorkbench } from './useAdvancedWorkbench';
import { ResearchSetup } from './ResearchSetup';
import { AdvancedResults } from './AdvancedResults';
import './advanced-research.css';

export default function AdvancedResearchCenter({
  datasets,
  rules,
  onSaveRule,
}: {
  datasets: DatasetSummary[];
  rules: RuleRecord[];
  onSaveRule: (r: RuleRecord) => Promise<boolean>;
}) {
  const w = useAdvancedWorkbench();
  return (
    <div className="advanced-workbench">
      <ResearchSetup datasets={datasets} rules={rules} work={w} />
      {w.message && <p role="status">{w.message}</p>}
      {w.error && <p role="alert">{w.error}</p>}
      {w.progress && (
        <label>
          计算进度 {w.progress.done} / {w.progress.total}
          <progress max={w.progress.total} value={w.progress.done} />
        </label>
      )}
      {w.cancellable && <button onClick={w.cancel}>取消高级研究任务</button>}
      {w.report && (
        <>
          <AdvancedResults
            key={w.report.reportHash}
            report={w.report}
            rules={rules}
            onSaveRule={onSaveRule}
            busy={w.busy}
          />
          <div className="advanced-actions">
            <button disabled={w.busy || w.saved} onClick={w.save}>
              保存高级研究报告
            </button>
            <button disabled={w.busy} onClick={() => w.download('json')}>
              导出高级研究 JSON
            </button>
            <button disabled={w.busy} onClick={() => w.download('csv')}>
              导出高级研究 CSV
            </button>
          </div>
        </>
      )}
      <section className="panel">
        <h2>高级研究报告库</h2>
        <label>
          恢复高级研究 JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={w.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) w.restore(file);
            }}
          />
        </label>
        <p>
          完整 JSON 含数据和规则快照，可在新浏览器配置中重算。确认结果后可保存。
        </p>
        {w.listError ? (
          <p role="alert">高级研究报告库读取失败。{w.listError}</p>
        ) : !w.records ? (
          <p>正在读取报告库…</p>
        ) : (
          <>
            {w.records.damagedCount > 0 && (
              <p role="alert">
                高级研究报告库已隔离 {w.records.damagedCount} 条损坏摘要，可用{' '}
                {w.records.items.length} 条。
              </p>
            )}
            {!w.records.items.length && !w.records.damagedCount && (
              <p>尚无已保存的高级研究报告。</p>
            )}
            <ul className="advanced-report-list">
              {w.records.items.map((row) => (
                <li key={row.id}>
                  <span>
                    {row.name} · {new Date(row.createdUtcMs).toISOString()} ·{' '}
                    {row.reportHash.slice(0, 12)}
                  </span>
                  <button disabled={w.busy} onClick={() => w.open(row)}>
                    重开 {row.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
