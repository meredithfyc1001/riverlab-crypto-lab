import type { RegimeReport } from '../core/market-regime/report';
import { ExperimentStore } from './experiment-store';
import { PortfolioStore } from './portfolio-store';
import { SharedPoolStore } from './shared-pool-store';
import { LocalDatabase } from './local-database';
import type { RegimeSourceKind } from './market-regime-worker';

export interface RegimeSourceSummary {
  kind: RegimeSourceKind;
  id: string;
  name: string;
  symbols: string[];
  payloadHash: string;
}
export async function listRegimeSources(): Promise<RegimeSourceSummary[]> {
  const [singles, portfolios, shared] = await Promise.all([
    new ExperimentStore().list(),
    new PortfolioStore().list(),
    new SharedPoolStore().list(),
  ]);
  return [
    ...singles.map(({ id, name, symbol, payloadHash }) => ({
      kind: 'single' as const,
      id,
      name,
      symbols: [symbol],
      payloadHash,
    })),
    ...portfolios.map(({ id, name, symbols, payloadHash }) => ({
      kind: 'portfolio' as const,
      id,
      name,
      symbols,
      payloadHash,
    })),
    ...shared.map(({ id, name, symbols, payloadHash }) => ({
      kind: 'shared' as const,
      id,
      name,
      symbols,
      payloadHash,
    })),
  ];
}

export type RegimeSummary = Pick<
  RegimeReport,
  'id' | 'name' | 'createdUtcMs' | 'reportHash'
>;
function checkSummary(row: RegimeSummary) {
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id.trim() ||
    row.id.length > 100 ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    row.name.length > 160 ||
    !Number.isSafeInteger(row.createdUtcMs) ||
    row.createdUtcMs < 0 ||
    row.createdUtcMs > 4_102_444_800_000 ||
    typeof row.reportHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.reportHash)
  )
    throw new Error('市场状态报告摘要损坏。');
}

export class MarketRegimeStore extends LocalDatabase {
  constructor(factory: () => IDBFactory = () => indexedDB) {
    super(factory, 'riverlab-crypto-lab-market-regime', [
      'reports',
      'summaries',
    ]);
  }
  // Called only for records created or fully replayed by the Worker.
  async save(report: RegimeReport) {
    const { id, name, createdUtcMs, reportHash } = report;
    const summary = { id, name, createdUtcMs, reportHash };
    checkSummary(summary);
    try {
      await this.transaction<void>('readwrite', (tx, done) => {
        tx.objectStore('reports').add(report);
        tx.objectStore('summaries').add(summary);
        done(undefined);
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'ConstraintError')
        throw new Error('相同 ID 的市场状态报告已存在，已拒绝覆盖。', {
          cause: e,
        });
      throw e;
    }
  }
  async list(): Promise<RegimeSummary[]> {
    const rows = await this.transaction<RegimeSummary[]>(
      'readonly',
      (tx, done) => {
        const request = tx.objectStore('summaries').getAll();
        request.onsuccess = () => done(request.result);
      },
    );
    rows.forEach(checkSummary);
    return rows;
  }
  async load(id: string): Promise<unknown> {
    const row = await this.transaction<unknown>('readonly', (tx, done) => {
      const request = tx.objectStore('reports').get(id);
      request.onsuccess = () => done(request.result);
    });
    if (!row) throw new Error('市场状态报告不存在，可能已被删除。');
    return row;
  }
  async delete(id: string) {
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('reports').delete(id);
      tx.objectStore('summaries').delete(id);
      done(undefined);
    });
  }
}
