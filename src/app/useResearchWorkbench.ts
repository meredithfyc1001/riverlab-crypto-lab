import { useEffect, useRef, useState } from 'react';
import type { ResearchInput, ResearchReport } from '../core/research';
import { researchCsv, researchJson } from '../core/research';
import { researchTask } from '../infrastructure/research-worker';
import type { ResearchRequest } from '../infrastructure/research-worker';
export function useResearchWorkbench() {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const task = useRef<ReturnType<typeof researchTask> | null>(null);
  useEffect(() => () => task.current?.cancel(), []);
  async function execute(request: ResearchRequest) {
    if (task.current) return;
    setBusy(true);
    setError('');
    setReport(null);
    setMessage('研究Worker运行中；候选已锁定。');
    try {
      const next = researchTask(request, (completed, total) =>
        setMessage('研究运行中：' + completed + ' / ' + total + ' 次子运行。'),
      );
      task.current = next;
      const result = await next.promise;
      setReport(result.report);
      setMessage(
        '研究完成；' +
          result.report.rows.length +
          ' 次子运行，Worker耗时 ' +
          result.elapsedMs.toFixed(0) +
          ' ms。结果仅在内存，请导出JSON备份。',
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法完成研究。');
      setMessage('');
    } finally {
      task.current = null;
      setBusy(false);
    }
  }
  function run(input: ResearchInput) {
    void execute({ kind: 'run', input });
  }
  async function restore(file: File) {
    if (busy) return;
    setError('');
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error('研究JSON超过25MiB，阻止读取。');
      const value: unknown = JSON.parse(await file.text());
      await execute({ kind: 'verify', report: value });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '报告读取失败。');
    }
  }
  function exportReport(format: 'json' | 'csv') {
    if (!report || busy) return;
    const blob = new Blob(
      [format === 'json' ? researchJson(report) : researchCsv(report)],
      {
        type:
          format === 'json'
            ? 'application/json;charset=utf-8'
            : 'text/csv;charset=utf-8',
      },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      'RiverLab-Research-' + report.payloadHash.slice(0, 12) + '.' + format;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    report,
    busy,
    message,
    error,
    run,
    restore,
    exportReport,
    cancel: () => task.current?.cancel(),
  };
}
