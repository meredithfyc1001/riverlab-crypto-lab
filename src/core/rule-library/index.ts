import { normalizeRule } from '../strategies';
import type { StrategyRuleV1 } from '../strategies';
import { contentHash } from '../backtests/identity';

export interface RuleRecord {
  format: 'riverlab-strategy-rule';
  schemaVersion: 1;
  id: string;
  familyId: string;
  name: string;
  createdUtcMs: number;
  rule: StrategyRuleV1;
  ruleHash: string;
  recordHash: string;
}
export const RULE_JSON_LIMIT = 128 * 1024;
export function sealRule(
  rule: unknown,
  metadata: Pick<RuleRecord, 'familyId' | 'name' | 'createdUtcMs'>,
): RuleRecord {
  const normalized = normalizeRule(rule);
  const body = {
    format: 'riverlab-strategy-rule' as const,
    schemaVersion: 1 as const,
    id: `${metadata.familyId}@${normalized.revision}`,
    familyId: metadata.familyId,
    name: metadata.name,
    createdUtcMs: metadata.createdUtcMs,
    rule: normalized,
    ruleHash: contentHash(normalized),
  };
  const record = { ...body, recordHash: contentHash(body) };
  return verifyRuleRecord(record);
}
export function verifyRuleRecord(value: unknown): RuleRecord {
  const r = value as RuleRecord;
  const keys = [
    'format',
    'schemaVersion',
    'id',
    'familyId',
    'name',
    'createdUtcMs',
    'rule',
    'ruleHash',
    'recordHash',
  ];
  if (
    !r ||
    Object.getPrototypeOf(r) !== Object.prototype ||
    Object.keys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    r.format !== 'riverlab-strategy-rule' ||
    r.schemaVersion !== 1 ||
    typeof r.familyId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(r.familyId) ||
    typeof r.name !== 'string' ||
    !r.name.trim() ||
    r.name.length > 160 ||
    !Number.isSafeInteger(r.createdUtcMs) ||
    r.createdUtcMs < 0 ||
    r.createdUtcMs > 4_102_444_800_000
  )
    throw new Error('策略版本格式/字段/身份无效，未迁移或修复。');
  const rule = normalizeRule(r.rule);
  const { recordHash, ...body } = r;
  if (
    r.id !== `${r.familyId}@${rule.revision}` ||
    r.ruleHash !== contentHash(rule) ||
    recordHash !== contentHash(body)
  )
    throw new Error('策略版本校验和不符，未修复。');
  return { ...r, rule };
}
export function parseRuleJson(text: string): RuleRecord {
  if (typeof text !== 'string' || text.length > RULE_JSON_LIMIT)
    throw new Error('策略JSON超过128KiB限制。');
  try {
    return verifyRuleRecord(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `无法导入策略JSON：${error instanceof Error ? error.message : '无效JSON'}`,
      { cause: error },
    );
  }
}
