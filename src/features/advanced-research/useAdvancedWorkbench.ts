import { useEffect, useRef, useState } from 'react';
import type {
  AdvancedInput,
  AdvancedPlan,
} from '../../core/advanced-research/types';
import type { AdvancedReport } from '../../core/advanced-research/report';
import {
  DatasetStore,
  storageMessage,
} from '../../infrastructure/dataset-store';
import { AdvancedStore } from '../../infrastructure/advanced-store';
import { advancedTask } from '../../infrastructure/advanced-worker';
import type { DatasetSummary } from '../../core/data/dataset';

type ReportList = Awaited<ReturnType<AdvancedStore['list']>>;
type ReportSummary = ReportList['items'][number];
type Task<T> = { promise: Promise<T>; cancel(): void };
type Pending = {
  input: AdvancedInput;
  plan: AdvancedPlan;
  workers: number;
  concurrency: number;
  name: string;
};

export function useAdvancedWorkbench() {
  const [store] = useState(() => new AdvancedStore());
  const [records, setRecords] = useState<ReportList | null>(null);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [report, setReport] = useState<AdvancedReport | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const generation = useRef({ value: 0 });
  const cancelTask = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    const lifetime = generation.current;
    void store.list().then(
      (list) => {
        if (active) setRecords(list);
      },
      (e) => {
        if (active) setListError(storageMessage(e));
      },
    );
    return () => {
      active = false;
      lifetime.value++;
      cancelTask.current?.();
    };
  }, [store]);

  function operate(
    status: string,
    action: (current: () => boolean) => Promise<void>,
  ) {
    if (busy) return;
    const token = ++generation.current.value;
    const current = () => token === generation.current.value;
    setBusy(true);
    setProgress(null);
    setMessage(status);
    setError('');
    void action(current)
      .catch((e: unknown) => {
        if (current()) {
          setError(e instanceof Error ? e.message : '高级研究任务失败。');
          setMessage('');
        }
      })
      .finally(() => {
        if (current()) {
          cancelTask.current = null;
          setBusy(false);
          setCancellable(false);
          setProgress(null);
        }
      });
  }
  function track<T>(task: Task<T>) {
    cancelTask.current = task.cancel;
    setCancellable(true);
    return task.promise;
  }
  function cancel() {
    generation.current.value++;
    cancelTask.current?.();
    cancelTask.current = null;
    setBusy(false);
    setCancellable(false);
    setProgress(null);
    setMessage('任务已取消。');
  }
  function preview(
    summary: DatasetSummary,
    spec: Omit<AdvancedInput, 'dataset' | 'completedThroughUtcMs'>,
    name: string,
    concurrency: number,
  ) {
    setPending(null);
    operate('正在校验数据、规则和预算…', async (current) => {
      const dataset = await new DatasetStore().load(summary.id);
      if (!current()) return;
      if (
        dataset.file.sha256 !== summary.file.sha256 ||
        dataset.symbol !== summary.symbol ||
        dataset.candles.length !== summary.quality.validRows
      )
        throw new Error('读取的数据集与所选摘要不一致。请重新检查数据集。');
      const completedThroughUtcMs =
        dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!;
      if (completedThroughUtcMs > Date.now())
        throw new Error('数据尚未全部收盘。');
      const input = { ...spec, dataset, completedThroughUtcMs };
      const { plan, workers } = await track(
        advancedTask({ kind: 'preview', input, concurrency }),
      );
      if (current()) {
        setPending({ input, name, concurrency, plan, workers });
        setMessage('预算已校验，可以开始研究。');
      }
    });
  }
  function run() {
    if (!pending) return;
    const { input, name, concurrency } = pending;
    setReport(null);
    setSaved(false);
    operate('正在计算训练与测试窗口…', async (current) => {
      const { record } = await track(
        advancedTask(
          { kind: 'run', input, name, concurrency },
          (done, total) => {
            if (current()) setProgress({ done, total });
          },
        ),
      );
      if (current()) {
        setReport(record);
        setMessage('高级研究已完成。');
      }
    });
  }
  function restore(file: File) {
    operate('正在重算导入报告…', async (current) => {
      const { record } = await track(advancedTask({ kind: 'import', file }));
      if (current()) {
        setReport(record);
        setSaved(false);
        setMessage('报告已恢复，完整重算一致。可保存到本机。');
      }
    });
  }
  function open(row: ReportSummary) {
    operate('正在重开并重算报告…', async (current) => {
      const raw = await store.load(row.id);
      if (!current()) return;
      const { record } = await track(
        advancedTask({ kind: 'verify', record: raw }),
      );
      if (
        record.id !== row.id ||
        record.name !== row.name ||
        record.createdUtcMs !== row.createdUtcMs ||
        record.reportHash !== row.reportHash
      )
        throw new Error('报告正文与所选摘要不一致。');
      if (current()) {
        setReport(record);
        setSaved(true);
        setMessage('已重开高级研究报告，完整重算一致。');
      }
    });
  }
  function save() {
    if (!report || saved) return;
    operate('正在保存报告…', async (current) => {
      await advancedTask({ kind: 'save', record: report }).promise;
      if (!current()) return;
      setSaved(true);
      setMessage('高级研究报告已保存。');
      try {
        const list = await store.list();
        if (current()) {
          setRecords(list);
          setListError('');
        }
      } catch (e) {
        if (current()) setListError(storageMessage(e));
      }
    });
  }
  function download(format: 'json' | 'csv') {
    if (!report) return;
    operate('正在生成导出文件…', async (current) => {
      const { file } = await track(
        advancedTask({ kind: 'export', record: report, format }),
      );
      if (!current()) return;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `riverlab-advanced-${report.reportHash.slice(0, 12)}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('下载文件已生成。');
    });
  }
  return {
    records,
    listError,
    pending,
    report,
    saved,
    busy,
    cancellable,
    message,
    error,
    progress,
    cancel,
    preview,
    run,
    restore,
    open,
    save,
    download,
    invalidate: () => {
      setPending(null);
      setMessage('');
      setError('');
    },
  };
}
