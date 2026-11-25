// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../../src/core/backtests/identity';
import type { PortfolioInput } from '../../src/core/portfolio';
import {
  createPortfolioExperiment,
  verifyPortfolioExperiment,
  assertPortfolioMemoryBudget,
  MAX_PORTFOLIO_REPORT_BYTES,
  summarizePortfolio,
  portfolioCsv,
} from '../../src/core/portfolio/report';
import { defaultRule } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import {
  exportPortfolioFile,
  readPortfolioFile,
} from '../../src/infrastructure/portfolio-file';
import { PortfolioStore } from '../../src/infrastructure/portfolio-store';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import { RuleStore } from '../../src/infrastructure/rule-store';
import { START, INTERVAL, market } from '../fixtures/backtest';

const metadata = {
  id: 'portfolio-test',
  name: '组合测试',
  createdUtcMs: START,
};
const now = START + 30 * INTERVAL;
function example(): PortfolioInput {
  const rule = sealRule(
    { ...defaultRule(), revision: 2 },
    { familyId: 'demo', name: '已保存规则 V2', createdUtcMs: START },
  );
  return {
    initialCash: '1234.000000000000000001',
    quoteCurrency: 'USDT',
    startUtcMs: START + INTERVAL,
    endUtcMs: START + 10 * INTERVAL,
    completedThroughUtcMs: now,
    rangeConfirmed: true,
    assets: ['BTC', 'ETH'].map((base, i) => ({
      dataset: {
        ...market([10, 13, 12, 11, 12, 13, 15, 11, 13, 12, 13, 10]),
        id: base,
        symbol: base + '/USDT',
      },
      weightPercent: '50',
      ...(i
        ? {
            strategy: { kind: 'rules' as const, rule: rule.rule },
            ruleRecord: rule,
          }
        : { strategy: { kind: 'ma' as const, fastPeriod: 2, slowPeriod: 4 } }),
      costs: {
        feeBps: 10,
        buySlippageBps: 2,
        sellSlippageBps: 3,
        quantityDecimals: 8,
        minNotional: '0',
      },
      risk: {},
    })),
  };
}
const experiment = () => createPortfolioExperiment(example(), metadata, now);

describe('versioned self-contained portfolio reports', () => {
  it('maintains a deterministic payload identity independent of when it is saved', () => {
    const a = experiment(),
      b = createPortfolioExperiment(
        example(),
        { ...metadata, id: 'other', createdUtcMs: now },
        now,
      );
    expect(a.result).toEqual(b.result);
    expect(a.payloadHash).toBe(
      contentHash({ input: a.input, result: a.result }),
    );
    expect(b.payloadHash).toBe(a.payloadHash);
    expect(b.recordHash).not.toBe(a.recordHash);
  });
  it('restores complete source ranges, saved rule revision and both ledgers in an empty profile', async () => {
    const r = experiment(),
      json = exportPortfolioFile(r, 'json', now);
    const restore = await readPortfolioFile(json, now);
    expect(restore).toEqual(r);
    expect(restore.input.assets[1].ruleRecord?.rule.revision).toBe(2);
    expect(restore.input.assets[0].dataset.candles).toHaveLength(12);
    expect(restore.result.assets[0].result.closes).toHaveLength(10);
    const factory = new IDBFactory(),
      store = new PortfolioStore(() => factory);
    await store.save(restore);
    expect(await new DatasetStore(() => factory).list()).toEqual([]);
    expect(await new RuleStore(() => factory).list()).toEqual([]);
    expect(await new ExperimentStore(() => factory).list()).toEqual([]);
    expect(await store.list()).toEqual([summarizePortfolio(r)]);
    expect(
      verifyPortfolioExperiment(
        await new PortfolioStore(() => factory).load(r.id),
        now,
      ),
    ).toEqual(r);
    await store.delete(r.id);
    expect(await store.list()).toEqual([]);
    await expect(store.load(r.id)).rejects.toThrow('找不到');
  });
  it('exports CSV summary with metrics, individual contributions and hashes', async () => {
    const r = experiment(),
      text = await exportPortfolioFile(r, 'csv', now).text();
    expect(text).toContain(r.payloadHash);
    for (const a of r.result.assets)
      expect(text).toContain(a.result.manifest.runHash);
    expect(text).toContain('returnContributionFraction');
    expect(text).toBe(portfolioCsv(r).replace(/^\uFEFF/, ''));
  });
  it('rejects unknown schemas, fields, future confirmation and mismatched hashes', () => {
    const r = experiment();
    for (const [record, pattern] of [
      [{ ...r, schemaVersion: 2 }, '版本'],
      [{ ...r, result: { ...r.result, version: 'unknown' } }, '版本'],
      [{ ...r, additional: 1 }, '未知字段'],
      [{ ...r, name: 'renamed' }, 'Hash'],
      [{ ...r, result: { ...r.result, netPnl: '7' } }, 'Hash'],
      [{ ...r, input: { ...r.input, completedThroughUtcMs: now + 1 } }, '收盘'],
    ] as const)
      expect(() => verifyPortfolioExperiment(record, now)).toThrow(pattern);
  });
  it('rejects independently re-sealed results that disagree with replay', () => {
    const r = experiment();
    r.result.curve[1].equity = '1';
    r.payloadHash = contentHash({ input: r.input, result: r.result });
    r.recordHash = contentHash({
      format: r.format,
      schemaVersion: r.schemaVersion,
      id: r.id,
      name: r.name,
      createdUtcMs: r.createdUtcMs,
      payloadHash: r.payloadHash,
    });
    expect(() => verifyPortfolioExperiment(r, now)).toThrow('重算不一致');
  });
  it('rejects invalid UTF-8, invalid JSON and over-budget files before reading', async () => {
    for (const invalid of ['{', new Uint8Array([0xc3, 0x28])])
      await expect(readPortfolioFile(new Blob([invalid]), now)).rejects.toThrow(
        'UTF-8 JSON',
      );
    for (const size of [0, MAX_PORTFOLIO_REPORT_BYTES + 1]) {
      const file = new Blob();
      Object.defineProperty(file, 'size', { value: size });
      const read = vi.spyOn(file, 'arrayBuffer');
      await expect(readPortfolioFile(file, now)).rejects.toThrow('32 MiB');
      expect(read).not.toHaveBeenCalled();
    }
  });
  it('rejects non-JSON stored results that would change on serialization', () => {
    const r = experiment();
    r.result.assets[0].statistics.completedTrades = Array(1);
    expect(() => verifyPortfolioExperiment(r, now)).toThrow('稀疏数组');
  });
  it('enforces the logical two-tree working-memory budget', () => {
    expect(() =>
      assertPortfolioMemoryBudget(Array(8500).fill('a'.repeat(4096))),
    ).toThrow('256 MiB');
  });
  it('blocks generated reports whose canonical stream would exceed the export/import cap', () => {
    const input = example();
    const quality = input.assets[0].dataset.quality;
    const count = 1000;
    quality.warningCount = count;
    quality.issueCounts = { COVERAGE_UNVERIFIED: 1, OTHER_WARNING: count - 1 };
    quality.issues = [
      quality.issues[0],
      ...Array.from({ length: count - 1 }, () => ({
        severity: 'warning' as const,
        code: 'OTHER_WARNING',
        message: '观'.repeat(3000),
      })),
    ];
    // Two source snapshots alone require >34 MiB in canonical ASCII.
    input.assets[1].dataset.quality = structuredClone(quality);
    expect(() => createPortfolioExperiment(input, metadata, now)).toThrow(
      /32 MiB|256 MiB/,
    );
  });
  it('rejects duplicate IDs and rolls back the first store when the second write fails', async () => {
    const factory = new IDBFactory(),
      store = new PortfolioStore(() => factory),
      r = experiment();
    const add = IDBObjectStore.prototype.add;
    const mock = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof add>
      ) {
        if (this.name === 'summaries')
          throw new DOMException('quota', 'QuotaExceededError');
        return add.apply(this, args);
      });
    try {
      await expect(store.save(r)).rejects.toThrow('quota');
    } finally {
      mock.mockRestore();
    }
    expect(await store.list()).toEqual([]);
    await expect(store.load(r.id)).rejects.toThrow('找不到');
    await store.save(r);
    await expect(store.save(r)).rejects.toThrow();
    expect(await store.load(r.id)).toEqual(r);
  });
});
