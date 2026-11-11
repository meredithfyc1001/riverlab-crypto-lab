import { ACCOUNTING_LIMIT, decimal, readUnits } from '../math';
import { fraction } from '../statistics';
import { pcg32, RNG_VERSION } from './rng';

export const SIMULATION_VERSION = 'net-equity-bootstrap-fixed18-v1';
export const RISK_LIMITS = Object.freeze({
  minPeriods: 20,
  paths: 2000,
  steps: 50000,
  evaluations: 2_000_000,
  bands: 101,
});
export interface RiskSettings {
  method: 'iid' | 'block';
  seed: number;
  paths: number;
  steps: number;
  blockSize: number;
  thresholdPct: number;
}
export interface Frequency {
  count: number;
  total: number;
  fraction: string;
}
export interface PathSummary {
  path: number;
  finalEquity: string;
  netPnl: string;
  totalReturn: string;
  maxDrawdown: string;
  thresholdHit: boolean;
  zero: boolean;
}
export interface Simulation {
  version: typeof SIMULATION_VERSION;
  rngVersion: typeof RNG_VERSION;
  settings: RiskSettings;
  sourcePeriods: number;
  initialEquity: string;
  thresholdEquity: string;
  meanFinalEquity: string;
  quantiles: {
    percentile: number;
    finalEquity: string;
    totalReturn: string;
    maxDrawdown: string;
  }[];
  loss: Frequency;
  thresholdHits: Frequency;
  zeros: Frequency;
  histogram: { lower: string; upper: string; count: number }[];
  bands: { step: number; p05: string; p50: string; p95: string }[];
  traces: { path: number; points: { step: number; equity: string }[] }[];
  paths: PathSummary[];
  warnings: readonly string[];
}
const integer = (n: number, min: number, max: number, label: string) => {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(label + '必须为' + min + '–' + max + '整数。');
};
export function normalizeRiskSettings(
  input: RiskSettings,
  periods: number,
): RiskSettings {
  integer(periods, RISK_LIMITS.minPeriods, 50000, '源样本数');
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          'method',
          'seed',
          'paths',
          'steps',
          'blockSize',
          'thresholdPct',
        ].includes(k),
    )
  )
    throw new Error('风险设置字段无效。');
  if (input.method !== 'iid' && input.method !== 'block')
    throw new Error('抽样方法必须为IID或连续区块。');
  integer(input.seed, 0, 0xffffffff, '种子');
  integer(input.paths, 20, RISK_LIMITS.paths, '路径数');
  integer(input.steps, 1, RISK_LIMITS.steps, '步数');
  integer(input.thresholdPct, 1, 99, '本金阈值百分比');
  integer(input.blockSize, 1, Math.min(periods, 1000), '区块长度');
  if (input.method === 'iid' && input.blockSize !== 1)
    throw new Error('IID的区块长度必须为1。');
  if (input.paths * input.steps > RISK_LIMITS.evaluations)
    throw new Error('超过200万步预算，请明确减少路径或步数；不会自动截断。');
  return {
    method: input.method,
    seed: input.seed,
    paths: input.paths,
    steps: input.steps,
    blockSize: input.blockSize,
    thresholdPct: input.thresholdPct,
  };
}
const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
const rank = (count: number, p: number) => Math.ceil((count * p) / 100) - 1;
/** All intermediate capital and drawdown comparisons are integer/rational. */
export function simulateEquity(
  equities: readonly string[],
  input: RiskSettings,
  progress?: (completed: number, total: number) => void,
): Simulation {
  if (!Array.isArray(equities)) throw new Error('缺少源权益路径。');
  const settings = normalizeRiskSettings(input, equities.length - 1);
  const values = equities.map((s) => {
    const n = readUnits(s);
    if (n <= 0n || n >= ACCOUNTING_LIMIT)
      throw new Error('源权益必须严格为正且小于派生账本上限，含0不能重采样。');
    return n;
  });
  if (values[0] >= 10n ** 48n) throw new Error('源初始本金必须小于1e30。');
  if (values.every((v) => v === values[0]))
    throw new Error('源权益恒定，缺少可重采样风险信息；不生成误导性0%风险。');
  const pairs = values.slice(1).map((n, i) => ({ n, d: values[i] })),
    initial = values[0],
    threshold = (initial * BigInt(settings.thresholdPct)) / 100n;
  const points = Array.from(
    { length: Math.min(RISK_LIMITS.bands, settings.steps + 1) },
    (_, i) =>
      Math.floor(
        (i * settings.steps) /
          (Math.min(RISK_LIMITS.bands, settings.steps + 1) - 1),
      ),
  );
  const buckets = points.map(() => [] as bigint[]),
    traces: Simulation['traces'] = [],
    paths: PathSummary[] = [],
    ddPairs: { n: bigint; d: bigint }[] = [],
    finals: bigint[] = [];
  let loss = 0,
    hits = 0,
    zeros = 0,
    sum = 0n;
  const random = pcg32(settings.seed);
  for (let path = 0; path < settings.paths; path++) {
    let capital = initial,
      peak = initial,
      maxN = 0n,
      maxD = initial,
      hit = false,
      zero = false,
      blockRemaining = 0,
      sourceIndex = 0,
      bandIndex = 1;
    const trace: { step: number; equity: string }[] = [
      { step: 0, equity: decimal(initial) },
    ];
    buckets[0].push(initial);
    for (let step = 1; step <= settings.steps; step++) {
      if (settings.method === 'iid') sourceIndex = random.bounded(pairs.length);
      else {
        if (!blockRemaining) {
          sourceIndex = random.bounded(pairs.length - settings.blockSize + 1);
          blockRemaining = settings.blockSize;
        }
        blockRemaining--;
      }
      const pair = pairs[sourceIndex];
      if (settings.method === 'block') sourceIndex++;
      if (pair.n !== pair.d) capital = (capital * pair.n) / pair.d;
      if (capital >= ACCOUNTING_LIMIT)
        throw new Error(
          '重采样路径超出派生金额上限，整批终止；未裁剪或删除极端路径。',
        );
      if (capital > peak) peak = capital;
      const drop = peak - capital;
      if (drop * maxD > maxN * peak) {
        maxN = drop;
        maxD = peak;
      }
      if (capital <= threshold) hit = true;
      if (capital === 0n) zero = true;
      if (step === points[bandIndex]) {
        buckets[bandIndex].push(capital);
        if (path < 5) trace.push({ step, equity: decimal(capital) });
        bandIndex++;
      }
    }
    if (path < 5) traces.push({ path: path + 1, points: trace });
    finals.push(capital);
    ddPairs.push({ n: maxN, d: maxD });
    sum += capital;
    if (capital < initial) loss++;
    if (hit) hits++;
    if (zero) zeros++;
    paths.push({
      path: path + 1,
      finalEquity: decimal(capital),
      netPnl: decimal(capital - initial),
      totalReturn: fraction(capital - initial, initial),
      maxDrawdown: fraction(maxN, maxD),
      thresholdHit: hit,
      zero,
    });
    if ((path + 1) % 20 === 0 || path + 1 === settings.paths)
      progress?.(path + 1, settings.paths);
  }
  const sorted = [...finals].sort(compare),
    sortedDD = ddPairs.sort((a, b) => compare(a.n * b.d, b.n * a.d));
  const quantiles = [5, 50, 95].map((p) => {
    const i = rank(settings.paths, p),
      dd = sortedDD[i];
    return {
      percentile: p,
      finalEquity: decimal(sorted[i]),
      totalReturn: fraction(sorted[i] - initial, initial),
      maxDrawdown: fraction(dd.n, dd.d),
    };
  });
  const frequency = (count: number): Frequency => ({
    count,
    total: settings.paths,
    fraction: fraction(BigInt(count), BigInt(settings.paths)),
  });
  const min = sorted[0],
    max = sorted.at(-1)!,
    span = max - min;
  const binCount = span === 0n ? 1 : span < 10n ? Number(span) : 10;
  const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
  const histogram = Array.from({ length: binCount }, (_, i) => ({
    lower: decimal(min + ceil(span * BigInt(i), BigInt(binCount))),
    upper: decimal(min + ceil(span * BigInt(i + 1), BigInt(binCount))),
    count: 0,
  }));
  finals.forEach((v) => {
    const index =
      span === 0n
        ? 0
        : Math.min(binCount - 1, Number(((v - min) * BigInt(binCount)) / span));
    histogram[index].count++;
  });
  return {
    version: SIMULATION_VERSION,
    rngVersion: RNG_VERSION,
    settings,
    sourcePeriods: pairs.length,
    initialEquity: decimal(initial),
    thresholdEquity: decimal(threshold),
    meanFinalEquity: decimal(sum / BigInt(settings.paths)),
    quantiles,
    loss: frequency(loss),
    thresholdHits: frequency(hits),
    zeros: frequency(zeros),
    histogram,
    bands: points.map((step, i) => {
      const b = buckets[i].sort(compare);
      return {
        step,
        p05: decimal(b[rank(settings.paths, 5)]),
        p50: decimal(b[rank(settings.paths, 50)]),
        p95: decimal(b[rank(settings.paths, 95)]),
      };
    }),
    traces,
    paths,
    warnings: [
      '模型内样本频率与分位不是未来概率、置信区间或收益保证；0/路径数不代表真实风险为0。',
      settings.method === 'iid'
        ? 'IID有放回抽样破坏原序列相关性。'
        : '区块抽样仅保留块内顺序；跨块关系、市场状态与真实独立性均不保证。',
      '重采样含实际费用/滑点与浮动盈亏的历史净权益比例，不重新撮合、不重算成本或保护，不保证新路径可成交。',
      '所有步骤参与统计；最多101个带点、首5条路径仅作展示；步数轴不代表未来UTC，不计算年化。',
      '历史样本和参数选择偏差不会因增加模拟路径数消失；需独立样本外证据。',
    ],
  };
}
