// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import * as desktop from '../../src/infrastructure/desktop-repository';
import { AdvancedStore } from '../../src/infrastructure/advanced-store';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import { MarketRegimeStore } from '../../src/infrastructure/market-regime-store';
import { PortfolioStore } from '../../src/infrastructure/portfolio-store';
import { ReplayStore } from '../../src/infrastructure/replay-store';
import { RiskStore } from '../../src/infrastructure/risk-store';
import { RuleStore } from '../../src/infrastructure/rule-store';
import { SharedPoolStore } from '../../src/infrastructure/shared-pool-store';
import { verifyRepositoryParity } from '../desktop-6a/repository-parity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('routes all nine desktop libraries to the IPC repository and surfaces service failure', async () => {
  const browser = new IDBFactory();
  const open = vi.spyOn(browser, 'open');
  vi.stubGlobal('indexedDB', browser);
  vi.spyOn(desktop, 'isDesktopRepository').mockReturnValue(true);
  const list = vi
    .spyOn(desktop.desktopRepository, 'list')
    .mockResolvedValue([]);
  for (const [kind, Store] of [
    ['dataset', DatasetStore],
    ['experiment', ExperimentStore],
    ['rule', RuleStore],
    ['replay', ReplayStore],
    ['risk', RiskStore],
    ['portfolio', PortfolioStore],
    ['shared_pool', SharedPoolStore],
    ['regime', MarketRegimeStore],
    ['advanced', AdvancedStore],
  ] as const) {
    await new Store().list();
    expect(list).toHaveBeenLastCalledWith(kind);
  }
  list.mockRejectedValueOnce(new Error('服务已停止'));
  await expect(new DatasetStore().list()).rejects.toThrow('服务已停止');
  expect(open).not.toHaveBeenCalled();
});

it('reopens and recomputes the shared synthetic acceptance fixture through isolated IndexedDB', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const receipt = await verifyRepositoryParity();
  expect(receipt).toEqual({
    runHash: 'ae81f9b7bea46c9ca783fcb80ad4358f97726bfb5b0e5fde6c8b2b59e3a7c1f7',
    payloadHash:
      'a4ced2d170b7d1bb7e790a4fb4d92c769848ed20ce79f5cbf60cb632d6218501',
    fills: 9,
    fees: '9.28719551797935',
    equity: '1209.64074296063065',
  });
});
