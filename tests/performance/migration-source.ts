import { analyzeCsv } from '../../src/core/data';
import { makeDataset, summarizeDataset } from '../../src/core/data/dataset';
import {
  runExperiment,
  sealExperiment,
  summarizeExperiment,
} from '../../src/core/experiments';
import { layouts } from '../../src/infrastructure/database-layouts';
import { exportSnapshot } from '../../src/features/snapshot/export-client';
import { options } from '../fixtures/dataset';

const start = 1735689600000;
const mib = 1024 * 1024;

async function savePair(
  kind: 'dataset' | 'experiment',
  body: unknown,
  summary: unknown,
) {
  const [name, store] = layouts[kind];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.transaction!.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([store, 'summaries'], 'readwrite');
      tx.objectStore(store).add(body);
      tx.objectStore('summaries').add(summary);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function syntheticMarket(index: number, bars: number) {
  const rows = Array.from({ length: bars }, (_, bar) => {
    const price = 100 + index + Math.abs((bar % 12) - 6);
    return [start + bar * 60000, price, price + 1, price - 1, price, 1].join(
      ',',
    );
  });
  const csv = 'timestamp,open,high,low,close,volume\n' + rows.join('\n');
  const bytes = new TextEncoder().encode(csv);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return makeDataset(
    {
      id: 'synthetic-capacity-dataset-' + index,
      name: '合成容量样本 ' + index,
      symbol: 'SYNTHETIC/USDT',
      createdUtcMs: start,
      source: { kind: 'synthetic', label: '合成数据', note: '合'.repeat(3000) },
      file: {
        name: 'synthetic-' + index + '.csv',
        bytes: bytes.length,
        sha256: Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join(
          '',
        ),
        parserVersion: 'csv-v1',
      },
      parsing: options,
      warningsAcknowledged: true,
    },
    analyzeCsv(csv, options),
  );
}

export async function addScenario(scenario: 'large-report' | 'near-capacity') {
  const bars = scenario === 'large-report' ? 10000 : 50000;
  let records = 0,
    datasetBytes = 0,
    reportBytes = 0;
  const bytes = (v: unknown) =>
    new TextEncoder().encode(JSON.stringify(v)).length;
  do {
    const dataset = await syntheticMarket(records, bars);
    await savePair('dataset', dataset, summarizeDataset(dataset));
    datasetBytes += bytes(dataset);
    if (scenario === 'large-report') {
      const end = start + bars * 60000;
      const computationStart = performance.now();
      const payload = runExperiment({
        dataset,
        strategy: { kind: 'ma', fastPeriod: 2, slowPeriod: 4 },
        completedThroughUtcMs: end,
      });
      const experiment = sealExperiment(payload, {
        id: 'synthetic-large-experiment',
        name: '合成完整回测报告',
        createdUtcMs: end,
        elapsedMs: performance.now() - computationStart,
      });
      await savePair('experiment', experiment, summarizeExperiment(experiment));
      reportBytes = bytes(experiment);
    }
    records++;
  } while (scenario === 'near-capacity' && datasetBytes < 248 * mib);
  return {
    source: 'synthetic',
    barsPerAdditionalDataset: bars,
    extraDatasets: records,
    datasetProjectionBytes: datasetBytes,
    reportProjectionBytes: reportBytes,
    sourceNoteCharacters: 3000,
  };
}

export async function exportToPrivateFile() {
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle('synthetic.riverlab-migration', {
    create: true,
  });
  const startMs = performance.now();
  const result = await exportSnapshot(
    file,
    new AbortController().signal,
    () => {},
  );
  const elapsedMs = performance.now() - startMs;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await file.getFile());
  link.download = file.name;
  link.click();
  return {
    receipt: result.receipt,
    sourceReport: result.report,
    exportAndReadbackMs: elapsedMs,
  };
}
