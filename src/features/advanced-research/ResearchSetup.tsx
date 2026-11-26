import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ADVANCED_LIMITS,
  parameterTargets,
} from '../../core/advanced-research';
import type {
  AdvancedInput,
  ParameterTarget,
  SortMetric,
} from '../../core/advanced-research/types';
import { DEFAULT_CONFIG } from '../../core/backtests/config';
import { DEFAULT_REGIME_PARAMS } from '../../core/market-regime/model';
import type { RuleRecord } from '../../core/rule-library';
import type { DatasetSummary } from '../../core/data/dataset';
import type { useAdvancedWorkbench } from './useAdvancedWorkbench';
import { axisLabel, metricNames } from './presentation';

type Props = {
  datasets: DatasetSummary[];
  rules: RuleRecord[];
  work: ReturnType<typeof useAdvancedWorkbench>;
};

function NumberField({
  name,
  label,
  value,
  optional = false,
  step = 'any',
}: {
  name: string;
  label: string;
  value?: string | number;
  optional?: boolean;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        step={step}
        defaultValue={value}
        required={!optional}
      />
    </label>
  );
}

function AxisFields({
  target,
  index,
  rule,
}: {
  target: ParameterTarget & { value: number };
  index: number;
  rule: RuleRecord;
}) {
  const [enabled, setEnabled] = useState(index === 0);
  return (
    <fieldset className="advanced-axis">
      <legend>
        <label className="advanced-inline">
          <input
            type="checkbox"
            name={`axis${index}`}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {axisLabel(target, rule)}
        </label>
      </legend>
      {enabled ? (
        <div className="advanced-grid">
          <NumberField
            name={`min${index}`}
            label="最小值"
            value={target.value}
          />
          <NumberField
            name={`max${index}`}
            label="最大值"
            value={target.value}
          />
          <NumberField name={`step${index}`} label="步长" value={1} />
        </div>
      ) : (
        <p>固定值 {target.value}</p>
      )}
    </fieldset>
  );
}

export function ResearchSetup({ datasets, rules, work: w }: Props) {
  const [datasetId, setDatasetId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [search, setSearch] = useState('grid');
  const [evaluation, setEvaluation] = useState('split');
  const [error, setError] = useState('');
  const selected = datasets.find((row) => row.id === datasetId);
  const rule = rules.find((row) => row.id === ruleId);
  const targets = rule ? parameterTargets(rule.rule) : [];
  const plan = w.pending?.plan;
  function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || !rule) return;
    const form = new FormData(e.currentTarget);
    const str = (name: string) => String(form.get(name) ?? '').trim();
    const num = (name: string) => (str(name) ? Number(str(name)) : NaN);
    const axes = targets.flatMap(({ side, condition, field }, i) =>
      form.has(`axis${i}`)
        ? [
            {
              side,
              condition,
              field,
              min: num(`min${i}`),
              max: num(`max${i}`),
              step: num(`step${i}`),
            },
          ]
        : [],
    );
    const sort = ['rank1', 'rank2', 'rank3', 'rank4']
      .map(str)
      .filter(Boolean) as SortMetric[];
    if (new Set(sort).size !== sort.length) {
      setError('排序指标不能重复。');
      return;
    }
    const spec: Omit<AdvancedInput, 'dataset' | 'completedThroughUtcMs'> = {
      ruleRecord: rule,
      axes,
      sort,
      search:
        search === 'random'
          ? { kind: 'random', seed: num('seed'), count: num('count') }
          : { kind: 'grid' },
      filters: {
        minReturn: str('minReturn') || null,
        maxDrawdown: str('maxDrawdown') || null,
        minProfitFactor: str('minProfitFactor') || null,
        minTrades: num('minTrades'),
      },
      evaluation:
        evaluation === 'split'
          ? { kind: 'split', trainBars: num('train') }
          : { kind: 'rolling', trainBars: num('train'), testBars: num('test') },
      config: {
        initialCash: str('initialCash'),
        feeBps: num('feeBps'),
        buySlippageBps: num('buySlippageBps'),
        sellSlippageBps: num('sellSlippageBps'),
        quantityDecimals: num('quantityDecimals'),
        minNotional: str('minNotional'),
      },
      risk: {
        ...(str('stopLossBps') ? { stopLossBps: num('stopLossBps') } : {}),
        ...(str('takeProfitBps')
          ? { takeProfitBps: num('takeProfitBps') }
          : {}),
      },
      regime: {
        lookback: num('regimeLookback'),
        thresholdBps: num('regimeThreshold'),
      },
    };
    w.preview(selected, spec, str('name'), num('concurrency'));
  }
  return (
    <section className="panel">
      <h2>配置参数搜索</h2>
      <form
        onSubmit={preview}
        onChange={() => {
          w.invalidate();
          setError('');
        }}
      >
        <fieldset disabled={w.busy} className="advanced-config">
          <div className="advanced-grid">
            <label>
              研究数据集
              <select
                required
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                <option value="">选择已保存的数据集</option>
                {datasets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.symbol} · {s.quality.validRows} 根
                  </option>
                ))}
              </select>
            </label>
            <label>
              研究规则版本
              <select
                required
                value={ruleId}
                onChange={(e) => setRuleId(e.target.value)}
              >
                <option value="">选择已保存的规则版本</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · v{r.rule.revision} · {r.ruleHash.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!selected && (
            <a className="text-link" href="#/datasets">
              前往数据中心
            </a>
          )}
          {!rule && (
            <a className="text-link" href="#/strategies">
              前往规则编辑器
            </a>
          )}
          {selected && (
            <div key={selected.id}>
              <p>
                {selected.source.label} · {selected.symbol} · 周期{' '}
                {selected.quality.intervalMs! / 1000} 秒 · 质量警告{' '}
                {selected.quality.warningCount} 项
              </p>
              <label className="advanced-inline">
                <input type="checkbox" required />
                我确认所选数据集的 K 线均已收盘，已核对数据来源及质量警告。
              </label>
            </div>
          )}
          {rule && (
            <div key={rule.recordHash}>
              <h3>规则参数范围</h3>
              <p>勾选需要搜索的参数。最多 {ADVANCED_LIMITS.axes} 个参数轴。</p>
              {targets.map((target, i) => (
                <AxisFields key={i} rule={rule} target={target} index={i} />
              ))}
            </div>
          )}
          <div className="advanced-grid">
            <label>
              搜索方式
              <select
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              >
                <option value="grid">有界网格</option>
                <option value="random">固定种子随机抽样</option>
              </select>
            </label>
            {search === 'random' && (
              <>
                <NumberField name="seed" label="随机种子" value={42} step="1" />
                <NumberField
                  name="count"
                  label="抽样候选数"
                  value={3}
                  step="1"
                />
              </>
            )}
            <NumberField
              name="concurrency"
              label="并发上限（1–4）"
              value={2}
              step="1"
            />
            <label>
              报告名称
              <input
                name="name"
                defaultValue="规则参数研究"
                required
                maxLength={160}
                pattern=".*\S.*"
              />
            </label>
          </div>
          <h3>时间窗口</h3>
          <div className="advanced-grid">
            <label>
              优化模式
              <select
                value={evaluation}
                onChange={(e) => setEvaluation(e.target.value)}
              >
                <option value="split">一次训练 / 测试</option>
                <option value="rolling">滚动训练 / 测试</option>
              </select>
            </label>
            <NumberField
              name="train"
              label="训练长度（根）"
              value={12}
              step="1"
            />
            {evaluation === 'rolling' && (
              <NumberField
                name="test"
                label="测试长度（根）"
                value={6}
                step="1"
              />
            )}
          </div>
          <p>
            按时间先训练，锁定参数后在后续窗口验证。每个窗口从独立本金、空仓和指标冷启动开始。
          </p>
          <h3>训练筛选与排序</h3>
          <p>收益和回撤填十进制比例，例如 0.05 表示 5%。空白表示不设该门槛。</p>
          <div className="advanced-grid">
            <NumberField name="minReturn" label="最低收益率" optional />
            <NumberField name="maxDrawdown" label="最大允许回撤" optional />
            <NumberField name="minProfitFactor" label="最低利润因子" optional />
            <NumberField
              name="minTrades"
              label="最少完成交易次数"
              value={0}
              step="1"
            />
            {Array.from({ length: 4 }, (_, i) => (
              <label key={i}>
                排序优先级 {i + 1}
                <select
                  name={`rank${i + 1}`}
                  defaultValue={i === 0 ? 'totalReturn' : ''}
                >
                  {i > 0 && <option value="">跳过</option>}
                  {Object.entries(metricNames).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}（{key === 'maxDrawdown' ? '升序' : '降序'}）
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p>按优先级逐项比较，同分取候选编号较小者。</p>
          <details>
            <summary>本金、成交成本、保护与市场状态</summary>
            <div className="advanced-grid">
              <label>
                独立本金
                <input
                  name="initialCash"
                  required
                  defaultValue={DEFAULT_CONFIG.initialCash}
                />
              </label>
              <label>
                最小成交额
                <input
                  name="minNotional"
                  required
                  defaultValue={DEFAULT_CONFIG.minNotional}
                />
              </label>
              <NumberField
                name="feeBps"
                label="手续费（基点）"
                value={DEFAULT_CONFIG.feeBps}
                step="1"
              />
              <NumberField
                name="buySlippageBps"
                label="买入滑点（基点）"
                value={DEFAULT_CONFIG.buySlippageBps}
                step="1"
              />
              <NumberField
                name="sellSlippageBps"
                label="卖出滑点（基点）"
                value={DEFAULT_CONFIG.sellSlippageBps}
                step="1"
              />
              <NumberField
                name="quantityDecimals"
                label="数量小数位"
                value={DEFAULT_CONFIG.quantityDecimals}
                step="1"
              />
              <NumberField
                name="stopLossBps"
                label="止损（基点，可留空）"
                step="1"
                optional
              />
              <NumberField
                name="takeProfitBps"
                label="止盈（基点，可留空）"
                step="1"
                optional
              />
              <NumberField
                name="regimeLookback"
                label="状态观察周期（根）"
                value={DEFAULT_REGIME_PARAMS.lookback}
                step="1"
              />
              <NumberField
                name="regimeThreshold"
                label="趋势阈值（基点）"
                value={DEFAULT_REGIME_PARAMS.thresholdBps}
                step="1"
              />
            </div>
          </details>
          <button type="submit" disabled={!selected || !rule}>
            预估候选与计算量
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {plan && w.pending && (
        <aside aria-label="运行资源预算" className="advanced-estimate">
          <h3>运行资源预算</h3>
          <p>
            参数组合 {plan.combinations}，候选 {plan.candidates.length} /{' '}
            {ADVANCED_LIMITS.candidates}，结构拒绝 {plan.invalid.length}
            。预计最多 {plan.runs} / {ADVANCED_LIMITS.runs} 次回测、{plan.bars}{' '}
            / {ADVANCED_LIMITS.bars} 根求值。实际并发上限 {w.pending.workers}。
          </p>
          <p>
            训练 / 测试共 {plan.windows.length / 2} 组，尾部未纳入{' '}
            {plan.trailingBars} 根。
          </p>
          <button
            type="button"
            className="advanced-primary"
            disabled={w.busy}
            onClick={w.run}
          >
            开始高级研究
          </button>
        </aside>
      )}
    </section>
  );
}
