import { chartColors } from '../../src/shared/chart-colors';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

function committed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function probeDisposableIdb() {
  // A unique database per invocation, including reruns in a shared browser origin.
  const name = 'riverlab-6a-synthetic-probe-' + crypto.randomUUID();
  let db: IDBDatabase | undefined;
  try {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('sample');
    db = await request(opening);
    const tx = db.transaction('sample', 'readwrite');
    const sample = '人工合成 · 桌面验证';
    tx.objectStore('sample').add(sample, 1);
    await committed(tx);
    db.close();
    db = await request(indexedDB.open(name));
    const read = db.transaction('sample');
    const [value] = await Promise.all([
      request(read.objectStore('sample').get(1)),
      committed(read),
    ]);
    if (value !== sample) throw new Error('合成 IndexedDB 重开后数据不一致');
  } finally {
    db?.close();
    await request(indexedDB.deleteDatabase(name));
  }
  return true;
}

let chart: IChartApi | undefined;

export async function probeChart() {
  const container = document.querySelector<HTMLDivElement>('#chart')!;
  chart?.remove();
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  const palette = chartColors[scheme === 'dark' ? 'dark' : 'light'];
  chart = createChart(container, {
    layout: {
      background: { type: ColorType.Solid, color: palette.panel },
      textColor: palette.text,
    },
    width: Math.min(container.clientWidth, 640),
    height: 220,
    localization: { locale: 'zh-CN' },
  });
  const series = chart.addSeries(CandlestickSeries, {
    upColor: palette.up,
    downColor: palette.down,
    wickUpColor: palette.up,
    wickDownColor: palette.down,
    borderVisible: false,
  });
  const bars = [101, 108, 104, 99, 105, 109, 102].map((close, index) => ({
    time: (1735689600 + index * 86400) as UTCTimestamp,
    open: 103,
    high: Math.max(103, close) + 2,
    low: Math.min(103, close) - 2,
    close,
  }));
  series.setData(bars);
  chart.timeScale().fitContent();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const canvas = chart.takeScreenshot();
  const pixels = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const upRgb = parseInt(palette.up.slice(1), 16);
  const downRgb = parseInt(palette.down.slice(1), 16);
  let upPixels = 0;
  let downPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    if (rgb === upRgb) upPixels++;
    if (rgb === downRgb) downPixels++;
  }
  if (!upPixels || !downPixels)
    throw new Error('图表未绘出两种方向的合成 K 线');
  if (
    document.documentElement.lang !== 'zh-CN' ||
    !document.title.includes('桌面验证')
  )
    throw new Error('中文页面文本异常');
  return {
    bars: bars.length,
    width: canvas.width,
    height: canvas.height,
    upPixels,
    downPixels,
  };
}

export async function blobSha256(blob: Blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
