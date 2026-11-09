import {
  createBacktestSession,
  normalizeConfig,
  ALGORITHM_VERSION,
  CONVERSION_VERSION,
  RUN_ASSUMPTIONS,
} from '../backtests';
import type {
  BacktestConfig,
  Signal,
  OrderIntent,
  OrderOutcome,
  SimulatedFill,
  AccountSnapshot,
} from '../backtests';
import { contentHash, canonicalJson } from '../backtests/identity';
import { assertDataset, summarizeDataset } from '../data/dataset';
import type { Dataset, DatasetSummary } from '../data/dataset';
import type { Candle } from '../data';
import { normalizeRisk } from '../risk';
import type { RiskConfig } from '../risk';
import { parseDecimal } from '../math';
import { calculateStatistics, METRIC_DEFINITIONS } from '../statistics';
import type { Statistics } from '../statistics';
import { DISCLAIMER } from '../experiments';

export const REPLAY_VERSION = 'interactive-prefix-replay-v1';
export const REPLAY_LIMITS = Object.freeze({
  decisions: 1000,
  notes: 1000,
  noteLength: 2000,
});
export interface ReplayNote {
  cursor: number;
  text: string;
}
export interface ReplayPayload {
  version: typeof REPLAY_VERSION;
  engineVersion: typeof ALGORITHM_VERSION;
  conversionVersion: typeof CONVERSION_VERSION;
  datasetId: string;
  sourceHash: string;
  sourceFileSha256: string;
  symbol: string;
  config: BacktestConfig;
  risk: RiskConfig;
  cursor: number;
  decisions: Signal[];
  notes: ReplayNote[];
  resultHash: string;
  stateHash: string;
}
export interface ReplayCheckpoint {
  format: 'riverlab-replay';
  schemaVersion: 1;
  id: string;
  name: string;
  createdUtcMs: number;
  payloadHash: string;
  payload: ReplayPayload;
  disclaimer: typeof DISCLAIMER;
}
export type ReplaySummary = Pick<
  ReplayCheckpoint,
  'id' | 'name' | 'createdUtcMs' | 'payloadHash'
> & { symbol: string; cursor: number };
export type ReplayStatistics = Omit<Statistics, 'curve' | 'completedTrades'> & {
  completedTradeCount: number;
};
export interface ReplayView {
  source: DatasetSummary;
  version: typeof REPLAY_VERSION;
  engineVersion: typeof ALGORITHM_VERSION;
  config: BacktestConfig;
  risk: RiskConfig;
  cursor: number;
  total: number;
  fromCursor: number;
  candles: Candle[];
  curve: Statistics['curve'];
  account: AccountSnapshot;
  pending: OrderIntent | null;
  orders: OrderOutcome[];
  fills: SimulatedFill[];
  orderCount: number;
  fillCount: number;
  statistics: ReplayStatistics;
  notes: ReplayNote[];
  stateHash: string;
  definitions: readonly string[];
  assumptions: readonly string[];
}
function integer(n: number, min: number, max: number) {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error('回放游标/计数必须为范围内整数。');
}
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function summarizeReplay(r: ReplayCheckpoint): ReplaySummary {
  return {
    id: r.id,
    name: r.name,
    createdUtcMs: r.createdUtcMs,
    payloadHash: r.payloadHash,
    symbol: r.payload.symbol,
    cursor: r.payload.cursor,
  };
}
export function assertReplayCheckpoint(
  value: unknown,
): asserts value is ReplayCheckpoint {
  const r = value as ReplayCheckpoint;
  if (
    !r ||
    r.format !== 'riverlab-replay' ||
    r.schemaVersion !== 1 ||
    !text(r.id, 100) ||
    !text(r.name, 160) ||
    !Number.isSafeInteger(r.createdUtcMs) ||
    r.createdUtcMs < 0 ||
    r.createdUtcMs > 4_102_444_800_000 ||
    r.disclaimer !== DISCLAIMER ||
    !r.payload ||
    contentHash(r.payload) !== r.payloadHash
  )
    throw new Error('回放记录损坏或校验不符，未修复。');
  const p = r.payload;
  if (
    p.version !== REPLAY_VERSION ||
    p.engineVersion !== ALGORITHM_VERSION ||
    p.conversionVersion !== CONVERSION_VERSION ||
    !text(p.datasetId, 100) ||
    !text(p.symbol, 80) ||
    !hash(p.sourceHash) ||
    !hash(p.sourceFileSha256) ||
    !hash(p.resultHash) ||
    !hash(p.stateHash) ||
    !Array.isArray(p.decisions) ||
    p.decisions.length > REPLAY_LIMITS.decisions ||
    !Array.isArray(p.notes) ||
    p.notes.length > REPLAY_LIMITS.notes
  )
    throw new Error('回放身份、版本或动作记录无效。');
  integer(p.cursor, 1, 50000);
  normalizeConfig(p.config);
  normalizeRisk(p.risk);
  let previous = -1;
  for (const s of p.decisions) {
    if (
      !s ||
      !Number.isInteger(s.candleIndex) ||
      s.candleIndex <= previous ||
      s.candleIndex >= p.cursor ||
      (s.action !== 'buy' && s.action !== 'sell') ||
      s.reason !== 'manual-' + s.action ||
      Object.keys(s).some(
        (k) => !['candleIndex', 'action', 'quantity', 'reason'].includes(k),
      )
    )
      throw new Error('回放手工决策顺序/字段无效。');
    if (s.quantity !== 'all') parseDecimal(s.quantity);
    previous = s.candleIndex;
  }
  previous = 0;
  for (const n of p.notes) {
    if (
      !n ||
      !text(n.text, REPLAY_LIMITS.noteLength) ||
      !Number.isInteger(n.cursor) ||
      n.cursor < Math.max(1, previous) ||
      n.cursor > p.cursor ||
      Object.keys(n).some((k) => !['cursor', 'text'].includes(k))
    )
      throw new Error('回放日记无效。');
    previous = n.cursor;
  }
}
/** The full dataset and execution state must stay inside the replay Worker. */
export class ReplaySession {
  private readonly execution;
  private readonly sourceHash: string;
  private readonly decisions: Signal[] = [];
  private readonly notes: ReplayNote[] = [];
  private readonly config: BacktestConfig;
  private readonly risk: RiskConfig;
  constructor(
    private readonly dataset: Dataset,
    config?: Partial<BacktestConfig>,
    risk?: RiskConfig,
  ) {
    assertDataset(dataset);
    const { candles, ...metadata } = dataset;
    this.dataset = {
      ...JSON.parse(JSON.stringify(metadata)),
      candles: candles.map((c) => ({ ...c })),
    };
    dataset = this.dataset;
    this.config = normalizeConfig(config);
    this.risk = normalizeRisk(risk);
    if (parseDecimal(this.config.initialCash) === 0n)
      throw new Error('初始本金必须大于0。');
    this.sourceHash = contentHash(dataset);
    this.execution = createBacktestSession(
      {
        dataset,
        config: this.config,
        risk: this.risk,
        signals: [],
        completedThroughUtcMs:
          dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!,
      },
      true,
    );
  }
  get cursor() {
    return this.execution.cursor;
  }
  get total() {
    return this.dataset.candles.length;
  }
  advance(count = 1) {
    integer(count, 1, 50000);
    if (this.cursor === this.total)
      throw new Error('回放已结束，无下一根；未强制平仓。');
    const target = Math.min(this.total, this.cursor + count);
    while (this.cursor < target) this.execution.advance();
    if (this.cursor === this.total) this.execution.finish();
  }
  trade(action: 'buy' | 'sell', quantity: string) {
    if (this.cursor < 1 || this.cursor === this.total)
      throw new Error('仅在已播放且非末根的收盘可以提交决策。');
    if (this.decisions.length >= REPLAY_LIMITS.decisions)
      throw new Error('手工决策最多1000次。');
    if (action !== 'buy' && action !== 'sell')
      throw new Error('仅支持虚拟买卖。');
    const signal: Signal = {
      candleIndex: this.cursor - 1,
      action,
      quantity,
      reason: 'manual-' + action,
    };
    this.execution.submit(signal);
    // The engine normalized the quantity; retain that canonical decision.
    this.decisions.push({ ...this.execution.result.signals.at(-1)!.signal });
  }
  note(value: string) {
    if (
      !this.cursor ||
      !text(value, REPLAY_LIMITS.noteLength) ||
      this.notes.length >= REPLAY_LIMITS.notes
    )
      throw new Error('日记需1–2000字符，最多1000条，且必须有已播放K线。');
    this.notes.push({ cursor: this.cursor, text: value });
  }
  private state() {
    return {
      version: REPLAY_VERSION,
      sourceHash: this.sourceHash,
      config: this.config,
      risk: this.risk,
      cursor: this.cursor,
      decisions: this.decisions,
      notes: this.notes,
      account: this.execution.result.final,
      pending: this.execution.pending,
    };
  }
  view(fromCursor = 0): ReplayView {
    integer(fromCursor, 0, this.cursor);
    if (!this.cursor) throw new Error('尚未播放首根。');
    const statistics = calculateStatistics(
      this.execution.result,
      String(this.dataset.candles[0].open),
    );
    const { curve, completedTrades, ...rest } = statistics;
    return {
      source: JSON.parse(JSON.stringify(summarizeDataset(this.dataset))),
      version: REPLAY_VERSION,
      engineVersion: ALGORITHM_VERSION,
      config: { ...this.config },
      risk: { ...this.risk },
      cursor: this.cursor,
      total: this.total,
      fromCursor,
      candles: this.dataset.candles
        .slice(fromCursor, this.cursor)
        .map((c) => ({ ...c })),
      curve: curve.slice(fromCursor === 0 ? 0 : fromCursor + 1),
      account: {
        ...this.execution.result.final,
        position: { ...this.execution.result.final.position },
      },
      pending: this.execution.pending ? { ...this.execution.pending } : null,
      orders: JSON.parse(
        JSON.stringify(this.execution.result.orders.slice(-100)),
      ),
      fills: JSON.parse(
        JSON.stringify(this.execution.result.fills.slice(-100)),
      ),
      orderCount: this.execution.result.orders.length,
      fillCount: this.execution.result.fills.length,
      statistics: { ...rest, completedTradeCount: completedTrades.length },
      notes: this.notes.map((n) => ({ ...n })),
      stateHash: contentHash(this.state()),
      definitions: METRIC_DEFINITIONS,
      assumptions: [
        ...RUN_ASSUMPTIONS,
        '仅已播放前缀；手工当前收盘决策→下一根开盘；每根最多一笔；不允许回退。',
        '状态备份不含行情，恢复须原保存数据集存在且hash一致；查看其他页面或源CSV可破坏盲回放体验。',
      ],
    };
  }
  checkpoint(
    metadata: Pick<ReplayCheckpoint, 'id' | 'name' | 'createdUtcMs'>,
  ): ReplayCheckpoint {
    if (!this.cursor) throw new Error('尚无回放状态。');
    const r = this.execution.result;
    const payload: ReplayPayload = {
      version: REPLAY_VERSION,
      engineVersion: ALGORITHM_VERSION,
      conversionVersion: CONVERSION_VERSION,
      datasetId: this.dataset.id,
      sourceHash: this.sourceHash,
      sourceFileSha256: this.dataset.file.sha256,
      symbol: this.dataset.symbol,
      config: { ...this.config },
      risk: { ...this.risk },
      cursor: this.cursor,
      decisions: this.decisions.map((s) => ({ ...s })),
      notes: this.notes.map((n) => ({ ...n })),
      resultHash: contentHash({
        fills: r.fills,
        orders: r.orders,
        closes: r.closes,
        final: r.final,
      }),
      stateHash: contentHash(this.state()),
    };
    const record: ReplayCheckpoint = {
      format: 'riverlab-replay',
      schemaVersion: 1,
      ...metadata,
      payload,
      payloadHash: contentHash(payload),
      disclaimer: DISCLAIMER,
    };
    assertReplayCheckpoint(record);
    return record;
  }
  static restore(dataset: Dataset, value: unknown): ReplaySession {
    assertReplayCheckpoint(value);
    const p = value.payload;
    const session = new ReplaySession(dataset, p.config, p.risk);
    if (
      dataset.id !== p.datasetId ||
      session.sourceHash !== p.sourceHash ||
      dataset.file.sha256 !== p.sourceFileSha256 ||
      dataset.symbol !== p.symbol
    )
      throw new Error(
        '原数据集缺失、已改变或身份不一致；不能恢复，不自动替换。',
      );
    integer(p.cursor, 1, dataset.candles.length);
    if (p.decisions.some((s) => s.candleIndex >= dataset.candles.length - 1))
      throw new Error('末根之后不能排队决策。');
    let index = 0;
    while (session.cursor < p.cursor) {
      session.advance();
      const decision = p.decisions[index];
      if (
        decision?.candleIndex === session.cursor - 1 &&
        decision.action !== 'hold'
      ) {
        session.trade(decision.action, decision.quantity);
        index++;
      }
    }
    p.notes.forEach((n) => session.notes.push({ ...n }));
    const actual = session.checkpoint({
      id: value.id,
      name: value.name,
      createdUtcMs: value.createdUtcMs,
    });
    if (canonicalJson(actual) !== canonicalJson(value))
      throw new Error('回放重算不一致，记录损坏或版本不支持；未修复。');
    return session;
  }
  csv(): string {
    const cell = (value: unknown) => {
      let s = value == null ? '' : String(value);
      if (/^[\s]*[=+\-@]/.test(s) && !/^-[0-9]+(?:\.[0-9]+)?$/.test(s))
        s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows: unknown[][] = [
      [DISCLAIMER],
      ['replayVersion', REPLAY_VERSION],
      ['stateHash', contentHash(this.state())],
      [
        'type',
        'candleIndex',
        'timestampUtcMs',
        'side',
        'quantity',
        'price',
        'fee',
        'cashAfter',
        'positionAfter',
        'equityAfter',
        'reasonOrNote',
        'intrabarAssumption',
        'orderStatus',
        'barOpenUtcMs',
        'barCloseUtcMs',
      ],
    ];
    this.execution.result.fills.forEach((f) =>
      rows.push([
        'fill',
        f.candleIndex,
        f.timestampUtcMs,
        f.side,
        f.quantity,
        f.price,
        f.fee,
        f.after.cash,
        f.after.position.quantity,
        f.after.equity,
        f.reason,
        f.trigger?.assumption ?? '',
        'filled',
        f.trigger?.barOpenUtcMs ?? '',
        f.trigger?.barCloseUtcMs ?? '',
      ]),
    );
    this.execution.result.orders.forEach((o) =>
      rows.push([
        'order',
        o.intent.targetCandleIndex,
        o.resolvedUtcMs,
        o.intent.side,
        o.intent.quantity,
        '',
        '',
        '',
        '',
        '',
        o.reason ?? o.intent.reason,
        o.intent.trigger?.assumption ?? '',
        o.status,
        o.intent.trigger?.barOpenUtcMs ?? '',
        o.intent.trigger?.barCloseUtcMs ?? '',
      ]),
    );
    this.notes.forEach((n) =>
      rows.push([
        'note',
        n.cursor - 1,
        this.dataset.candles[n.cursor - 1].timestampUtcMs +
          this.dataset.quality.intervalMs!,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        n.text,
        '',
        '',
        '',
        '',
      ]),
    );
    return (
      '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
    );
  }
}
