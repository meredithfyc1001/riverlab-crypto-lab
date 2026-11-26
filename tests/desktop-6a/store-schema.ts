// The production adapters lazily initialize their own v1 layout. Only the native
// acceptance runner may exercise this in its newly allocated, synthetic profile.
import { AdvancedStore } from '../../src/infrastructure/advanced-store';
import { DatasetStore } from '../../src/infrastructure/dataset-store';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import { MarketRegimeStore } from '../../src/infrastructure/market-regime-store';
import { PortfolioStore } from '../../src/infrastructure/portfolio-store';
import { ReplayStore } from '../../src/infrastructure/replay-store';
import { RiskStore } from '../../src/infrastructure/risk-store';
import { RuleStore } from '../../src/infrastructure/rule-store';
import { SharedPoolStore } from '../../src/infrastructure/shared-pool-store';

async function verifyAbortedWrites(store: DatasetStore) {
  const id = '6a-abort-' + crypto.randomUUID();
  const names = ['datasets', 'summaries'];
  let writesAccepted = 0;
  let aborted = false;
  try {
    await store.transaction<void>('readwrite', (tx) => {
      for (const name of names) {
        tx.objectStore(name).add({ id }).onsuccess = () => {
          if (++writesAccepted === names.length) tx.abort();
        };
      }
    });
  } catch {
    aborted = true;
  }
  if (!aborted || writesAccepted !== names.length)
    throw new Error('合成测试未在正文和摘要均受理后中止同一事务。');

  const surviving = await store.transaction<number[]>(
    'readonly',
    (tx, done) => {
      const counts: number[] = [];
      for (const name of names) {
        const request = tx.objectStore(name).count(id);
        request.onsuccess = () => {
          counts.push(request.result);
          if (counts.length === names.length) done(counts);
        };
      }
    },
  );
  if (surviving.some((count) => count !== 0))
    throw new Error('合成事务已中止，仍发现对应正文或摘要。');
}

export async function verifyPrototypeStoreSchema(
  operatingProfile: 'fresh-automation',
) {
  if (
    operatingProfile !== 'fresh-automation' ||
    location.origin !== 'https://tauri.localhost' ||
    !('__RIVERLAB_6A_NATIVE_VERIFY__' in window) ||
    window.__RIVERLAB_6A_NATIVE_VERIFY__ !== true
  )
    throw new Error('数据库布局检查仅限原生验收的全新专用配置。');

  const dataset = new DatasetStore();
  const base = 'riverlab-crypto-lab';
  const libraries = [
    [base, dataset, ['datasets', 'summaries']],
    [
      base + '-experiments',
      new ExperimentStore(),
      ['experiments', 'summaries'],
    ],
    [base + '-rules', new RuleStore(), ['versions']],
    [base + '-replays', new ReplayStore(), ['replays', 'summaries']],
    [base + '-risk', new RiskStore(), ['studies', 'summaries']],
    [base + '-portfolios', new PortfolioStore(), ['experiments', 'summaries']],
    [
      base + '-shared-pool',
      new SharedPoolStore(),
      ['experiments', 'summaries'],
    ],
    [
      base + '-market-regime',
      new MarketRegimeStore(),
      ['reports', 'summaries'],
    ],
    [
      base + '-advanced-research',
      new AdvancedStore(),
      ['reports', 'summaries'],
    ],
  ] as const;

  const layout = [];
  let storeCount = 0;
  for (const [name, library, expectedStores] of libraries) {
    // Intentionally initialize a lazy production adapter in this empty test
    // profile. Inspect its real transaction without opening a guessed database
    // name, enumerating other databases, or reading any object-store records.
    const entry = await library.transaction<{
      name: string;
      version: number;
      stores: { name: string; keyPath: string; autoIncrement: boolean }[];
    }>('readonly', (tx, done) => {
      const db = tx.db;
      const names = Array.from(db.objectStoreNames);
      if (
        db.name !== name ||
        db.version !== 1 ||
        names.length !== expectedStores.length ||
        !expectedStores.every((item) => names.includes(item))
      )
        throw new Error(
          `合成库布局不匹配：${db.name} v${db.version} / ${names}`,
        );

      const stores = names.map((storeName) => {
        const objectStore = tx.objectStore(storeName);
        const { keyPath, autoIncrement } = objectStore;
        if (keyPath !== 'id' || autoIncrement)
          throw new Error(`合成库主键不匹配：${db.name}/${storeName}`);
        return { name: storeName, keyPath, autoIncrement };
      });
      done({ name: db.name, version: db.version, stores });
    });
    layout.push(entry);
    storeCount += entry.stores.length;
  }
  await verifyAbortedWrites(dataset);
  return {
    databases: layout.length,
    stores: storeCount,
    abortAtomic: true,
    layout,
  };
}
