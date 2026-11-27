import { isDesktopRepository } from '../../infrastructure/desktop-repository';
import { useEffect, useRef, useState } from 'react';
import {
  defaultRule,
  normalizeRule,
  explainCondition,
} from '../../core/strategies';
import type {
  RuleCondition,
  RuleGroup,
  StrategyRuleV1,
} from '../../core/strategies';
import {
  sealRule,
  parseRuleJson,
  RULE_JSON_LIMIT,
} from '../../core/rule-library';
import type { RuleRecord } from '../../core/rule-library';
import './rules.css';

const defaults: Record<RuleCondition['kind'], RuleCondition> = {
  cross: {
    kind: 'cross',
    enabled: true,
    average: 'MA',
    fastPeriod: 2,
    slowPeriod: 5,
    direction: 'above',
  },
  'price-ma': {
    kind: 'price-ma',
    enabled: true,
    average: 'MA',
    period: 5,
    operator: 'gt',
  },
  rsi: {
    kind: 'rsi',
    enabled: true,
    period: 14,
    operator: 'lte',
    threshold: 30,
  },
  breakout: {
    kind: 'breakout',
    enabled: true,
    lookback: 20,
    direction: 'above',
  },
};
export function RuleEditor({
  records,
  busy,
  onSave,
  onDelete,
}: {
  records: RuleRecord[];
  busy: boolean;
  onSave: (record: RuleRecord) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [rule, setRule] = useState(defaultRule),
    [name, setName] = useState('我的组合规则');
  const [familyId, setFamilyId] = useState<string>(() => crypto.randomUUID());
  const [record, setRecord] = useState<RuleRecord | null>(null),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const importGeneration = useRef({ value: 0 });
  useEffect(() => {
    const lifetime = importGeneration.current;
    return () => {
      lifetime.value++;
    };
  }, []);
  let validation = '';
  try {
    normalizeRule(rule);
    if (!name.trim() || name.length > 160)
      throw new Error('名称需要1–160字符。');
  } catch (e) {
    validation = e instanceof Error ? e.message : '规则无效';
  }
  function edit(next: StrategyRuleV1) {
    importGeneration.current.value++;
    setRule({
      ...next,
      revision: record ? record.rule.revision + 1 : next.revision,
    });
    setRecord(null);
    setSaved(false);
    setError('');
    setMessage('');
  }
  function load(r: RuleRecord, isSaved: boolean) {
    importGeneration.current.value++;
    setRule(structuredClone(r.rule));
    setName(r.name);
    setFamilyId(r.familyId);
    setRecord(r);
    setSaved(isSaved);
    setError('');
    setMessage(
      isSaved
        ? '已打开不可变策略版本；再次编辑将生成新版本。'
        : 'JSON已校验，仅在内存待保存。',
    );
  }
  function fresh(copy: boolean) {
    importGeneration.current.value++;
    setRule(copy ? { ...structuredClone(rule), revision: 1 } : defaultRule());
    setName(copy ? name.slice(0, 150) + ' 副本' : '我的组合规则');
    setFamilyId(crypto.randomUUID());
    setRecord(null);
    setSaved(false);
    setError('');
    setMessage('新策略草稿，仅在内存。');
  }
  function current() {
    importGeneration.current.value++;
    return (
      record ??
      sealRule(rule, { familyId, name: name.trim(), createdUtcMs: Date.now() })
    );
  }
  async function save() {
    try {
      const next = current();
      if (await onSave(next)) {
        setRecord(next);
        setSaved(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  }
  function exportJson() {
    try {
      const next = current(),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(next, null, 2)], {
            type: 'application/json',
          }),
        );
      const link = document.createElement('a');
      link.href = url;
      link.download = `riverlab-rule-${next.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('策略JSON已生成，请确认浏览器保存了文件。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    }
  }
  return (
    <section
      className="panel rule-editor"
      aria-label="可视化规则策略编辑器"
      data-testid="rule-editor"
    >
      <h2>可视化规则策略 · V1</h2>
      <p>
        单币种现货多头历史模拟。买卖各最多5条件；不执行用户代码。草稿离开此页或刷新会重置，保存版本可重开；请另行导出JSON备份。
      </p>
      <div className="sample-actions">
        <button disabled={busy} onClick={() => fresh(false)}>
          新建规则策略
        </button>
        <button disabled={busy || !!validation} onClick={() => fresh(true)}>
          复制为新策略
        </button>
      </div>
      <label>
        策略名称
        <input
          disabled={busy}
          maxLength={160}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            edit(rule);
          }}
        />
      </label>
      <p data-testid="rule-version">
        版本 v{rule.revision} ·{' '}
        {saved
          ? isDesktopRepository()
            ? '桌面已保存'
            : '浏览器已保存'
          : '内存待保存'}{' '}
        · {familyId}
      </p>
      <fieldset disabled={busy} className="rule-sides">
        <legend>买卖条件</legend>
        {(['buy', 'sell'] as const).map((side) => (
          <GroupEditor
            key={side}
            side={side}
            group={rule[side]}
            onChange={(g) => edit({ ...rule, [side]: g })}
          />
        ))}
      </fieldset>
      <p>
        全部启用条件预热后判定；OR也不会绕过未知项。两侧同时满足则保持不动并记录冲突。持续满足只触发一次，须先不满足再触发；保护退出或拒单后不自动重试。持仓买入/空仓卖出仍由原账本拒绝；下一根开盘成交，末根不成交。
      </p>
      <p>
        MA精确整数比较；EMA使用前N根SMA初始化与α=2/(N+1)，RSI使用Wilder。EMA/RSI为浮点指标，极近阈值受舍入影响；资金账本仍为18位BigInt。
      </p>
      {validation ? (
        <p role="alert">{validation}</p>
      ) : (
        <p role="status">规则校验通过，可以保存并在回测中心选择具体版本。</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="sample-actions">
        <button
          disabled={busy || saved || !!validation}
          onClick={() => void save()}
        >
          保存策略版本
        </button>
        <button disabled={busy || !!validation} onClick={exportJson}>
          导出策略 JSON
        </button>
      </div>
      <label>
        导入策略 JSON（128KiB以内）
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > RULE_JSON_LIMIT) {
              setError('策略JSON超过128KiB限制。');
              return;
            }
            const token = ++importGeneration.current.value;
            void file
              .text()
              .then((text) => {
                if (token === importGeneration.current.value)
                  load(parseRuleJson(text), false);
              })
              .catch((e) => {
                if (token === importGeneration.current.value)
                  setError(e instanceof Error ? e.message : '导入失败');
              });
          }}
        />
      </label>
      <h3>已保存策略版本（{records.length}/100）</h3>
      <p>
        同一家族修改生成新版本，历史版本不覆盖。删除指定版本前需要确认；实验保留内嵌规则。Phase3网格/样本外研究暂不支持规则策略，请在回测中心使用。
      </p>
      <ul aria-label="规则策略版本库" className="rule-library">
        {records.map((r) => (
          <li key={r.id}>
            <span>
              {r.name} · v{r.rule.revision} · <code>{r.ruleHash}</code>
            </span>
            <div className="sample-actions">
              <button
                disabled={busy}
                onClick={() => load(r, true)}
                aria-label={`打开策略 ${r.name} v${r.rule.revision}`}
              >
                打开版本
              </button>
              <button
                disabled={busy}
                onClick={() => setPendingDelete(r.id)}
                aria-label={`删除策略 ${r.name} v${r.rule.revision}`}
              >
                删除版本
              </button>
            </div>
            {pendingDelete === r.id && (
              <div role="group" aria-label="确认删除策略版本">
                <p>
                  确认删除 {r.name} v{r.rule.revision}？
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    void onDelete(r.id).then((ok) => {
                      if (ok) {
                        setPendingDelete(null);
                        if (record?.id === r.id) setSaved(false);
                      }
                    });
                  }}
                >
                  确认删除策略版本
                </button>
                <button disabled={busy} onClick={() => setPendingDelete(null)}>
                  取消删除
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
function GroupEditor({
  side,
  group,
  onChange,
}: {
  side: 'buy' | 'sell';
  group: RuleGroup;
  onChange: (group: RuleGroup) => void;
}) {
  const label = side === 'buy' ? '买入' : '卖出';
  return (
    <fieldset className="rule-group">
      <legend>{label}规则组</legend>
      <label>
        <input
          type="checkbox"
          checked={group.enabled}
          onChange={(e) => onChange({ ...group, enabled: e.target.checked })}
        />
        启用{label}规则组
      </label>
      <label>
        {label}组合方式
        <select
          value={group.operator}
          onChange={(e) =>
            onChange({
              ...group,
              operator: e.target.value as RuleGroup['operator'],
            })
          }
        >
          <option value="AND">AND · 全部满足</option>
          <option value="OR">OR · 任一满足（全部已预热）</option>
        </select>
      </label>
      {group.conditions.map((c, i) => (
        <fieldset
          key={i}
          className="rule-condition"
          aria-label={`${label}条件${i + 1}`}
        >
          <legend>
            {label}条件 {i + 1}
          </legend>
          <label>
            <input
              type="checkbox"
              checked={c.enabled}
              onChange={(e) =>
                onChange({
                  ...group,
                  conditions: group.conditions.map((v, j) =>
                    j === i ? { ...v, enabled: e.target.checked } : v,
                  ),
                })
              }
            />
            启用此条件
          </label>
          <ConditionFields
            condition={c}
            onChange={(next) =>
              onChange({
                ...group,
                conditions: group.conditions.map((v, j) =>
                  j === i ? next : v,
                ),
              })
            }
          />
          <p>{explainCondition(c)}</p>
          <div className="sample-actions">
            <button
              disabled={group.conditions.length >= 5}
              onClick={() =>
                onChange({
                  ...group,
                  conditions: [
                    ...group.conditions.slice(0, i + 1),
                    { ...c },
                    ...group.conditions.slice(i + 1),
                  ],
                })
              }
            >
              复制此条件
            </button>
            <button
              onClick={() =>
                onChange({
                  ...group,
                  conditions: group.conditions.filter((_, j) => j !== i),
                })
              }
            >
              删除此条件
            </button>
          </div>
        </fieldset>
      ))}
      <button
        disabled={group.conditions.length >= 5}
        onClick={() =>
          onChange({
            ...group,
            conditions: [...group.conditions, { ...defaults['price-ma'] }],
          })
        }
      >
        添加{label}条件（{group.conditions.length}/5）
      </button>
    </fieldset>
  );
}
function ConditionFields({
  condition: c,
  onChange,
}: {
  condition: RuleCondition;
  onChange: (condition: RuleCondition) => void;
}) {
  // Every update preserves the active discriminant; changing kind starts with explicit defaults.
  const update = (key: string, value: string | number) =>
    onChange({ ...c, [key]: value } as RuleCondition);
  const numeric = (key: string, label: string, value: number) => (
    <label key={key}>
      {label}
      <input
        type="number"
        step="any"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) =>
          update(
            key,
            e.target.value.trim() === '' ? NaN : Number(e.target.value),
          )
        }
      />
    </label>
  );
  return (
    <div className="rule-fields">
      <label>
        条件类型
        <select
          value={c.kind}
          onChange={(e) =>
            onChange({
              ...defaults[e.target.value as RuleCondition['kind']],
              enabled: c.enabled,
            })
          }
        >
          <option value="cross">均线交叉 MA / EMA</option>
          <option value="price-ma">价格与均线比较</option>
          <option value="rsi">RSI 阈值</option>
          <option value="breakout">前N根 high/low 突破</option>
        </select>
      </label>
      {(c.kind === 'cross' || c.kind === 'price-ma') && (
        <label>
          均线类型
          <select
            value={c.average}
            onChange={(e) => update('average', e.target.value)}
          >
            <option>MA</option>
            <option>EMA</option>
          </select>
        </label>
      )}
      {c.kind === 'cross' && (
        <>
          {numeric('fastPeriod', '快线周期', c.fastPeriod)}
          {numeric('slowPeriod', '慢线周期', c.slowPeriod)}
        </>
      )}
      {(c.kind === 'price-ma' || c.kind === 'rsi') &&
        numeric('period', '指标周期', c.period)}
      {c.kind === 'breakout' && numeric('lookback', '突破回看N', c.lookback)}
      {(c.kind === 'cross' || c.kind === 'breakout') && (
        <label>
          触发方向
          <select
            value={c.direction}
            onChange={(e) => update('direction', e.target.value)}
          >
            <option value="above">
              {c.kind === 'cross' ? '上穿' : '高于历史最高'}
            </option>
            <option value="below">
              {c.kind === 'cross' ? '下穿' : '低于历史最低'}
            </option>
          </select>
        </label>
      )}
      {(c.kind === 'price-ma' || c.kind === 'rsi') && (
        <label>
          比较符号
          <select
            value={c.operator}
            onChange={(e) => update('operator', e.target.value)}
          >
            <option value="gt">严格大于 &gt;</option>
            <option value="gte">大于等于 ≥</option>
            <option value="lt">严格小于 &lt;</option>
            <option value="lte">小于等于 ≤</option>
          </select>
        </label>
      )}
      {c.kind === 'rsi' && numeric('threshold', 'RSI阈值', c.threshold)}
    </div>
  );
}
