import { useEffect, useRef, useState } from 'react';
import type { Dataset } from '../core/data/dataset';
import type {
  Experiment,
  ExperimentSummary,
  WorkbenchInput,
} from '../core/experiments';
import { DatasetStore, storageMessage } from '../infrastructure/dataset-store';
import { ExperimentStore } from '../infrastructure/experiment-store';
import { workerTask } from '../infrastructure/backtest-worker';
import type { WorkerRequest } from '../infrastructure/backtest-worker';

export function useBacktestWorkbench() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [record, setRecord] = useState<Experiment | null>(null);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const store = useRef(new ExperimentStore());
  const task = useRef<ReturnType<typeof workerTask> | null>(null);
  const generation = useRef({ value: 0 });
  useEffect(() => {
    let active = true;
    const lifetime = generation.current;
    store.current
      .list()
      .then((list) => {
        if (active) setExperiments(list);
      })
      .catch((e) => {
        if (active) setError(storageMessage(e));
      });
    return () => {
      active = false;
      lifetime.value++;
      task.current?.cancel();
    };
  }, []);
  async function perform(action: (isCurrent: () => boolean) => Promise<void>) {
    const token = ++generation.current.value;
    task.current?.cancel();
    task.current = null;
    setBusy(true);
    setCanCancel(false);
    setError('');
    setMessage('正在处理本地任务…');
    const current = () => token === generation.current.value;
    try {
      await action(current);
    } catch (e) {
      if (current())
        setError(
          e instanceof Error && /无法完成|Worker|实验记录损坏/.test(e.message)
            ? e.message
            : storageMessage(e),
        );
    } finally {
      if (current()) {
        setBusy(false);
        setCanCancel(false);
        task.current = null;
      }
    }
  }
  async function compute(request: WorkerRequest) {
    const next = workerTask(request);
    task.current = next;
    setCanCancel(true);
    return next.promise;
  }
  function selectDataset(id: string) {
    setDataset(null);
    if (id)
      void perform(async (current) => {
        const next = await new DatasetStore().load(id);
        if (current()) {
          setDataset(next);
          setMessage('已读取并校验保存的数据集，请确认收盘状态。');
        }
      });
  }
  function run(input: WorkbenchInput) {
    if (input.completedThroughUtcMs > Date.now()) {
      setError('数据包含尚未到收盘时间的K线，阻止运行。');
      return;
    }
    setRecord(null);
    setSaved(false);
    void perform(async (current) => {
      setMessage('正在 Worker 中执行策略、成交、账本和统计…');
      const response = await compute({
        kind: 'run',
        input,
        id: crypto.randomUUID(),
        name: `${input.dataset.symbol} · ${input.strategy.kind}`,
        createdUtcMs: Date.now(),
      });
      if (current()) {
        setRecord(response.record);
        setMessage('回测成功；结果尚未保存，刷新会丢失。');
      }
    });
  }
  function save() {
    if (!record) return;
    void perform(async (current) => {
      await store.current.save(record);
      const list = await store.current.list();
      if (current()) {
        setExperiments(list);
        setSaved(true);
        setMessage('实验已保存（事务已完成）。请另行导出JSON备份。');
      }
    });
  }
  function open(id: string) {
    setRecord(null);
    setSaved(false);
    void perform(async (current) => {
      const raw = await store.current.load(id);
      const next = await compute({ kind: 'verify', record: raw });
      if (current()) {
        setRecord(next.record);
        setSaved(true);
        setMessage('实验校验与重算一致，已重新打开结果。');
      }
    });
  }
  function remove(id: string) {
    void perform(async (current) => {
      await store.current.delete(id);
      if (current()) {
        setExperiments((list) => list.filter((e) => e.id !== id));
        if (record?.id === id) {
          setRecord(null);
          setSaved(false);
        }
        setMessage('实验已删除，原始数据集未改动。');
      }
    });
  }
  function exportRecord(format: 'json' | 'csv') {
    if (!record) return;
    void perform(async (current) => {
      const response = await compute({ kind: 'export', record, format });
      if (!current()) return;
      const url = URL.createObjectURL(
        new Blob([response.text!], {
          type:
            format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `riverlab-experiment-${record.id}.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已生成下载，请确认浏览器实际保存了文件。');
    });
  }
  function reproduce() {
    if (!record) return;
    const m = record.payload.result.manifest;
    run({
      dataset: record.payload.dataset,
      completedThroughUtcMs: m.completedThroughUtcMs,
      strategy: m.strategy!.config,
      config: m.config,
      risk: m.risk,
    });
  }
  function cancel() {
    generation.current.value++;
    task.current?.cancel();
    task.current = null;
    setBusy(false);
    setCanCancel(false);
    setMessage('已取消任务，未生成新结果。');
  }
  return {
    canCancel,
    dataset,
    record,
    experiments,
    busy,
    message,
    error,
    saved,
    selectDataset,
    run,
    save,
    open,
    remove,
    exportRecord,
    reproduce,
    cancel,
  };
}
