import { DISCLAIMER, runExperiment, verifyExperiment } from '../experiments';
import type {
  Experiment,
  ExperimentPayload,
  WorkbenchInput,
} from '../experiments';
import { canonicalJson, contentHash } from '../backtests/identity';
import { ALGORITHM_VERSION, CONVERSION_VERSION } from '../backtests';
import { STATISTICS_VERSION } from '../statistics';
import type { Metric } from '../statistics';
import { simulateEquity } from './simulation';
import type { RiskSettings, Simulation } from './simulation';

export const RISK_STUDY_VERSION = 'risk-study-net-equity-v1';
export interface SourceIdentity {
  id: string;
  name: string;
  createdUtcMs: number;
  elapsedMs: number;
  payloadHash: string;
}
export interface RiskSource {
  identity: SourceIdentity;
  input: WorkbenchInput;
  dataHash: string;
  runHash: string;
  engineVersion: string;
  conversionVersion: string;
  statisticsVersion: string;
}
export interface SourcePreview {
  id: string;
  name: string;
  symbol: string;
  source: string;
  periods: number;
  intervalMs: number;
  startUtcMs: number;
  endUtcMs: number;
  initialCash: string;
  fees: string;
  realizedPnl: string;
  unrealizedPnl: string;
  completedTrades: number;
  winRate: Metric;
  config: WorkbenchInput['config'];
  risk: WorkbenchInput['risk'];
  strategy: WorkbenchInput['strategy'];
  payloadHash: string;
  dataHash: string;
  runHash: string;
  fileHash: string;
  warnings: string[];
}
export interface RiskPayload {
  version: typeof RISK_STUDY_VERSION;
  source: RiskSource;
  preview: SourcePreview;
  simulation: Simulation;
  definitions: readonly string[];
  disclaimer: typeof DISCLAIMER;
}
export interface RiskStudy {
  format: 'riverlab-risk-study';
  schemaVersion: 1;
  id: string;
  name: string;
  createdUtcMs: number;
  elapsedMs: number;
  payloadHash: string;
  payload: RiskPayload;
}
export type RiskSummary = Pick<
  RiskStudy,
  'id' | 'name' | 'createdUtcMs' | 'payloadHash'
> & { sourceName: string; symbol: string };
const definitions = Object.freeze([
  '源因子=本根净权益/上根净权益，含初始本金锚点；资金按每步乘除后向下舍入至18位，归零吸收。',
  '分位nearest-rank=ceil(分位百分比×路径数/100)-1；回撤分位和终值分位独立排序，不代表同一条路径。',
  '回撤按含初始本金的历史权益峰值计算，金额和分数用BigInt，不代表K线根内风险。',
  '最终亏损频率=末权益<本金的路径数/总路径数；阈值频率=任一模拟步权益<=floor(初始本金×阈值%)/总路径数。',
  '阈值相对于初始本金，不是从峰值回撤；归零含18位舍入；0次只是本批次未观测。',
  '直方图左闭右开、最后一组含最大值；退化单值分布只有一个等端点组；显示点抽样不改变全步统计。',
]);
export function sourcePreview(e: Experiment): SourcePreview {
  const p = e.payload,
    m = p.result.manifest,
    s = p.statistics;
  return {
    id: e.id,
    name: e.name,
    symbol: m.symbol,
    source: p.dataset.source.label,
    periods: m.signals.length,
    intervalMs: m.intervalMs,
    startUtcMs: p.dataset.candles[0].timestampUtcMs,
    endUtcMs: p.dataset.candles.at(-1)!.timestampUtcMs + m.intervalMs,
    initialCash: m.config.initialCash,
    fees: s.fees,
    realizedPnl: s.realizedPnl,
    unrealizedPnl: s.unrealizedPnl,
    completedTrades: s.completedTrades.length,
    winRate: s.winRate,
    config: m.config,
    risk: m.risk,
    strategy: m.strategy!.config,
    payloadHash: e.payloadHash,
    dataHash: m.dataHash,
    runHash: m.runHash,
    fileHash: m.sourceFileSha256,
    warnings: p.dataset.quality.issues.map((q) => q.code + '：' + q.message),
  };
}
function analyze(
  payload: ExperimentPayload,
  identity: SourceIdentity,
  settings: RiskSettings,
  progress?: (done: number, total: number) => void,
): RiskPayload {
  const m = payload.result.manifest;
  if (!m.strategy) throw new Error('仅支持正式三策略保存实验。');
  const source: RiskSource = {
    identity: { ...identity },
    input: JSON.parse(
      JSON.stringify({
        dataset: payload.dataset,
        config: m.config,
        risk: m.risk,
        strategy: m.strategy.config,
        completedThroughUtcMs: m.completedThroughUtcMs,
      }),
    ),
    dataHash: m.dataHash,
    runHash: m.runHash,
    engineVersion: m.algorithmVersion,
    conversionVersion: m.conversionVersion,
    statisticsVersion: payload.statistics.version,
  };
  const e: Experiment = { schemaVersion: 1, ...identity, payload };
  return {
    version: RISK_STUDY_VERSION,
    source,
    preview: JSON.parse(JSON.stringify(sourcePreview(e))),
    simulation: simulateEquity(
      payload.statistics.curve.map((p) => p.equity),
      settings,
      progress,
    ),
    definitions,
    disclaimer: DISCLAIMER,
  };
}
export function analyzeExperiment(
  value: unknown,
  settings: RiskSettings,
  progress?: (done: number, total: number) => void,
): RiskPayload {
  const e = verifyExperiment(value);
  return analyze(
    e.payload,
    {
      id: e.id,
      name: e.name,
      createdUtcMs: e.createdUtcMs,
      elapsedMs: e.elapsedMs,
      payloadHash: e.payloadHash,
    },
    settings,
    progress,
  );
}
export function sealRiskStudy(
  payload: RiskPayload,
  meta: Pick<RiskStudy, 'id' | 'name' | 'createdUtcMs' | 'elapsedMs'>,
): RiskStudy {
  const record: RiskStudy = {
    format: 'riverlab-risk-study',
    schemaVersion: 1,
    ...meta,
    payloadHash: contentHash(payload),
    payload,
  };
  assertRiskStudy(record);
  return record;
}
const text = (v: unknown, max: number) =>
  typeof v === 'string' && !!v.trim() && v.length <= max;
export function assertRiskStudy(value: unknown): asserts value is RiskStudy {
  const e = value as RiskStudy;
  if (
    !e ||
    e.format !== 'riverlab-risk-study' ||
    e.schemaVersion !== 1 ||
    !text(e.id, 100) ||
    !text(e.name, 160) ||
    !Number.isSafeInteger(e.createdUtcMs) ||
    e.createdUtcMs < 0 ||
    e.createdUtcMs > 4_102_444_800_000 ||
    !Number.isFinite(e.elapsedMs) ||
    e.elapsedMs < 0 ||
    !e.payload ||
    e.payload.version !== RISK_STUDY_VERSION ||
    e.payload.disclaimer !== DISCLAIMER ||
    contentHash(e.payload) !== e.payloadHash
  )
    throw new Error('风险报告格式、版本或校验无效；未修复。');
}
export function verifyRiskStudy(
  value: unknown,
  progress?: (done: number, total: number) => void,
): RiskStudy {
  assertRiskStudy(value);
  const s = value.payload.source,
    i = s.identity;
  if (
    s.engineVersion !== ALGORITHM_VERSION ||
    s.conversionVersion !== CONVERSION_VERSION ||
    s.statisticsVersion !== STATISTICS_VERSION ||
    !i ||
    !text(i.id, 100) ||
    !text(i.name, 160) ||
    !Number.isSafeInteger(i.createdUtcMs) ||
    i.createdUtcMs < 0 ||
    i.createdUtcMs > 4_102_444_800_000 ||
    !Number.isFinite(i.elapsedMs) ||
    i.elapsedMs < 0
  )
    throw new Error('源实验身份或算法版本不支持。');
  const payload = runExperiment(s.input);
  if (contentHash(payload) !== i.payloadHash)
    throw new Error('源实验快照不能按原hash复现。');
  const actual = analyze(
    payload,
    i,
    value.payload.simulation.settings,
    progress,
  );
  if (canonicalJson(actual) !== canonicalJson(value.payload))
    throw new Error('风险报告重算不一致；未自动修复。');
  return value;
}
export function summarizeRisk(e: RiskStudy): RiskSummary {
  return {
    id: e.id,
    name: e.name,
    createdUtcMs: e.createdUtcMs,
    payloadHash: e.payloadHash,
    sourceName: e.payload.preview.name,
    symbol: e.payload.preview.symbol,
  };
}
export function riskCsv(e: RiskStudy): string {
  const p = e.payload,
    s = p.simulation;
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows: unknown[][] = [
    [DISCLAIMER],
    ['payloadHash', e.payloadHash],
    ['sourcePayloadHash', p.source.identity.payloadHash],
    ['sourceDataHash', p.source.dataHash],
    ['sourceRunHash', p.source.runHash],
    ['settings', canonicalJson(s.settings)],
    ['algorithm', s.version, s.rngVersion],
    [
      'path',
      'finalEquityUSDT',
      'netPnlUSDT',
      'totalReturnFraction',
      'maxDrawdownFraction',
      'thresholdHit',
      'zero',
    ],
    ...s.paths.map((r) => [
      r.path,
      r.finalEquity,
      r.netPnl,
      r.totalReturn,
      r.maxDrawdown,
      r.thresholdHit,
      r.zero,
    ]),
  ];
  return (
    '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
