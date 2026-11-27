import { analyzeCsv } from '../../src/core/data';
import { makeDataset } from '../../src/core/data/dataset';
import {
  runExperiment,
  sealExperiment,
  verifyExperiment,
} from '../../src/core/experiments';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import { options } from '../fixtures/dataset';
import csv from '../fixtures/phase-5e-rolling-synthetic.csv?raw';

// Called only in disposable browser/desktop acceptance profiles. Keep the
// input, metadata and clock identical so the receipts can be compared exactly.
export async function verifyRepositoryParity() {
  const start = 1735689600000;
  const dataset = makeDataset(
    {
      id: '6b-parity-dataset',
      name: '6B 合成验证',
      symbol: 'PARITY/USDT',
      createdUtcMs: start,
      source: { kind: 'synthetic', label: '人工合成', note: '公开测试夹具' },
      file: {
        name: 'phase-5e-rolling-synthetic.csv',
        bytes: new TextEncoder().encode(csv).byteLength,
        sha256:
          '2486b44f7f869049a40fe067b57d53c828ac9f24f3c4290f5a4389bba23ab7fb',
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(csv, options),
  );
  await new DatasetStore().save(dataset);
  const reopened = await new DatasetStore().load(dataset.id);
  const end = start + reopened.candles.length * 60_000;
  const result = runExperiment({
    dataset: reopened,
    strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
    completedThroughUtcMs: end,
  });
  const experiment = sealExperiment(result, {
    id: '6b-parity-experiment',
    name: '6B 两种存储的结果对照',
    createdUtcMs: end,
    elapsedMs: 0,
  });
  await new ExperimentStore().save(experiment);
  const copy = verifyExperiment(
    await new ExperimentStore().load(experiment.id),
  );
  return {
    runHash: copy.payload.result.manifest.runHash,
    payloadHash: copy.payloadHash,
    fills: copy.payload.result.fills.length,
    fees: copy.payload.statistics.fees,
    equity: copy.payload.result.final.equity,
  };
}
