import { useState } from 'react';
import type { ExperimentSummary } from '../../core/experiments';
export function ExperimentCenter({
  experiments,
  busy,
  onOpen,
  onDelete,
}: {
  experiments: ExperimentSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [pending, setPending] = useState('');
  return (
    <section className="panel experiment-center">
      <h2>已保存回测实验</h2>
      <p>
        仅明确保存的实验会在刷新后出现在此列表，需选择打开。打开时校验并重算；未保存结果和配置刷新后丢失。浏览器存储并非永久可靠，请另行下载
        JSON 备份。不同浏览器、用户配置或本机端口的存储相互隔离。
      </p>
      {!experiments.length && <p>尚无已保存实验。</p>}
      {experiments.map((e) => (
        <div key={e.id} className="experiment-item">
          <strong>{e.name}</strong>
          <p>
            {e.symbol} · {e.strategy} · {new Date(e.createdUtcMs).toISOString()}{' '}
            UTC
          </p>
          <code>{e.runHash}</code>
          <div className="sample-actions">
            <button disabled={busy} onClick={() => onOpen(e.id)}>
              打开实验 {e.name}
            </button>
            <button disabled={busy} onClick={() => setPending(e.id)}>
              删除实验 {e.name}
            </button>
          </div>
          {pending === e.id && (
            <div>
              <p>确认删除这个实验？请先下载需要保留的报告。</p>
              <button
                disabled={busy}
                onClick={() => {
                  onDelete(e.id);
                  setPending('');
                }}
              >
                确认删除实验
              </button>
              <button onClick={() => setPending('')}>取消删除实验</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
