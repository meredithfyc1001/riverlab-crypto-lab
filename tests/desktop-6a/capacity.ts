// Called only after the installed host has established a new, disposable QA
// profile. Space padding yields a legal JSON document of exactly 256 MiB while
// keeping domain complexity and the original research hashes independently known.
import {
  runExperiment,
  sealExperiment,
  summarizeExperiment,
} from '../../src/core/experiments';
import { desktopRepository } from '../../src/infrastructure/desktop-repository';
import { workerTask } from '../../src/infrastructure/backtest-worker';
import { fixtureDataset } from '../fixtures/dataset';

const mib = 1024 * 1024;
const bytes = 256 * mib;
const encoder = new TextEncoder();

function paddedFile(json: string) {
  const header = encoder.encode(json);
  const space = new Blob([new Uint8Array(mib).fill(32)]);
  const rest = bytes - header.byteLength;
  return new Blob([
    header,
    ...Array<Blob>(Math.floor(rest / mib)).fill(space),
    space.slice(0, rest % mib),
  ]);
}

export async function verifyDesktopCapacity() {
  const startedUtcMs = Date.now();
  const heapSamples: {
    stage: string;
    utcMs: number;
    usedJSHeapBytes: number | null;
  }[] = [];
  const sample = (stage: string) => {
    const heap = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    heapSamples.push({
      stage,
      utcMs: Date.now(),
      usedJSHeapBytes: heap?.usedJSHeapSize ?? null,
    });
  };
  sample('start');
  const dataset = fixtureDataset();
  const payload = runExperiment({
    dataset,
    strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
    completedThroughUtcMs:
      dataset.candles.at(-1)!.timestampUtcMs + dataset.quality.intervalMs!,
  });
  const record = sealExperiment(payload, {
    id: crypto.randomUUID(),
    name: '容量边界 合成实验',
    createdUtcMs: dataset.createdUtcMs,
    elapsedMs: 1,
  });
  const cancelled = { ...record, id: crypto.randomUUID() };
  const file = paddedFile(
    JSON.stringify({ format: 'riverlab-experiment', ...record }),
  );
  if (file.size !== bytes) throw new Error('文件字节数与边界不符。');
  const imported = await workerTask({ kind: 'import', file }).promise;
  if (
    !('record' in imported) ||
    imported.record.payloadHash !== record.payloadHash
  )
    throw new Error('最大合法文件的 Worker 校验与重算不符。');
  sample('file-verified');
  let cancelledAfterBytes = 0;
  try {
    // This buffer contains the original domain record in its ordinary SQLite
    // representation (the exchange file above has a separate format envelope).
    const padded = new Uint8Array(bytes).fill(32);
    padded.set(encoder.encode(JSON.stringify(cancelled)));
    const controller = new AbortController();
    try {
      await desktopRepository.saveBytes(
        'experiment',
        cancelled.id,
        padded,
        JSON.stringify(summarizeExperiment(cancelled)),
        controller.signal,
        (accepted) => {
          if (accepted >= 8 * mib) {
            cancelledAfterBytes = accepted;
            controller.abort();
          }
        },
      );
      throw new Error('中止的大记录意外提交。');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        throw error;
    }
    if (
      cancelledAfterBytes !== 8 * mib ||
      (await desktopRepository.getBytes('experiment', cancelled.id)) !==
        undefined
    )
      throw new Error('部分上传产生了实验记录。');
    sample('upload-cancelled');
    const normalSave = await workerTask({ kind: 'save', record: cancelled })
      .promise;
    if (!('saved' in normalSave)) throw new Error('中止后无法按同一 ID 保存。');
    await desktopRepository.remove('experiment', cancelled.id);

    // Both UUIDs have the same encoded length; the space suffix is unchanged.
    padded.set(encoder.encode(JSON.stringify(record)));
    await desktopRepository.saveBytes(
      'experiment',
      record.id,
      padded,
      JSON.stringify(summarizeExperiment(record)),
      undefined,
      (accepted) => {
        if (accepted % (64 * mib) === 0)
          sample('upload-' + accepted / mib + '-MiB');
      },
    );
    sample('committed');
    const opened = await workerTask({ kind: 'open', id: record.id }).promise;
    if (
      !('record' in opened) ||
      opened.record.payloadHash !== imported.record.payloadHash ||
      opened.record.payload.result.manifest.runHash !==
        record.payload.result.manifest.runHash
    )
      throw new Error('最大 SQLite 正文打开后的研究 Hash 与文件导入不符。');
    sample('reopened');
    return {
      bytes,
      startedUtcMs,
      endedUtcMs: Date.now(),
      heapSamples,
      cancelledAfterBytes,
      runHash: record.payload.result.manifest.runHash,
      payloadHash: record.payloadHash,
    };
  } finally {
    await desktopRepository.remove('experiment', record.id);
    await desktopRepository.remove('experiment', cancelled.id);
  }
}
