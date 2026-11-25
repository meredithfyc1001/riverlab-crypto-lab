import { useEffect, useRef, useState } from 'react';
import type { RegimeParams } from '../../core/market-regime/model';
import type { RegimeReport } from '../../core/market-regime/report';
import { storageMessage } from '../../infrastructure/dataset-store';
import {
  listRegimeSources,
  MarketRegimeStore,
} from '../../infrastructure/market-regime-store';
import { marketRegimeTask } from '../../infrastructure/market-regime-worker';

type Source = Awaited<ReturnType<typeof listRegimeSources>>[number];
type Summary = Awaited<ReturnType<MarketRegimeStore['list']>>[number];
type ReportTask<T> = { promise: Promise<T>; cancel: () => void };

export function useRegimeWorkbench() {
  const [store] = useState(() => new MarketRegimeStore());
  const [sources, setSources] = useState<Source[]>([]);
  const [records, setRecords] = useState<Summary[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [report, setReport] = useState<RegimeReport | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cancelWorker = useRef<(() => void) | null>(null);
  useEffect(() => {
    let mounted = true;
    const fail = (e: unknown) => {
      if (mounted) setError(storageMessage(e));
    };
    void listRegimeSources().then((items) => {
      if (mounted) setSources(items);
    }, fail);
    void store
      .list()
      .then((items) => {
        if (mounted) setRecords(items);
      }, fail)
      .finally(() => {
        if (mounted) setLoadingRecords(false);
      });
    return () => {
      mounted = false;
      generation.current += 1;
      cancelWorker.current?.();
    };
  }, [store]);

  function operate(
    text: string,
    work: (current: () => boolean) => Promise<void>,
  ) {
    if (busy) return;
    const token = ++generation.current;
    const current = () => token === generation.current;
    setBusy(true);
    setError('');
    setMessage(text);
    void work(current)
      .catch((e: unknown) => {
        if (current()) {
          setMessage('');
          setError(
            e instanceof DOMException
              ? storageMessage(e)
              : e instanceof Error
                ? e.message
                : '市场状态研究失败。',
          );
        }
      })
      .finally(() => {
        if (current()) {
          cancelWorker.current = null;
          setCancellable(false);
          setBusy(false);
        }
      });
  }
  function track<T>(task: ReportTask<T>) {
    cancelWorker.current = task.cancel;
    setCancellable(true);
    return task.promise;
  }
  function show(
    task: () => ReportTask<{ record: RegimeReport }>,
    status: string,
  ) {
    operate('正在校验原实验并计算市场状态…', async (current) => {
      const { record } = await track(task());
      if (current()) {
        setReport(record);
        setSaved(false);
        setMessage(status);
      }
    });
  }
  function run(
    source: Source,
    reference: string | null,
    params: RegimeParams,
    name: string,
  ) {
    show(
      () =>
        marketRegimeTask({
          kind: 'run',
          name,
          input: {
            sourceKind: source.kind,
            sourceId: source.id,
            expectedHash: source.payloadHash,
            reference,
            params,
          },
        }),
      '市场状态研究已完成。',
    );
  }
  function open(summary: Summary) {
    operate('正在重开并复现市场状态报告…', async (current) => {
      const raw = await store.load(summary.id);
      if (!current()) return;
      const { record } = await track(
        marketRegimeTask({ kind: 'verify', record: raw }),
      );
      if (
        record.id !== summary.id ||
        record.reportHash !== summary.reportHash ||
        record.name !== summary.name ||
        record.createdUtcMs !== summary.createdUtcMs
      )
        throw new Error('报告正文与已选择的存储摘要不一致。');
      if (current()) {
        setReport(record);
        setSaved(true);
        setMessage('已重开市场状态报告，重算一致。');
      }
    });
  }
  function restore(file: File) {
    show(
      () => marketRegimeTask({ kind: 'import', file }),
      '市场状态报告已恢复，重算一致。可保存到本机。',
    );
  }
  function save() {
    if (!report || saved) return;
    operate('正在保存市场状态报告…', async (current) => {
      await store.save(report);
      if (!current()) return;
      setSaved(true);
      const { id, name, createdUtcMs, reportHash } = report;
      setRecords((rows) => [...rows, { id, name, createdUtcMs, reportHash }]);
      setMessage('市场状态报告已保存。');
    });
  }
  function remove(id: string) {
    operate('正在删除选定报告…', async (current) => {
      await store.delete(id);
      if (!current()) return;
      setRecords((rows) => rows.filter((row) => row.id !== id));
      if (report?.id === id && saved) {
        setReport(null);
        setSaved(false);
      }
      setMessage('已删除选定的市场状态报告。');
    });
  }
  function download(format: 'json' | 'csv') {
    if (!report) return;
    operate('正在生成下载文件…', async (current) => {
      const { file } = await track(
        marketRegimeTask({ kind: 'export', record: report, format }),
      );
      if (!current()) return;
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `riverlab-market-regime-${report.reportHash.slice(0, 12)}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('下载文件已生成。');
    });
  }
  function cancel() {
    if (!cancelWorker.current) return;
    generation.current += 1;
    cancelWorker.current();
    cancelWorker.current = null;
    setCancellable(false);
    setBusy(false);
    setMessage('市场状态任务已取消。');
  }
  return {
    sources,
    records,
    report,
    saved,
    busy,
    cancellable,
    loadingRecords,
    message,
    error,
    run,
    open,
    restore,
    save,
    remove,
    download,
    cancel,
  };
}
