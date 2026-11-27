import { SnapshotWriter } from '../../infrastructure/snapshot-format';
import { readSnapshotSource } from '../../infrastructure/snapshot-source';
import {
  SnapshotValidation,
  type SnapshotIssue,
} from '../../infrastructure/snapshot-validation';
import type { FromWorker, ToWorker } from './messages';

const scope = globalThis as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: (event: MessageEvent<ToWorker>) => void;
};
let ack: (() => void) | undefined;
const sink = {
  write(bytes: Uint8Array<ArrayBuffer>) {
    return new Promise<void>((resolve) => {
      // The encoder may hash or reuse its own buffer after this write.
      const chunk = bytes.slice();
      ack = resolve;
      scope.postMessage({ type: 'chunk', bytes: chunk }, [chunk.buffer]);
    });
  },
};

async function exportSnapshot() {
  let writer: SnapshotWriter | undefined;
  let validation: SnapshotValidation | undefined;
  let lastStore = '';
  let lastUpdate = 0;
  function requireValid(issues: SnapshotIssue[]) {
    if (!issues.length) return;
    const first = issues
      .slice(0, 5)
      .map(
        (issue) =>
          `${issue.kind} / ${issue.role} / ${String(issue.key).slice(0, 160)}（${issue.code}）：${issue.message}`,
      );
    if (issues.length > first.length)
      first.push(`另有 ${issues.length - first.length} 项校验错误。`);
    throw new Error(first.join('\n'));
  }
  const report = await readSnapshotSource({
    // The page terminates this dedicated worker on cancel, including during a synchronous replay.
    signal: new AbortController().signal,
    async onLayout(layout) {
      scope.postMessage({ type: 'layout', layout });
      validation = new SnapshotValidation({
        observedUtcMs: layout.barrierUtcMs,
      });
      writer = await SnapshotWriter.create(sink, layout);
    },
    async onRow(row, view) {
      if (!writer || !validation)
        throw new Error('读取记录前缺少已确认的布局。');
      requireValid(
        await validation.accept(
          row.kind,
          row.store === 'summaries' ? 'summary' : 'body',
          row.primaryKey,
          row.value,
          view.getCapturedDataset.bind(view),
        ),
      );
      await writer.writeRow(row);
    },
    onProgress(progress) {
      const key = progress.database + '/' + progress.store;
      const now = performance.now();
      if (
        lastStore !== key ||
        progress.read === progress.total ||
        now - lastUpdate > 250
      ) {
        lastStore = key;
        lastUpdate = now;
        scope.postMessage({ type: 'progress', progress });
      }
    },
  });
  if (!validation || !writer) throw new Error('缺少已确认的快照布局。');
  for (const db of report.databases) requireValid(validation.finish(db.kind));
  const receipt = await writer.finish(report);
  scope.postMessage({ type: 'complete', receipt, report });
}

let running = false;
scope.onmessage = ({ data }) => {
  if (data.type === 'ack') {
    ack?.();
    ack = undefined;
  } else if (!running && data.type === 'start') {
    running = true;
    void exportSnapshot().catch((error: unknown) => {
      const missing =
        error && typeof error === 'object' && 'missingDatabases' in error
          ? error.missingDatabases
          : undefined;
      scope.postMessage({
        type: 'failed',
        message:
          error instanceof Error ? error.message : '导出 Worker 未完成快照。',
        missingDatabases: Array.isArray(missing)
          ? missing.filter((name): name is string => typeof name === 'string')
          : undefined,
      });
    });
  }
};
