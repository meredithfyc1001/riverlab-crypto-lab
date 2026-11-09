import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle } from '../core/data';
import type { ReplaySummary, ReplayView } from '../core/replay';
import { ReplayStore } from '../infrastructure/replay-store';
import { storageMessage } from '../infrastructure/dataset-store';
import { replayWorker } from '../infrastructure/replay-worker';
import type { ReplayRequest } from '../infrastructure/replay-worker';

export interface ReplayModel {
  view: ReplayView;
  candles: Candle[];
  curve: ReplayView['curve'];
}
export function useReplayWorkbench() {
  const [model, setModel] = useState<ReplayModel | null>(null);
  const [records, setRecords] = useState<ReplaySummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savedHash, setSavedHash] = useState('');
  const client = useRef<ReturnType<typeof replayWorker> | null>(null);
  const store = useRef(new ReplayStore());
  const guard = useRef({ busy: false, generation: 0 });
  const currentModel = useRef<ReplayModel | null>(null);
  const pause = useCallback(() => setPlaying(false), []);
  useEffect(() => {
    let active = true;
    const lifetime = guard.current;
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
      lifetime.generation++;
      client.current?.close();
    };
  }, []);
  const perform = useCallback(
    async (
      action: (
        request: (
          r: ReplayRequest,
        ) => ReturnType<ReturnType<typeof replayWorker>['request']>,
      ) => Promise<void>,
      reset = false,
    ) => {
      if (guard.current.busy) return;
      guard.current.busy = true;
      const token = ++guard.current.generation;
      setBusy(true);
      setError('');
      setMessage('正在处理回放任务…');
      const current = () => token === guard.current.generation;
      try {
        if (reset && !client.current) client.current = replayWorker();
        if (!client.current) throw new Error('请先开始回放或打开保存状态。');
        const request = async (r: ReplayRequest) => {
          const result = await client.current!.request(r);
          if (!current()) throw new Error('任务已结束。');
          if (result.view) {
            const view = result.view,
              previous = currentModel.current;
            if (
              view.fromCursor !== 0 &&
              view.fromCursor !== previous?.view.cursor
            )
              throw new Error('回放前缀同步失败，请重新打开保存状态。');
            const next = {
              view,
              candles:
                view.fromCursor === 0
                  ? view.candles
                  : view.candles.length
                    ? [...previous!.candles, ...view.candles]
                    : previous!.candles,
              curve:
                view.fromCursor === 0
                  ? view.curve
                  : view.curve.length
                    ? [...previous!.curve, ...view.curve]
                    : previous!.curve,
            };
            currentModel.current = next;
            setModel(next);
          }
          return result;
        };
        await action(request);
      } catch (failure) {
        if (current()) {
          setPlaying(false);
          setMessage('');
          setError(
            failure instanceof DOMException
              ? storageMessage(failure)
              : failure instanceof Error
                ? failure.message
                : storageMessage(failure),
          );
          if (
            failure instanceof Error &&
            'fatal' in failure &&
            failure.fatal === true
          ) {
            currentModel.current = null;
            setModel(null);
            client.current?.close();
            client.current = null;
          }
        }
      } finally {
        if (current()) {
          guard.current.busy = false;
          setBusy(false);
        }
      }
    },
    [],
  );
  const advance = useCallback(
    (count = 1) => {
      void perform(async (request) => {
        const r = await request({ kind: 'advance', count });
        setMessage(
          r.view!.cursor === r.view!.total
            ? '回放结束；未强制平仓。'
            : '已推进至第 ' + r.view!.cursor + ' 根收盘。',
        );
      });
    },
    [perform],
  );
  useEffect(() => {
    if (!playing || busy || !model || model.view.cursor === model.view.total)
      return;
    const timer = setTimeout(() => advance(), speed);
    return () => clearTimeout(timer);
  }, [playing, busy, model, speed, advance]);
  function start(request: Extract<ReplayRequest, { kind: 'start' }>) {
    pause();
    void perform(async (send) => {
      await send(request);
      setSavedHash('');
      setMessage('已开始回放；仅揭示首根收盘。');
    }, true);
  }
  function trade(action: 'buy' | 'sell', quantity: string) {
    pause();
    void perform(async (request) => {
      await request({ kind: 'trade', action, quantity });
      setMessage('手工决策已排队，下一根开盘按原成本与保护规则执行。');
    });
  }
  function note(text: string) {
    pause();
    void perform(async (request) => {
      await request({ kind: 'note', text });
      setMessage('日记已加入当前回放；请保存状态。');
    });
  }
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function checkpoint(name: string, exportOnly = false) {
    pause();
    void perform(async (request) => {
      const response = await request({
        kind: 'checkpoint',
        id: crypto.randomUUID(),
        name,
        createdUtcMs: Date.now(),
      });
      const record = response.record!;
      if (exportOnly) {
        download(
          JSON.stringify(record, null, 2),
          'RiverLab-Replay-' + record.id + '.json',
          'application/json;charset=utf-8',
        );
        setMessage('回放JSON已生成下载；不含行情，恢复仍需原保存数据集。');
      } else {
        await store.current.save(record);
        setRecords(await store.current.list());
        setSavedHash(record.payload.stateHash);
        setMessage('回放状态已保存（事务已完成）。请另行导出JSON备份。');
      }
    });
  }
  async function open(record: unknown, persisted = false) {
    pause();
    await perform(async (request) => {
      const result = await request({
        kind: 'restore',
        record,
        observedUtcMs: Date.now(),
      });
      setSavedHash(persisted ? result.record!.payload.stateHash : '');
      setMessage('回放状态校验与重算一致；保持暂停，下一步从原游标继续。');
    }, true);
  }
  async function openSaved(id: string) {
    if (guard.current.busy) return;
    pause();
    setError('');
    try {
      await open(await store.current.load(id), true);
    } catch (e) {
      setError(storageMessage(e));
    }
  }
  async function restore(file: File) {
    if (guard.current.busy) return;
    pause();
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('回放状态JSON超过10MiB，阻止读取。');
      await open(JSON.parse(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON读取失败。');
    }
  }
  async function remove(id: string) {
    pause();
    if (guard.current.busy) return;
    if (!window.confirm('删除这个保存的回放快照？当前内存与原数据集不受影响。'))
      return;
    setBusy(true);
    guard.current.busy = true;
    setError('');
    try {
      await store.current.delete(id);
      setRecords(await store.current.list());
      setMessage('已删除保存的回放快照。');
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      guard.current.busy = false;
      setBusy(false);
    }
  }
  function csv() {
    pause();
    void perform(async (request) => {
      const result = await request({ kind: 'csv' });
      download(
        result.text!,
        'RiverLab-Replay-Trades.csv',
        'text/csv;charset=utf-8',
      );
      setMessage('已导出已播放成交与日记CSV。');
    });
  }
  function end() {
    pause();
    if (!window.confirm('结束当前内存回放？请先保存或导出需要保留的进度。'))
      return;
    guard.current.generation++;
    guard.current.busy = false;
    client.current?.close();
    client.current = null;
    currentModel.current = null;
    setModel(null);
    setBusy(false);
    setSavedHash('');
    setMessage('当前回放已结束，保存快照和原数据集保留。');
    setError('');
  }
  return {
    model,
    records,
    busy,
    playing: playing && !!model && model.view.cursor < model.view.total,
    speed,
    setSpeed,
    message,
    error,
    saved: !!model && savedHash === model.view.stateHash,
    pause,
    toggle: () => setPlaying((p) => !p),
    start,
    advance,
    trade,
    note,
    checkpoint,
    openSaved,
    restore,
    remove,
    csv,
    end,
  };
}
