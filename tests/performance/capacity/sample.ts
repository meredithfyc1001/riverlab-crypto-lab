import { makeDataset, type Dataset } from '../../../src/core/data/dataset';
import { alignPortfolioSources } from '../../../src/core/portfolio/alignment';
import { startCsvJob } from '../../../src/features/datasets/worker-client';
import {
  DatasetStore,
  decodeBackup,
  encodeBackup,
} from '../../../src/infrastructure/dataset-store';
import { options } from '../../fixtures/dataset';

const start = 1735689600000;
function syntheticFile(count: number, firstBar: number, asset: number) {
  const rows = ['timestamp,open,high,low,close,volume'];
  for (let i = firstBar; i < firstBar + count; i++) {
    const price = 100 + asset + (i % 7);
    rows.push(
      [start + i * 60000, price, price + 2, price - 2, price, 1].join(','),
    );
  }
  return new File([rows.join('\n')], 'synthetic.csv', { type: 'text/csv' });
}
type Scenario = 'single-50k' | 'single-100k' | 'portfolio-50k';

async function run(scenario: Scenario) {
  const groups =
    scenario === 'portfolio-50k' ? 5 : scenario === 'single-100k' ? 2 : 1;
  const bars = scenario === 'portfolio-50k' ? 10000 : 50000;
  const db = new DatasetStore();
  const sources: Dataset[] = [];
  const measured = {
    csvBytes: 0,
    csvWorkerMs: 0,
    writeMs: 0,
    readMs: 0,
    backupBytes: 0,
    encodeMs: 0,
    decodeMs: 0,
    mainHeapSampleBytes: 0,
  };
  function sampleHeap() {
    const info = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    measured.mainHeapSampleBytes = Math.max(
      measured.mainHeapSampleBytes,
      info.memory?.usedJSHeapSize ?? 0,
    );
  }
  for (let i = 0; i < groups; i++) {
    const asset = scenario === 'portfolio-50k' ? i : 0;
    const file = syntheticFile(
      bars,
      scenario === 'single-100k' ? bars * i : 0,
      asset,
    );
    const begin = performance.now();
    const result = await startCsvJob({
      file,
      settings: options,
      options,
      includeCandles: true,
    }).promise;
    measured.csvWorkerMs += performance.now() - begin;
    if (result.kind !== 'ready' || result.report.validRows !== bars)
      throw new Error('CSV 校验失败');
    measured.csvBytes += file.size;
    const data = makeDataset(
      {
        id: 'capacity-' + i,
        name: '容量测量',
        symbol: 'S' + asset + '/USDT',
        createdUtcMs: start,
        source: { kind: 'synthetic', label: '人工合成', note: '容量测量' },
        file: result.identity,
        parsing: options,
        warningsAcknowledged: true,
      },
      result.report,
    );
    const writing = performance.now();
    await db.save(data);
    const reading = performance.now();
    const saved = await db.load(data.id);
    const encoding = performance.now();
    const backup = await encodeBackup(saved);
    const decoding = performance.now();
    const decoded = await decodeBackup(backup);
    const done = performance.now();
    if ((await encodeBackup(decoded)) !== backup)
      throw new Error('分片备份重导不一致');
    measured.writeMs += reading - writing;
    measured.readMs += encoding - reading;
    measured.encodeMs += decoding - encoding;
    measured.decodeMs += done - decoding;
    measured.backupBytes += new Blob([backup]).size;
    sources.push(decoded);
    sampleHeap();
  }
  let guard: string | null = null;
  const checking = performance.now();
  if (scenario === 'single-100k') {
    const report = await startCsvJob({
      file: syntheticFile(100000, 0, 0),
      settings: options,
      options,
    }).promise;
    if (
      report.kind !== 'report' ||
      !report.report.issueCounts.ROW_LIMIT ||
      report.report.status !== 'has-errors'
    )
      throw new Error('100k 准入结果异常');
    guard = 'ROW_LIMIT';
  } else if (scenario === 'portfolio-50k') {
    try {
      alignPortfolioSources({
        assets: sources.map((dataset) => ({ dataset })),
        initialCash: '1000',
        quoteCurrency: 'USDT',
        startUtcMs: start,
        endUtcMs: start + (bars - 1) * 60000,
        completedThroughUtcMs: start + bars * 60000,
        rangeConfirmed: true,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('10000'))
        throw error;
      guard = error.message;
    }
    if (guard === null) throw new Error('组合超限未拒绝');
  }
  sampleHeap();
  return {
    scenario,
    groups,
    bars,
    ...measured,
    guard,
    guardMs: guard ? performance.now() - checking : null,
  };
}
Object.assign(globalThis, { runCapacitySample: run });
