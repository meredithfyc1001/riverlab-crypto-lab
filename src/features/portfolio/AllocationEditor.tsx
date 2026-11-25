import type { DatasetSummary } from '../../core/data/dataset';
import type { RuleRecord } from '../../core/rule-library';
import type { AllocationDraft } from './allocation';
export function AllocationEditor({
  row,
  index,
  datasets,
  rules,
  update,
  remove,
}: {
  row: AllocationDraft;
  index: number;
  datasets: DatasetSummary[];
  rules: RuleRecord[];
  update: (patch: Partial<AllocationDraft>) => void;
  remove?: () => void;
}) {
  const selected = datasets.find((dataset) => dataset.id === row.datasetId);
  const fields = (
    entries: readonly (readonly [keyof AllocationDraft, string])[],
  ) =>
    entries.map(([key, label]) => (
      <label key={key}>
        {label}
        <input
          inputMode="decimal"
          value={row[key]}
          onChange={(event) => update({ [key]: event.target.value })}
        />
      </label>
    ));
  return (
    <fieldset className="portfolio-account">
      <legend>子账户 {index + 1}</legend>
      <div className="portfolio-grid">
        <label>
          历史数据集
          <select
            aria-label="历史数据集"
            value={row.datasetId}
            onChange={(e) => update({ datasetId: e.target.value })}
          >
            <option value="">选择数据集</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.symbol} · {d.name}
              </option>
            ))}
          </select>
        </label>
        {fields([['weightPercent', '初始分配比例 %']])}
        <label>
          策略类型
          <select
            aria-label="策略类型"
            value={row.kind}
            onChange={(e) =>
              update({ kind: e.target.value as AllocationDraft['kind'] })
            }
          >
            <option value="ma">MA 交叉</option>
            <option value="rsi">RSI 阈值</option>
            <option value="breakout">价格突破</option>
            <option value="rules">已保存的自定义规则版本</option>
          </select>
        </label>
        {row.kind === 'rules' ? (
          <label>
            规则版本
            <select
              aria-label="规则版本"
              value={row.ruleId}
              onChange={(e) => update({ ruleId: e.target.value })}
            >
              <option value="">选择已保存版本</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · v{r.rule.revision} · {r.familyId}
                </option>
              ))}
            </select>
          </label>
        ) : (
          fields(
            row.kind === 'ma'
              ? [
                  ['fastPeriod', 'MA 快线周期'],
                  ['slowPeriod', 'MA 慢线周期'],
                ]
              : row.kind === 'rsi'
                ? [
                    ['period', 'RSI 周期'],
                    ['lower', 'RSI 下阈值'],
                    ['upper', 'RSI 上阈值'],
                  ]
                : [['lookback', '突破回看周期']],
          )
        )}
      </div>
      {selected && (
        <details>
          <summary>行情来源与质量</summary>
          <p>
            {selected.source.label} · {selected.name} ·{' '}
            {selected.quality.validRows} 根 · 缺口 {selected.quality.gapCount} ·
            质量警告 {selected.quality.warningCount} 项
          </p>
          <p>{selected.source.note}</p>
          <p>
            源文件 SHA-256 <code>{selected.file.sha256}</code>
          </p>
          {Object.entries(selected.quality.issueCounts).map(([code, count]) => <p key={code}>{code} · {count} 项</p>)}
        </details>
      )}
      {row.kind === 'rules' && !rules.length && (
        <p>
          <a className="text-link" href="#/strategies">
            前往策略中心保存规则版本
          </a>
        </p>
      )}
      <details>
        <summary>手续费、滑点与保护规则</summary>
        <div className="portfolio-grid">
          {fields([
            ['feeBps', '双边手续费 bps'],
            ['buySlippageBps', '买入滑点 bps'],
            ['sellSlippageBps', '卖出滑点 bps'],
            ['quantityDecimals', '数量小数位'],
            ['minNotional', '最小成交额（报价币）'],
            ['stopLossBps', '止损 bps（留空关闭）'],
            ['takeProfitBps', '止盈 bps（留空关闭）'],
          ])}
        </div>
      </details>
      {remove && (
        <button type="button" onClick={remove}>
          移除子账户 {index + 1}
        </button>
      )}
    </fieldset>
  );
}
