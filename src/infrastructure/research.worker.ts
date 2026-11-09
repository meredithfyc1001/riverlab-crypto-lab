import { runResearch, verifyResearch } from '../core/research';
import type { ResearchRequest, ResearchResponse } from './research-worker';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ResearchRequest>) => void) | null;
  postMessage: (value: ResearchResponse) => void;
};
scope.onmessage = ({ data }) => {
  const start = performance.now();
  try {
    const report = data.kind === 'verify' ? verifyResearch(data.report) : runResearch(data.input, (completed, total) => scope.postMessage({ kind: 'progress', completed, total }));
    scope.postMessage({ kind: 'success', report, elapsedMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : '未知研究错误；未生成报告。' });
  }
};
