import { useState } from 'react';
import type { Dataset, DatasetSummary } from '../../core/data/dataset';

export interface LibraryProps {
  datasets: DatasetSummary[];
  dataset: Dataset | null;
  pendingRestore: Dataset | null;
  busy: boolean;
  message: string;
  error: string;
  libraryDiagnostic: string;
  open: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  saveCurrent: () => Promise<void>;
  exportCurrent: () => Promise<void>;
  inspectBackup: (file: File) => Promise<void>;
  restore: () => Promise<void>;
}
export function DatasetLibrary(props: LibraryProps) {
  const [chosen, setChosen] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ackRestore, setAckRestore] = useState(false);
  const selected = props.datasets.find((d) => d.id === chosen);
  const attempt = (action: Promise<void>) => {
    void action.catch(() => {
      /* hook exposes actionable error */
    });
  };
  const pending = props.pendingRestore;
  return (
    <section className="panel dataset-library" aria-labelledby="library-title">
      <h2 id="library-title">本地数据集与备份</h2>
      <p className="muted">
        IndexedDB 仅在当前浏览器、用户配置和 HTTP
        来源（含端口）内可用；清除网站数据、隐私模式或空间回收可能导致丢失。不是永久可靠存储，请导出
        JSON 到其他位置备份。重开网页后选择并打开数据集。
      </p>
      <fieldset disabled={props.busy}>
        <legend className="sr-only">本地数据集操作</legend>
        <label>
          已保存的数据集
          <select
            value={selected ? chosen : ''}
            onChange={(e) => {
              setChosen(e.target.value);
              setConfirmDelete(false);
            }}
          >
            <option value="">请选择（{props.datasets.length} 个）</option>
            {props.datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.symbol} · {d.name} · {d.quality.validRows} 根 ·{' '}
                {d.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <p>
              {selected.source.label} · 原单位 {selected.quality.timeUnit} ·
              周期 {selected.quality.intervalMs! / 1000} 秒 ·{' '}
              {selected.quality.warningCount} 项警告 · 缺失{' '}
              {selected.quality.missingCandles} 根
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.checked)}
              />
              确认删除选中数据集（请先导出备份）
            </label>
          </>
        )}
        <div className="sample-actions">
          <button
            disabled={!selected}
            onClick={() => attempt(props.open(chosen))}
          >
            打开选中数据集
          </button>
          <button
            disabled={!selected || !confirmDelete}
            onClick={() => attempt(props.remove(chosen))}
          >
            删除选中数据集
          </button>
          <button
            disabled={!props.dataset}
            onClick={() => attempt(props.saveCurrent())}
          >
            保存当前数据集
          </button>
          <button
            disabled={!props.dataset}
            onClick={() => attempt(props.exportCurrent())}
          >
            导出当前数据 JSON
          </button>
        </div>
        <label>
          导入 JSON 备份（最多 20 MiB / 50,000 根）
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setAckRestore(false);
              if (file) attempt(props.inspectBackup(file));
              e.target.value = '';
            }}
          />
        </label>
        {pending && (
          <div className="confirmation-panel">
            <h3>备份恢复预览</h3>
            <p>
              {pending.symbol} · {pending.name} · {pending.candles.length} 根 ·{' '}
              {pending.source.label}
            </p>
            <p>{pending.source.note}</p>
            <p>
              {new Date(pending.quality.range!.startUtcMs).toISOString()} 至{' '}
              {new Date(pending.quality.range!.endUtcMs).toISOString()}（UTC） ·{' '}
              {pending.quality.warningCount} 项警告 · 缺口{' '}
              {pending.quality.gapCount}{' '}
              处。首尾完整性及来源真实性未获证明；缺口未修复。JSON 不包含原始
              CSV。
            </p>
            <details>
              <summary>恢复数据的警告</summary>
              {pending.quality.issues.map((issue, i) => (
                <p key={i}>
                  {issue.code}：{issue.message}
                </p>
              ))}
            </details>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={ackRestore}
                onChange={(e) => setAckRestore(e.target.checked)}
              />
              我已阅读备份范围与警告，确认恢复为新副本
            </label>
            <button
              disabled={!ackRestore}
              onClick={() => attempt(props.restore())}
            >
              确认恢复备份
            </button>
          </div>
        )}
      </fieldset>
      {props.busy && <p role="status">正在处理本地数据，请稍候…</p>}
      {props.message && <p role="status">{props.message}</p>}
      {(props.libraryDiagnostic || props.error) && (
        <div role="alert" className="import-error">
          {props.libraryDiagnostic && <p>{props.libraryDiagnostic}</p>}
          {props.error && <p>{props.error}</p>}
        </div>
      )}
    </section>
  );
}
