import { useEffect, useRef, useState } from 'react';
import type {
  RiskStudy,
  RiskSummary,
  RiskSettings,
  SourcePreview,
} from '../core/risk-analysis';
import { riskTask } from '../infrastructure/risk-worker';
import type { RiskRequest } from '../infrastructure/risk-worker';
import { RiskStore } from '../infrastructure/risk-store';
import { storageMessage } from '../infrastructure/dataset-store';
export function useRiskWorkbench() {
  const [preview, setPreview] = useState<SourcePreview | null>(null),
    [record, setRecord] = useState<RiskStudy | null>(null),
    [records, setRecords] = useState<RiskSummary[]>([]),
    [busy, setBusy] = useState(false),
    [canCancel, setCanCancel] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const task = useRef<ReturnType<typeof riskTask> | null>(null),
    generation = useRef({ value: 0 }),
    store = useRef(new RiskStore());
  useEffect(() => {
    let active = true;
    const lifetime = generation.current;
    store.current
      .list()
      .then((rows) => {
        if (active) setRecords(rows);
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
  async function perform(
    action: (
      request: (r: RiskRequest) => ReturnType<typeof riskTask>['promise'],
      current: () => boolean,
    ) => Promise<void>,
  ) {
    const token = ++generation.current.value;
    task.current?.cancel();
    task.current = null;
    setBusy(true);
    setCanCancel(false);
    setError('');
    setMessage('正在校验源实验或计算风险分布…');
    const current = () => token === generation.current.value;
    try {
      const request = async (r: RiskRequest) => {
        const next = riskTask(r, (n, total) => {
          if (current()) setMessage('模拟路径 ' + n + ' / ' + total);
        });
        task.current = next;
        setCanCancel(true);
        return next.promise;
      };
      await action(request, current);
    } catch (e) {
      if (current()) {
        setError(
          e instanceof DOMException
            ? storageMessage(e)
            : e instanceof Error
              ? e.message
              : '风险任务失败。',
        );
        setMessage('');
      }
    } finally {
      if (current()) {
        task.current = null;
        setBusy(false);
        setCanCancel(false);
      }
    }
  }
  function select(sourceId: string) {
    setPreview(null);
    setRecord(null);
    setSaved(false);
    if (!sourceId) {
      task.current?.cancel();
      generation.current.value++;
      setBusy(false);
      setCanCancel(false);
      setError('');
      setMessage('');
      return;
    }
    void perform(async (request, current) => {
      const r = await request({
        kind: 'inspect',
        sourceId,
        observedUtcMs: Date.now(),
      });
      if (current()) {
        setPreview(r.preview!);
        setMessage('源实验校验与重算一致；请确认成本和重采样假设。');
      }
    });
  }
  function run(settings: RiskSettings) {
    if (!preview || busy) return;
    setRecord(null);
    setSaved(false);
    void perform(async (request, current) => {
      const r = await request({
        kind: 'run',
        sourceId: preview.id,
        expectedHash: preview.payloadHash,
        settings,
        id: crypto.randomUUID(),
        name: '风险分析 · ' + preview.name.slice(0, 145),
        createdUtcMs: Date.now(),
        observedUtcMs: Date.now(),
      });
      if (current()) {
        setRecord(r.record!);
        setMessage('风险分析完成；结果仅内存，请明确保存或导出。');
      }
    });
  }
  function openValue(value: unknown, persisted = false) {
    return perform(async (request, current) => {
      const r = await request({
        kind: 'verify',
        record: value,
        observedUtcMs: Date.now(),
      });
      if (current()) {
        setRecord(r.record!);
        setPreview(null);
        setSaved(persisted);
        setMessage('风险报告校验与源重算/重采样一致；已重新打开。');
      }
    });
  }
  async function open(id: string) {
    if (busy) return;
    setError('');
    try {
      await openValue(await store.current.load(id), true);
    } catch (e) {
      setError(storageMessage(e));
    }
  }
  async function restore(file: File) {
    if (busy) return;
    setError('');
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error('风险JSON超过25MiB，阻止读取。');
      await openValue(JSON.parse(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON读取失败。');
    }
  }
  async function save() {
    if (!record || busy) return;
    await perform(async (_request, current) => {
      const next = {
        ...record,
        id: crypto.randomUUID(),
        createdUtcMs: Date.now(),
      };
      await store.current.save(next);
      if (current()) {
        setRecord(next);
        setRecords(await store.current.list());
        setSaved(true);
        setMessage('风险报告已保存（事务已完成）。请导出JSON备份。');
      }
    });
  }
  async function remove(id: string) {
    if (busy || !window.confirm('删除这个风险报告？源数据和回测实验不受影响。'))
      return;
    await perform(async (_request, current) => {
      await store.current.delete(id);
      if (current()) {
        setRecords(await store.current.list());
        if (record?.id === id) setSaved(false);
        setMessage('已删除保存的风险报告。');
      }
    });
  }
  function exportRecord(format: 'json' | 'csv') {
    if (!record || busy) return;
    void perform(async (request, current) => {
      const r = await request({
        kind: 'export',
        record,
        format,
        observedUtcMs: Date.now(),
      });
      if (!current()) return;
      const url = URL.createObjectURL(
          new Blob([r.text!], {
            type:
              format === 'json'
                ? 'application/json;charset=utf-8'
                : 'text/csv;charset=utf-8',
          }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download =
        'RiverLab-Risk-' + record.payloadHash.slice(0, 12) + '.' + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('风险报告已生成下载；请确认实际保存。');
    });
  }
  return {
    preview,
    record,
    records,
    busy,
    canCancel,
    saved,
    message,
    error,
    select,
    run,
    open,
    restore,
    save,
    remove,
    exportRecord,
    cancel: () => task.current?.cancel(),
  };
}
