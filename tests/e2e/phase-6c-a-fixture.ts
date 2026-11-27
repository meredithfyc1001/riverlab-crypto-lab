import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { runAdvanced } from '../../src/core/advanced-research';
import {
  captureAdvancedInput,
  sealAdvancedReport,
} from '../../src/core/advanced-research/report';
import { normalizeConfig } from '../../src/core/backtests';
import { summarizeDataset } from '../../src/core/data/dataset';
import {
  runExperiment,
  sealExperiment,
  summarizeExperiment,
} from '../../src/core/experiments';
import { createRegimeReport } from '../../src/core/market-regime/report';
import { verifyPortfolioExperiment } from '../../src/core/portfolio/report';
import { summarizePortfolio } from '../../src/core/portfolio/report-common';
import { ReplaySession, summarizeReplay } from '../../src/core/replay';
import {
  analyzeExperiment,
  sealRiskStudy,
  summarizeRisk,
} from '../../src/core/risk-analysis';
import { verifyRuleRecord } from '../../src/core/rule-library';
import { verifySharedPoolExperiment } from '../../src/core/shared-pool/report';
import { START, INTERVAL, market } from '../fixtures/backtest';

export type FixtureDatabase = {
  name: string;
  version: number;
  stores: { name: string; values: { id: string }[] }[];
};

// Produce real historical domain values and their original library summaries.
// The source and target are always separate Playwright-owned contexts.
export function syntheticLibraries(): FixtureDatabase[] {
  const dataset = market(
    Array.from({ length: 36 }, (_, i) => 100 + Math.abs((i % 12) - 6)),
  );
  const end = START + 36 * INTERVAL;
  const metadata = (id: string) => ({
    id,
    name: '全库导出合成样本 ' + id,
    createdUtcMs: end,
  });
  const experiment = sealExperiment(
    runExperiment({
      dataset,
      strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      completedThroughUtcMs: end,
    }),
    { ...metadata('实验'), elapsedMs: 1 },
  );
  const rule = verifyRuleRecord(
    JSON.parse(
      readFileSync('tests/fixtures/phase-5e-breakout-rule.json', 'utf8'),
    ),
  );
  const replay = new ReplaySession(dataset);
  replay.advance();
  replay.trade('buy', '1');
  const checkpoint = replay.checkpoint(metadata('回放'));
  const risk = sealRiskStudy(
    analyzeExperiment(experiment, {
      method: 'block',
      seed: 42,
      paths: 20,
      steps: 10,
      blockSize: 3,
      thresholdPct: 50,
    }),
    { ...metadata('风险'), elapsedMs: 1 },
  );
  const frozen = (name: string) =>
    JSON.parse(
      gunzipSync(readFileSync('tests/fixtures/' + name)).toString('utf8'),
    );
  const portfolio = verifyPortfolioExperiment(
    frozen('phase-5c-a-synthetic.json.gz'),
    1800000000000,
  );
  const shared = verifySharedPoolExperiment(
    frozen('phase-5c-b-rebalance.json.gz'),
    1800000000000,
  );
  const regime = createRegimeReport(
    'single',
    experiment,
    null,
    { lookback: 2, thresholdBps: 100 },
    metadata('市场状态'),
    end,
  );
  const input = captureAdvancedInput(
    {
      dataset,
      ruleRecord: rule,
      completedThroughUtcMs: end,
      config: normalizeConfig({}),
      risk: {},
      axes: [
        {
          side: 'buy',
          condition: 0,
          field: 'lookback',
          min: 1,
          max: 2,
          step: 1,
        },
      ],
      search: { kind: 'grid' },
      filters: {
        minReturn: null,
        maxDrawdown: null,
        minProfitFactor: null,
        minTrades: 0,
      },
      sort: ['maxDrawdown', 'totalReturn'],
      evaluation: { kind: 'split', trainBars: 24 },
      regime: { lookback: 2, thresholdBps: 500 },
    },
    end,
  );
  const advanced = sealAdvancedReport(
    input,
    runAdvanced(input),
    metadata('高级研究'),
  );
  const paired = (
    suffix: string,
    store: string,
    record: { id: string },
    summary: { id: string },
  ): FixtureDatabase => ({
    name: 'riverlab-crypto-lab' + suffix,
    version: 1,
    stores: [
      { name: store, values: [record] },
      { name: 'summaries', values: [summary] },
    ],
  });
  const reportSummary = ({
    id,
    name,
    createdUtcMs,
    reportHash,
  }: {
    id: string;
    name: string;
    createdUtcMs: number;
    reportHash: string;
  }) => ({ id, name, createdUtcMs, reportHash });
  // Legacy records may own an optional key with value undefined. Its presence
  // and its position must survive a full archive/restore round trip.
  const storedDataset = {
    ...dataset,
    source: {
      kind: dataset.source.kind,
      url: undefined,
      label: dataset.source.label,
      note: dataset.source.note,
    },
  };
  return [
    paired('', 'datasets', storedDataset, summarizeDataset(storedDataset)),
    paired(
      '-experiments',
      'experiments',
      experiment,
      summarizeExperiment(experiment),
    ),
    {
      name: 'riverlab-crypto-lab-rules',
      version: 1,
      stores: [{ name: 'versions', values: [rule] }],
    },
    paired('-replays', 'replays', checkpoint, summarizeReplay(checkpoint)),
    paired('-risk', 'studies', risk, summarizeRisk(risk)),
    paired(
      '-portfolios',
      'experiments',
      portfolio,
      summarizePortfolio(portfolio),
    ),
    paired('-shared-pool', 'experiments', shared, summarizePortfolio(shared)),
    paired('-market-regime', 'reports', regime, reportSummary(regime)),
    paired('-advanced-research', 'reports', advanced, reportSummary(advanced)),
  ];
}

// This helper refuses every nonempty target. The test uses it only on a new
// same-origin blank document to avoid workbench initialization creating stores.
export async function populateEmptyProfile(
  page: Page,
  databases: FixtureDatabase[],
) {
  await page.evaluate(async (databases) => {
    if ((await indexedDB.databases()).length !== 0)
      throw new Error('Fixture target must be empty');
    for (const db of databases) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(db.name, db.version);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          for (const store of db.stores) {
            const target = request.result.createObjectStore(store.name, {
              keyPath: 'id',
            });
            for (const value of store.values) target.add(value);
          }
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
    }
  }, databases);
}

export async function inspectProfile(page: Page) {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases()).sort((a, b) =>
      a.name! < b.name! ? -1 : 1,
    );
    const output = [];
    for (const info of dbs) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(info.name!);
        req.onupgradeneeded = () => req.transaction!.abort();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const stores = await Promise.all(
          Array.from(db.objectStoreNames).map(
            (name) =>
              new Promise<{
                name: string;
                keyPath: string | string[] | null;
                keys: IDBValidKey[];
                values: unknown[];
              }>((resolve, reject) => {
                const tx = db.transaction(name, 'readonly');
                const store = tx.objectStore(name);
                const values = store.getAll(),
                  keys = store.getAllKeys();
                tx.oncomplete = () =>
                  resolve({
                    name,
                    keyPath: store.keyPath,
                    keys: keys.result,
                    values: values.result,
                  });
                tx.onabort = () => reject(tx.error);
              }),
          ),
        );
        output.push({ name: db.name, version: db.version, stores });
      } finally {
        db.close();
      }
    }
    return output;
  });
}
