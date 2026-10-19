import type { CsvJob, CsvResponse, CsvResult } from './worker-types';

export function startCsvJob(request: CsvJob): {
  promise: Promise<CsvResult>;
  cancel: () => void;
} {
  let cancel = () => {};
  const promise = new Promise<CsvResult>((resolve, reject) => {
    const worker = new Worker(new URL('./csv.worker.ts', import.meta.url), {
      type: 'module',
    });
    let done = false;
    const timeout = setTimeout(
      () => finish(new Error('CSV 处理超过 45 秒，已停止；请拆分文件后重试。')),
      45_000,
    );
    function finish(error?: Error, result?: CsvResult) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else if (result) resolve(result);
    }
    cancel = () => finish(new DOMException('已取消 CSV 处理。', 'AbortError'));
    worker.onmessage = (event: MessageEvent<CsvResponse>) =>
      event.data.ok
        ? finish(undefined, event.data.result)
        : finish(new Error(event.data.error));
    worker.onerror = () =>
      finish(
        new Error(
          'CSV Worker 无法运行；请使用本机 HTTP 下的新版 Edge/Chrome，并检查浏览器策略。',
        ),
      );
    worker.onmessageerror = () =>
      finish(new Error('CSV Worker 返回内容无法读取。'));
    try {
      worker.postMessage(request);
    } catch {
      finish(new Error('无法把 CSV 文件交给 Worker 处理。'));
    }
  });
  return { promise, cancel: () => cancel() };
}
