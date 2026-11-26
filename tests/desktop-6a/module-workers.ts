import { makeDataset } from '../../src/core/data/dataset';
import { createRegimeReport } from '../../src/core/market-regime/report';
import { analyzeExperiment, sealRiskStudy } from '../../src/core/risk-analysis';
import { startCsvJob } from '../../src/features/datasets/worker-client';
import { workerTask } from '../../src/infrastructure/backtest-worker';
import { marketRegimeTask } from '../../src/infrastructure/market-regime-worker';
import { portfolioTask } from '../../src/infrastructure/portfolio-worker';
import { replayWorker } from '../../src/infrastructure/replay-worker';
import { researchTask } from '../../src/infrastructure/research-worker';
import { riskTask } from '../../src/infrastructure/risk-worker';
import { sharedPoolTask } from '../../src/infrastructure/shared-pool-worker';
import { options } from '../fixtures/dataset';
import fixedGzipUrl from '../fixtures/phase-5c-a-synthetic.json.gz?url&inline';
import rebalanceGzipUrl from '../fixtures/phase-5c-b-rebalance.json.gz?url&inline';

async function fixtureFile(url: string) {
  // The release embeds these small, frozen exports. Vite dev serves them by URL.
  const gzip = url.startsWith('data:')
    ? new Blob([
        Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) =>
          c.charCodeAt(0),
        ),
      ])
    : await (await fetch(url)).blob();
  return new Response(
    gzip.stream().pipeThrough(new DecompressionStream('gzip')),
  ).blob();
}

function check(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

export async function runModuleWorkers(): Promise<string[]> {
  const start = Date.UTC(2024, 0, 1);
  const rows = Array.from({ length: 60 }, (_, i) => {
    const price = 100 + Math.min(i % 12, 12 - (i % 12));
    return [start + i * 60_000, price, price + 1, price - 1, price, 1].join(
      ',',
    );
  });
  const file = new File(
    [['timestamp,open,high,low,close,volume', ...rows].join('\n')],
    '6A 人工行情.csv',
  );
  const csv = await startCsvJob({
    file,
    settings: options,
    options,
    includeCandles: true,
  }).promise;
  check(
    csv.kind === 'ready' && csv.report.validRows === 60,
    'CSV Worker 未返回 60 根人工行情',
  );
  const dataset = makeDataset(
    {
      id: '6a-worker-fixture',
      name: '6A 验证样本',
      symbol: 'DEMO/USDT',
      createdUtcMs: start,
      source: {
        kind: 'synthetic',
        label: '人工合成',
        note: '6A Worker 兼容性',
      },
      file: csv.identity,
      parsing: options,
      warningsAcknowledged: true,
    },
    csv.report,
  );
  const observedUtcMs = start + rows.length * 60_000;
  const metadata = {
    id: '6a-probe',
    name: '人工合成',
    createdUtcMs: observedUtcMs,
  };
  const strategy = { kind: 'ma', fastPeriod: 2, slowPeriod: 4 } as const;
  const result = await workerTask({
    kind: 'run',
    ...metadata,
    input: { dataset, strategy, completedThroughUtcMs: observedUtcMs },
  }).promise;
  check(
    'record' in result && result.record.payload.result.fills.length > 0,
    '回测 Worker 未产生预期成交',
  );
  const source = result.record;
  const research = await researchTask(
    {
      kind: 'run',
      input: {
        dataset,
        candidates: [strategy],
        completedThroughUtcMs: observedUtcMs,
        evaluation: { kind: 'full' },
      },
    },
    () => {},
  ).promise;
  check(research.report.rows.length === 1, '参数研究 Worker 未返回完整结果');

  const risk = sealRiskStudy(
    analyzeExperiment(source, {
      method: 'iid',
      seed: 42,
      paths: 20,
      steps: 12,
      blockSize: 1,
      thresholdPct: 95,
    }),
    { ...metadata, elapsedMs: 0 },
  );
  const riskResult = await riskTask(
    { kind: 'verify', record: risk, observedUtcMs },
    () => {},
  ).promise;
  check(
    riskResult.record?.payloadHash === risk.payloadHash,
    '风险 Worker 重算不一致',
  );

  const fixed = await portfolioTask({
    kind: 'import',
    file: await fixtureFile(fixedGzipUrl),
  }).promise;
  check(
    fixed.record.recordHash ===
      '61c82bbfe271f5e670a8fea168c40fb268ede26bc602f8048ed43cf78fe6c7db',
    '固定子账户历史报告不一致',
  );
  const pool = await sharedPoolTask({
    kind: 'import',
    file: await fixtureFile(rebalanceGzipUrl),
  }).promise;
  check(
    pool.record.recordHash ===
      '8a5a217ae692abe059db44270ef24079ac204aae72579eccb441544e4fdfb714',
    '共享池历史报告不一致',
  );

  const regime = createRegimeReport(
    'single',
    source,
    null,
    { lookback: 2, thresholdBps: 500 },
    metadata,
    observedUtcMs,
  );
  const verified = await marketRegimeTask({ kind: 'verify', record: regime })
    .promise;
  check(
    verified.record.reportHash === regime.reportHash,
    '市场状态 Worker 重算不一致',
  );

  // A valid replay needs a stored source. The Windows UI test creates that source
  // in a private profile. This portable probe must never open a product database.
  const replay = replayWorker();
  try {
    const message = await replay.request({ kind: 'csv' }).then(
      () => '',
      (error: Error) => error.message,
    );
    check(message.includes('请先开始回放'), '回放 Worker 未识别空会话');
  } finally {
    replay.close();
  }
  return [
    'csv',
    'backtest',
    'research',
    'risk',
    'portfolio',
    'shared-pool',
    'market-regime',
    'replay',
  ];
}
