import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { storageMessage } from '../infrastructure/dataset-store';
import type { SummaryList } from '../infrastructure/summary-list';

export function useLibraryList<T>(
  store: RefObject<{ listAvailable(): Promise<SummaryList<T>> }>,
  name: string,
) {
  const [snapshot, setSnapshot] = useState<{
    state: 'loading' | 'ready' | 'error';
    items: T[];
    diagnostic: string;
  }>({ state: 'loading', items: [], diagnostic: '' });
  const generation = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    const token = ++generation.current.value;
    try {
      const { items, damagedCount } = await store.current.listAvailable();
      if (token === generation.current.value) {
        setSnapshot({
          state: 'ready',
          items,
          diagnostic: damagedCount
            ? `${name}已隔离 ${damagedCount} 条损坏记录。通过列表校验 ${items.length} 条，原记录保留在库中。`
            : '',
        });
      }
    } catch (error) {
      if (token === generation.current.value)
        setSnapshot({
          state: 'error',
          items: [],
          diagnostic: `${name}读取失败。${storageMessage(error)}`,
        });
    }
  }, [name, store]);
  useEffect(() => {
    const lifetime = generation.current;
    const mountedGeneration = lifetime.value;
    void Promise.resolve().then(() => {
      if (lifetime.value === mountedGeneration) return refresh();
    });
    return () => {
      lifetime.value++;
    };
  }, [refresh]);
  return {
    ...snapshot,
    empty:
      snapshot.state === 'ready' &&
      !snapshot.diagnostic &&
      !snapshot.items.length,
    refresh,
  };
}
