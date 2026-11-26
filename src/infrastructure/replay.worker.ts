import { ReplaySession, assertReplayCheckpoint } from '../core/replay';
import type { Dataset } from '../core/data/dataset';
import { assertDataset } from '../core/data/dataset';
import { DatasetStore } from './dataset-store';
import { readWorkerSource } from './worker-source';
import type { ReplayRequest, ReplayResponse } from './replay-worker';
const scope = globalThis as unknown as {
  onmessage:
    | ((event: MessageEvent<{ id: number; request: ReplayRequest }>) => void)
    | null;
  postMessage: (response: ReplayResponse) => void;
};
let session: ReplaySession | null = null;
let running = false;
function completed(dataset: unknown, now: number): asserts dataset is Dataset {
  assertDataset(dataset);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > 4_102_444_800_000 ||
    dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs! > now
  )
    throw new Error('数据包含未收盘K线，阻止回放。');
}
scope.onmessage = async ({ data: { id, request: r }, ports }) => {
  if (running) {
    scope.postMessage({
      id,
      ok: false,
      message: '上一根尚未处理完毕，请稍候。',
    });
    return;
  }
  running = true;
  try {
    if (r.kind === 'start') {
      if (r.confirmed !== true) throw new Error('请确认已收盘数据和全部警告。');
      const dataset = ports?.[0]
        ? await readWorkerSource(ports[0], r.datasetId)
        : await new DatasetStore().load(r.datasetId);
      completed(dataset, r.observedUtcMs);
      const next = new ReplaySession(dataset, r.config, r.risk);
      next.advance();
      session = next;
      scope.postMessage({ id, ok: true, view: next.view() });
    } else if (r.kind === 'restore') {
      assertReplayCheckpoint(r.record);
      const dataset = ports?.[0]
        ? await readWorkerSource(ports[0], r.record.payload.datasetId)
        : await new DatasetStore().load(r.record.payload.datasetId);
      completed(dataset, r.observedUtcMs);
      if (r.record.createdUtcMs > r.observedUtcMs)
        throw new Error('保存时间晚于当前时间，不能恢复。');
      const next = ReplaySession.restore(dataset, r.record);
      session = next;
      scope.postMessage({ id, ok: true, view: next.view(), record: r.record });
    } else {
      if (!session) throw new Error('请先开始回放或打开保存状态。');
      const from = session.cursor;
      if (r.kind === 'advance') session.advance(r.count);
      else if (r.kind === 'trade') session.trade(r.action, r.quantity);
      else if (r.kind === 'note') session.note(r.text);
      else if (r.kind === 'csv') {
        scope.postMessage({ id, ok: true, text: session.csv() });
        return;
      } else if (r.kind === 'checkpoint') {
        scope.postMessage({
          id,
          ok: true,
          record: session.checkpoint({
            id: r.id,
            name: r.name,
            createdUtcMs: r.createdUtcMs,
          }),
        });
        return;
      }
      scope.postMessage({ id, ok: true, view: session.view(from) });
    }
  } catch (error) {
    const fatal = r.kind === 'advance';
    if (fatal) session = null;
    scope.postMessage({
      id,
      ok: false,
      fatal,
      message:
        (error instanceof Error ? error.message : '回放失败；未自动修复。') +
        (fatal ? ' 本次推进失败，运行已停止，请恢复保存状态。' : ''),
    });
  } finally {
    running = false;
  }
};
