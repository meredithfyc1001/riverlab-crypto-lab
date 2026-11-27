import { isDesktopRepository } from '../../infrastructure/desktop-repository';
import { useState } from 'react';
import type { Experiment, ExperimentSummary } from '../../core/experiments';
export function ExperimentCenter({
  experiments,
  busy,
  preview,
  onImport,
  onConfirm,
  onDiscard,
  onOpen,
  onDelete,
}: {
  experiments: ExperimentSummary[];
  busy: boolean;
  preview: Experiment | null;
  onImport: (file: File) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [pending, setPending] = useState('');
  return (
    <section className="panel experiment-center">
      <h2>已保存回测实验</h2>
      <p>
        仅明确保存的实验会在刷新后出现在此列表，需选择打开。打开时校验并重算；未保存结果和配置刷新后丢失。
        {isDesktopRepository()
          ? '桌面实验保存在当前用户的 SQLite 数据库。请另行导出 JSON 备份。'
          : '浏览器存储并非永久可靠，请另行下载 JSON 备份。不同浏览器、用户配置或本机端口的存储相互隔离。'}
      </p>
      <label>
        导入回测实验 JSON（最多 256 MiB）
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) onImport(file);
          }}
        />
      </label>
      {preview && (
        <section aria-label="实验恢复预览" className="experiment-item">
          <h3>实验恢复预览</h3>
          <strong>{preview.name}</strong>
          <p>
            {preview.payload.dataset.symbol} ·{' '}
            {preview.payload.dataset.candles.length} 根 K 线 · 策略{' '}
            {preview.payload.result.manifest.strategy!.config.kind} ·
            {preview.payload.result.fills.length} 笔成交
          </p>
          <p>
            最终权益 {preview.payload.result.final.equity} USDT · 累计手续费{' '}
            {preview.payload.statistics.fees} USDT
          </p>
          <p>
            运行 Hash <code>{preview.payload.result.manifest.runHash}</code>
          </p>
          <p>仅在内存中预览。确认后按原实验 ID 保存，已有实验会保留。</p>
          <div className="sample-actions">
            <button disabled={busy} onClick={onConfirm}>
              确认保存导入的实验
            </button>
            <button disabled={busy} onClick={onDiscard}>
              放弃恢复预览
            </button>
          </div>
        </section>
      )}
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
