import type { LocalDatabase } from './local-database';

export interface SummaryList<T> {
  items: T[];
  damagedCount: number;
}

export async function readSummaryList<T>(
  store: LocalDatabase,
  validate: (row: T) => void,
): Promise<SummaryList<T>> {
  const rows = await store.transaction<T[]>('readonly', (tx, done) => {
    const request = tx.objectStore('summaries').getAll();
    request.onsuccess = () => done(request.result);
  });
  // A failed transaction has no usable snapshot. Only a committed read
  // reaches the row-level validation below.
  const items: T[] = [];
  let damagedCount = 0;
  for (const row of rows) {
    try {
      validate(row);
    } catch {
      damagedCount++;
      continue;
    }
    items.push(row);
  }
  return { items, damagedCount };
}
