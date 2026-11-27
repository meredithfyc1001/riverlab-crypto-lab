import type { RegimeReport } from '../core/market-regime/report';
import { storageMessage } from './dataset-store';
import { readSummaryList, type SummaryList } from './summary-list';
import { ExperimentStore } from './experiment-store';
import { PortfolioStore } from './portfolio-store';
import { SharedPoolStore } from './shared-pool-store';
import { LibraryStore } from './repository';
import type { RegimeSourceKind } from './market-regime-worker';

export interface RegimeSourceSummary {
  kind: RegimeSourceKind;
  id: string;
  name: string;
  symbols: string[];
  payloadHash: string;
}
export type RegimeSourceLibrary =
  SummaryList<RegimeSourceSummary> | { error: string };

async function sourceLibrary<
  T extends Pick<RegimeSourceSummary, 'id' | 'name' | 'payloadHash'>,
>(
  kind: RegimeSourceKind,
  load: Promise<SummaryList<T>>,
  getSymbols: (row: T) => string[],
): Promise<RegimeSourceLibrary> {
  try {
    const { items, damagedCount } = await load;
    return {
      items: items.map((row) => ({
        kind,
        id: row.id,
        name: row.name,
        payloadHash: row.payloadHash,
        symbols: getSymbols(row),
      })),
      damagedCount,
    };
  } catch (error) {
    return { error: storageMessage(error) };
  }
}
export async function listRegimeSources(): Promise<
  Record<RegimeSourceKind, RegimeSourceLibrary>
> {
  const [single, portfolio, shared] = await Promise.all([
    sourceLibrary('single', new ExperimentStore().listAvailable(), (row) => [
      row.symbol,
    ]),
    sourceLibrary(
      'portfolio',
      new PortfolioStore().listAvailable(),
      (row) => row.symbols,
    ),
    sourceLibrary(
      'shared',
      new SharedPoolStore().listAvailable(),
      (row) => row.symbols,
    ),
  ]);
  return { single, portfolio, shared };
}

export type RegimeSummary = Pick<
  RegimeReport,
  'id' | 'name' | 'createdUtcMs' | 'reportHash'
>;
export function checkSummary(row: RegimeSummary) {
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

export class MarketRegimeStore extends LibraryStore {
  constructor(factory?: () => IDBFactory, name?: string) {
    super('regime', factory, name);
  }
  // Called only for records created or fully replayed by the Worker.
  async save(report: RegimeReport) {
    const { id, name, createdUtcMs, reportHash } = report;
    const summary = { id, name, createdUtcMs, reportHash };
    checkSummary(summary);
    try {
      await this.repository.insert(report, summary);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'ConstraintError')
        throw new Error('相同 ID 的市场状态报告已存在，已拒绝覆盖。', {
          cause: e,
        });
      throw e;
    }
  }
  list() {
    return readSummaryList(this, checkSummary);
  }
  async load(id: string): Promise<unknown> {
    const row = await this.repository.get(id);
    if (!row) throw new Error('市场状态报告不存在，可能已被删除。');
    return row;
  }
}
