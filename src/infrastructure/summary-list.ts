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
  return isolateRecords(rows, (row) => {
    validate(row);
    return row;
  });
}

export function isolateRecords<Input, Output>(
  rows: Input[],
  verify: (row: Input) => Output,
): SummaryList<Output> {
  const items: Output[] = [];
  let damagedCount = 0;
  for (const row of rows) {
    try {
      items.push(verify(row));
    } catch {
      damagedCount++;
    }
  }
  return { items, damagedCount };
}
