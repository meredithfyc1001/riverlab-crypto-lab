import { useEffect, useRef, useState } from 'react';
import { assertDataset, summarizeDataset } from '../core/data/dataset';
import type { Dataset, DatasetSummary } from '../core/data/dataset';
import {
  DatasetStore,
  storageMessage,
  encodeBackup,
  decodeBackup,
  MAX_BACKUP_BYTES,
} from '../infrastructure/dataset-store';

export function useDatasetLibrary() {
  const store = useRef(new DatasetStore());
  const [libraryState, setLibraryState] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [pendingRestore, setPendingRestore] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function remember(next: Dataset) {
    setDatasets((list) => [
      ...list.filter((item) => item.id !== next.id),
      summarizeDataset(next),
    ]);
  }
  useEffect(() => {
    let active = true;
    store.current
      .list()
      .then((list) => {
        if (active) {
          setDatasets(list);
          setLibraryState('ready');
        }
      })
      .catch((failure) => {
        if (active) {
          setError(storageMessage(failure));
          setLibraryState('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      setError(storageMessage(failure));
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  async function prepared(next: Dataset, save: boolean) {
    assertDataset(next);
    // Keep in memory even when persistence fails, so users can export a backup.
    setDataset(next);
    await run(async () => {
      if (save) {
        await store.current.save(next);
        setMessage('已保存数据集（IndexedDB 事务已完成）。请另行备份。');
        remember(next);
      } else {
        setMessage('已载入行情中心，仅在当前网页内存；尚未保存。');
        window.location.hash = '/charts';
      }
    });
  }
  async function open(id: string) {
    await run(async () => {
      const next = await store.current.load(id);
      setDataset(next);
      setMessage('已重新打开并校验数据集。');
      window.location.hash = '/charts';
    });
  }
  async function remove(id: string) {
    await run(async () => {
      await store.current.delete(id);
      setDatasets((list) => list.filter((item) => item.id !== id));
      if (dataset?.id === id) setDataset(null);
      setMessage('已删除本地数据集（事务已完成）。');
    });
  }
  async function saveCurrent() {
    if (dataset) await prepared(dataset, true);
  }
  async function exportCurrent() {
    if (!dataset) return;
    await run(async () => {
      const text = await encodeBackup(dataset);
      const url = URL.createObjectURL(
        new Blob([text], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `riverlab-${dataset.id}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        '已生成 JSON 备份下载；请确认浏览器实际保存了文件。校验和不能认证行情来源。',
      );
    });
  }
  async function inspectBackup(file: File) {
    setPendingRestore(null);
    await run(async () => {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error(
          '备份超过 20 MiB。CSV 导入上限仍为 10 MiB / 50,000 行。',
        );
      const next = await decodeBackup(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      );
      setPendingRestore(next);
      setMessage('备份校验完成，尚未保存；请阅读范围及警告后明确恢复。');
    });
  }
  async function restore() {
    if (!pendingRestore) return;
    await run(async () => {
      const next = { ...pendingRestore, id: crypto.randomUUID() };
      await store.current.save(next);
      setDataset(next);
      setPendingRestore(null);
      setMessage('备份已恢复为新副本（事务已完成），未覆盖已有数据。');
      remember(next);
    });
  }
  return {
    libraryState,
    datasets,
    dataset,
    pendingRestore,
    busy,
    message,
    error,
    prepared,
    open,
    remove,
    saveCurrent,
    exportCurrent,
    inspectBackup,
    restore,
  };
}
