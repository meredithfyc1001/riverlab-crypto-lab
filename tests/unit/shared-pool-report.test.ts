// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../../src/core/backtests/identity';
import { DEFAULT_CONFIG } from '../../src/core/backtests/config';
import { MAX_PORTFOLIO_REPORT_BYTES } from '../../src/core/portfolio/report-common';
import { verifyPortfolioExperiment } from '../../src/core/portfolio/report';
import {
  createSharedPoolExperiment,
  verifySharedPoolExperiment,
} from '../../src/core/shared-pool/report';
import type { SharedPoolExperiment } from '../../src/core/shared-pool/report';
import type { SharedPoolInput } from '../../src/core/shared-pool/types';
import { defaultRule } from '../../src/core/strategies';
import { sealRule } from '../../src/core/rule-library';
import { PortfolioStore } from '../../src/infrastructure/portfolio-store';
import { SharedPoolStore } from '../../src/infrastructure/shared-pool-store';
import {
  readSharedPoolFile,
  exportSharedPoolFile,
} from '../../src/infrastructure/shared-pool-file';
import { START, INTERVAL, market } from '../fixtures/backtest';

const now = START + 30 * INTERVAL;
const metadata = {
  id: 'shared-report',
  name: '共享资金池验收',
  createdUtcMs: now,
};
function input(mode: SharedPoolInput['mode']): SharedPoolInput {
  const {
    feeBps,
    buySlippageBps,
    sellSlippageBps,
    quantityDecimals,
    minNotional,
  } = DEFAULT_CONFIG;
  const costs = {
    feeBps,
    buySlippageBps,
    sellSlippageBps,
    quantityDecimals,
    minNotional,
  };
  const source = (base: string) => ({
    dataset: {
      ...market([11, 10, 12, 11, 10, 13, 11, 14, 10, 12, 10, 11]),
      symbol: base + 'USDT',
      id: base,
    },
    weightPercent: '45',
    costs,
  });
  const base = {
    initialCash: '1000',
    quoteCurrency: 'USDT',
    startUtcMs: START + INTERVAL,
    endUtcMs: START + 10 * INTERVAL,
    completedThroughUtcMs: now,
    rangeConfirmed: true as const,
  };
  if (mode === 'rebalance')
    return {
      ...base,
      mode,
      assets: [source('ETH'), source('BTC')],
      cashWeightPercent: '10',
      rebalanceEvery: 2,
    };
  const ruleRecord = sealRule(
    { ...defaultRule(), revision: 2 },
    { familyId: 'shared-test', name: '规则 V2', createdUtcMs: START },
  );
  return {
    ...base,
    mode,
    assets: [
      {
        ...source('ETH'),
        risk: {},
        strategy: { kind: 'rules', rule: ruleRecord.rule },
        ruleRecord,
      },
      {
        ...source('BTC'),
        risk: { stopLossBps: 200 },
        strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
      },
    ],
  };
}

function reseal(r: SharedPoolExperiment) {
  r.payloadHash = contentHash({ input: r.input, result: r.result });
  const { format, schemaVersion, id, name, createdUtcMs, payloadHash } = r;
  r.recordHash = contentHash({
    format,
    schemaVersion,
    id,
    name,
    createdUtcMs,
    payloadHash,
  });
}

describe('共享资金池独立格式、存储及完整重算', () => {
  it.each(['rebalance', 'shared-strategy'] as const)(
    '%s 独立恢复所有源、规则和事件，并导出可核对的 CSV',
    async (mode) => {
      const spec = input(mode);
      const record = createSharedPoolExperiment(spec, metadata, now);
      const reversed = structuredClone(spec);
      reversed.assets.reverse();
      expect(
        createSharedPoolExperiment(reversed, { ...metadata, id: 'second' }, now)
          .payloadHash,
      ).toBe(record.payloadHash);
      expect(record.result.orders.length).toBeGreaterThan(0);
      expect(record.input.assets[0].dataset.candles).toHaveLength(12);
      if (record.input.mode === 'shared-strategy')
        expect(
          record.input.assets.find((a) => a.ruleRecord)?.ruleRecord?.rule
            .revision,
        ).toBe(2);
      const copy = await readSharedPoolFile(
        exportSharedPoolFile(record, 'json', now),
        now,
      );
      expect(copy).toEqual(record);
      const factory = new IDBFactory();
      const store = new SharedPoolStore(() => factory);
      await store.save(copy);
      expect(await new PortfolioStore(() => factory).list()).toEqual([]);
      const reopened = await new SharedPoolStore(() => factory).load(record.id);
      expect(verifySharedPoolExperiment(reopened, now)).toEqual(record);
      expect(() => verifyPortfolioExperiment(reopened, now)).toThrow('版本');
      const csv = await exportSharedPoolFile(copy, 'csv', now).text();
      for (const column of [
        'requestedBudget',
        'approvedBudget',
        'unusedBudget',
        'executionPrice',
        'cashBefore',
        'cashAfter',
        'quantityBefore',
        'quantityAfter',
        'beforePercent',
        'afterPercent',
        'deviationPercent',
        'netContribution',
      ])
        expect(csv).toContain(column);
      expect(csv).toContain(copy.payloadHash);
    },
  );

  it('拒绝已重签且改变规范交易对顺序的报告', () => {
    const r = createSharedPoolExperiment(input('rebalance'), metadata, now);
    const original = r.payloadHash;
    r.input.assets.reverse();
    reseal(r);
    expect(r.payloadHash).not.toBe(original);
    expect(createSharedPoolExperiment(r.input, metadata, now).payloadHash).toBe(
      original,
    );
    expect(() => verifySharedPoolExperiment(r, now)).toThrow('规范交易对顺序');
  });

  it('拒绝损坏、未来确认、未知字段/版本及另一模式的算法', () => {
    const r = createSharedPoolExperiment(input('rebalance'), metadata, now);
    for (const [record, reason] of [
      [{ ...r, name: '改名' }, 'Hash'],
      [{ ...r, payloadHash: [r.payloadHash] }, 'Hash'],
      [{ ...r, recordHash: [r.recordHash] }, 'Hash'],
      [{ ...r, result: { ...r.result, fees: '99999' } }, 'Hash'],
      [{ ...r, extra: true }, '未知字段'],
      [{ ...r, schemaVersion: 0 }, '版本'],
      [
        { ...r, result: { ...r.result, version: 'shared-spot-strategy-v1' } },
        '版本',
      ],
      [{ ...r, input: { ...r.input, completedThroughUtcMs: now + 1 } }, '收盘'],
    ] as const)
      expect(() => verifySharedPoolExperiment(record, now)).toThrow(reason);
    const order = r.result.orders.find((o) => o.status === 'filled')!;
    order.cashAfter = '777';
    reseal(r);
    expect(() => verifySharedPoolExperiment(r, now)).toThrow('完整重算不一致');
  });

  it('损坏文件和超限输入不会提交事务，冲突 ID 或存储失败完整回滚', async () => {
    const r = createSharedPoolExperiment(
      input('shared-strategy'),
      metadata,
      now,
    );
    const factory = new IDBFactory();
    const store = new SharedPoolStore(() => factory);
    await store.save(r);
    const duplicate = createSharedPoolExperiment(
      input('rebalance'),
      metadata,
      now,
    );
    await expect(store.save(duplicate)).rejects.toThrow('相同 ID');
    for (const invalid of ['{', new Uint8Array([0xc3, 0x28])])
      await expect(
        readSharedPoolFile(new Blob([invalid]), now),
      ).rejects.toThrow('UTF-8 JSON');
    const oversize = new Blob();
    Object.defineProperty(oversize, 'size', {
      value: MAX_PORTFOLIO_REPORT_BYTES + 1,
    });
    const read = vi.spyOn(oversize, 'arrayBuffer');
    await expect(readSharedPoolFile(oversize, now)).rejects.toThrow('32 MiB');
    expect(read).not.toHaveBeenCalled();

    const next = createSharedPoolExperiment(
      input('rebalance'),
      { ...metadata, id: 'unsaved' },
      now,
    );
    const add = IDBObjectStore.prototype.add;
    const fail = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof add>
      ) {
        if (this.name === 'summaries')
          throw new DOMException('quota limit', 'QuotaExceededError');
        return add.apply(this, args);
      });
    try {
      await expect(store.save(next)).rejects.toThrow('quota');
    } finally {
      fail.mockRestore();
    }
    await expect(store.load(next.id)).rejects.toThrow('找不到');
    expect((await store.list()).map((s) => s.id)).toEqual([r.id]);
    expect(await store.load(r.id)).toEqual(r);
  });
});
