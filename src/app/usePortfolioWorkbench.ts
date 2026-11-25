import { useEffect, useRef, useState } from 'react';
import { summarizeDataset } from '../core/data/dataset';
import type { PortfolioAsset } from '../core/portfolio/alignment';
import type {
  PortfolioExperiment,
  PortfolioSummary,
} from '../core/portfolio/report';
import { summarizePortfolio } from '../core/portfolio/report';
import type { PortfolioPlan } from '../features/portfolio';
import { DatasetStore, storageMessage } from '../infrastructure/dataset-store';
import { PortfolioStore } from '../infrastructure/portfolio-store';
import { portfolioTask } from '../infrastructure/portfolio-worker';

export function usePortfolioWorkbench(active: boolean) {
  const [store] = useState(() => new PortfolioStore());
  const [records, setRecords] = useState<PortfolioSummary[]>([]);
  const [record, setRecord] = useState<PortfolioExperiment | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const storageRevision = useRef(0);
  const cancelWorker = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const version = storageRevision.current;
    void store
      .list()
      .then((list) => {
        if (mounted && version === storageRevision.current) setRecords(list);
      })
      .catch((e: unknown) => {
        if (mounted && version === storageRevision.current)
          setError(storageMessage(e));
      });
    return () => {
      mounted = false;
    };
  }, [active, store]);

  useEffect(
    () => () => {
      generation.current++;
      cancelWorker.current?.();
    },
    [],
  );

  function operate(
    status: string,
    action: (current: () => boolean) => Promise<void>,
  ) {
    if (busy) return;
    const version = ++generation.current;
    const current = () => generation.current === version;
    setError('');
    setMessage(status);
    setBusy(true);
    void action(current)
      .catch((failure: unknown) => {
        if (!current()) return;
        setError(
          failure instanceof DOMException
            ? storageMessage(failure)
            : failure instanceof Error
              ? failure.message
              : '组合任务失败。',
        );
        setMessage('');
      })
      .finally(() => {
        if (!current()) return;
        cancelWorker.current = null;
        setCanCancel(false);
        setBusy(false);
      });
  }
  function watch<T>(task: {
    promise: Promise<T>;
    cancel: () => void;
  }): Promise<T> {
    cancelWorker.current = task.cancel;
    setCanCancel(true);
    return task.promise;
  }
  function show(next: PortfolioExperiment, persisted: boolean, status: string) {
    setRecord(next);
    setSaved(persisted);
    setMessage(status);
  }
  function run(plan: PortfolioPlan, name: string) {
    operate('正在读取已确认的数据集并计算组合…', async (current) => {
      const library = new DatasetStore();
      const assets: PortfolioAsset[] = [];
      for (const row of plan.assets) {
        const dataset = await library.load(row.dataset.id);
        if (!current()) return;
        if (
          JSON.stringify(summarizeDataset(dataset)) !==
          JSON.stringify(row.dataset)
        )
          throw new Error('数据集已变更，请刷新列表并重新确认共同区间。');
        assets.push({ ...row, dataset });
      }
      const response = await watch(
        portfolioTask({ kind: 'run', input: { ...plan, assets }, name }),
      );
      if (current())
        show(response.record, false, '组合回测完成，结果可保存或导出。');
    });
  }
  function restore(file: File) {
    operate('正在校验报告并用全部快照重算…', async (current) => {
      const response = await watch(portfolioTask({ kind: 'import', file }));
      if (current())
        show(
          response.record,
          false,
          '组合报告已恢复到内存，校验和重算一致。可保存到本机。',
        );
    });
  }
  function open(id: string) {
    operate('正在打开并复现已保存的组合实验…', async (current) => {
      const raw = await store.load(id);
      if (!current()) return;
      const response = await watch(
        portfolioTask({ kind: 'verify', record: raw }),
      );
      if (current())
        show(response.record, true, '已重新打开组合实验，重算一致。');
    });
  }
  function reproduce() {
    if (!record) return;
    operate('正在从完整组合快照复现…', async (current) => {
      const response = await watch(portfolioTask({ kind: 'verify', record }));
      if (current())
        show(
          response.record,
          saved,
          '完整复现通过。组合 Hash、各子账户与组合统计均一致。',
        );
    });
  }
  function save() {
    if (!record) return;
    operate('正在保存组合实验…', async (current) => {
      await store.save(record);
      if (!current()) return;
      storageRevision.current++;
      const summary = summarizePortfolio(record);
      setRecords((list) => [
        ...list.filter((item) => item.id !== summary.id),
        summary,
      ]);
      setSaved(true);
      setMessage('组合实验已保存。');
    });
  }
  function remove(id: string) {
    operate('正在删除组合实验…', async (current) => {
      await store.delete(id);
      if (!current()) return;
      storageRevision.current++;
      setRecords((list) => list.filter((item) => item.id !== id));
      if (record?.id === id) {
        setRecord(null);
        setSaved(false);
      }
      setMessage('已删除选定的组合实验。');
    });
  }
  function exportRecord(format: 'json' | 'csv') {
    if (!record) return;
    operate('正在生成下载文件…', async (current) => {
      const response = await watch(
        portfolioTask({ kind: 'export', record, format }),
      );
      if (!current()) return;
      const url = URL.createObjectURL(response.file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `riverlab-portfolio-${record.id}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已生成下载，请确认浏览器已保存文件。');
    });
  }
  function cancel() {
    generation.current++;
    cancelWorker.current?.();
    cancelWorker.current = null;
    setCanCancel(false);
    setBusy(false);
    setMessage('已取消组合任务。');
  }
  return {
    record,
    records,
    saved,
    busy,
    canCancel,
    message,
    error,
    run,
    restore,
    open,
    save,
    remove,
    reproduce,
    exportRecord,
    cancel,
  };
}
