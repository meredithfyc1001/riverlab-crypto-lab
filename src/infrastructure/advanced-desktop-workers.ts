// WebView2 can open local module Workers from the document. The coordinator
// transfers one port per budgeted candidate lane; the window owns their lifetime.
export function desktopCandidateWorkers(
  maxWorkers: number,
  abort: (error: Error) => void,
) {
  const { port1, port2 } = new MessageChannel();
  const workers: Worker[] = [];
  port1.onmessageerror = () =>
    abort(new Error('桌面候选调度指令无法反序列化。'));
  port1.onmessage = ({ data, ports }) => {
    try {
      if (
        data !== 'create-candidate' ||
        ports.length !== 1 ||
        workers.length >= maxWorkers
      )
        throw new Error('桌面候选 Worker 分配超出预算或端口无效。');
      const worker = new Worker(
        new URL('./advanced-candidate.worker.ts', import.meta.url),
        { type: 'module', name: 'riverlab-advanced-candidate' },
      );
      workers.push(worker);
      worker.onerror = (event) =>
        abort(
          new Error(
            '桌面候选 Worker 脚本加载或执行失败：' +
              (event.message || '运行时未提供原因'),
          ),
        );
      worker.onmessageerror = () =>
        abort(new Error('桌面候选 Worker 无法接收计算端口。'));
      worker.postMessage('attach-port', [ports[0]]);
    } catch (error) {
      for (const port of ports) port.close();
      abort(
        error instanceof Error ? error : new Error('无法启动桌面候选 Worker。'),
      );
    }
  };
  return {
    control: port2,
    close() {
      port1.onmessage = port1.onmessageerror = null;
      port1.close();
      port2.close();
      for (const worker of workers) {
        worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
    },
  };
}
