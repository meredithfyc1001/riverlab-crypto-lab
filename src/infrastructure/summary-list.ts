import type { LibraryStore } from './repository';

export interface SummaryList<T> {
  items: T[];
  damagedCount: number;
}

export async function readSummaryList<T>(
  store: LibraryStore,
  validate: (row: T) => void,
): Promise<SummaryList<T>> {
  const items: T[] = [];
  let damagedCount = 0;
  await store.repository.visitSummaries((value) => {
    const row = value as T;
    try {
      validate(row);
      items.push(row);
    } catch {
      damagedCount++;
    }
    return true;
  });
  return { items, damagedCount };
}
