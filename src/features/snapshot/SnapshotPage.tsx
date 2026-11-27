import { useEffect, useRef, useState } from 'react';
import { layouts } from '../../infrastructure/database-layouts';
import { RiskNotice } from '../../components/RiskNotice';
import { isDesktopRepository } from '../../infrastructure/desktop-repository';
import type { SnapshotLayout } from '../../infrastructure/snapshot-source';
import {
  exportSnapshot,
  selectDestination,
  SnapshotExportError,
  supportsFilePicker,
  type ExportResult,
} from './export-client';

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
function Results({ result }: { result: ExportResult }) {
  const { receipt, report, fileName, download } = result;
  const [requested, setRequested] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  function requestDownload(blob: Blob, name: string) {
    setDownloadError('');
    try {
      downloadBlob(blob, name);
      if (blob === download) setRequested(true);
    } catch (cause) {
      if (blob === download) setRequested(false);
      setDownloadError(
        cause instanceof Error ? cause.message : '浏览器未能启动下载。',
      );
    }
  }
  const safe = fileName.replace(/[\r\n\\/]/g, '_');
  return (
    <section className="panel snapshot-panel" aria-labelledby="result-title">
      <h2 id="result-title">导出回执</h2>
      <p role="status">
        {download
          ? requested
            ? '已请求浏览器下载。请在下载列表中确认文件保存结果。'
            : '迁移包已在内存中校验，请下载文件。'
          : '文件已写入并通过回读校验。'}
      </p>
      <p>
        {fileName} · {receipt.bytes.toLocaleString()} 字节 · {receipt.rows}{' '}
        条对象存储记录
      </p>
      <dl>
        <dt>完整文件 SHA-256</dt>
        <dd>
          <code>{receipt.fileSha256}</code>
        </dd>
        <dt>快照内容 ID</dt>
        <dd>
          <code>{receipt.snapshotContentId}</code>
        </dd>
      </dl>
      <div className="snapshot-actions">
        {download && (
          <button onClick={() => requestDownload(download, safe)}>
            下载迁移包
          </button>
        )}
        <button
          onClick={() =>
            requestDownload(
              new Blob([`${receipt.fileSha256}  ${safe}\n`], {
                type: 'text/plain;charset=utf-8',
              }),
              safe + '.sha256',
            )
          }
        >
          下载 SHA-256
        </button>
        <button
          onClick={() =>
            requestDownload(
              new Blob(
                [
                  JSON.stringify(
                    { fileName, ...receipt, source: report },
                    null,
                    2,
                  ),
                ],
                { type: 'application/json;charset=utf-8' },
              ),
              safe + '.receipt.json',
            )
          }
        >
          下载导出回执
        </button>
      </div>
      {downloadError && <p role="alert">{downloadError}</p>}
    </section>
  );
}

function BrowserExport() {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [layout, setLayout] = useState<SnapshotLayout | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    const cancel = () => current.current?.abort();
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel();
      window.removeEventListener('pagehide', cancel);
    };
  }, []);

  async function start() {
    if (!confirmed || current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError('');
    setMissing([]);
    setResult(null);
    setLayout(null);
    setStatus(
      supportsFilePicker()
        ? '请选择迁移包的保存位置。'
        : '正在检查源库及读取屏障…',
    );
    try {
      const handle = await selectDestination();
      controller.signal.throwIfAborted();
      setStatus('正在检查源库及读取屏障…');
      const verified = await exportSnapshot(
        handle,
        controller.signal,
        (notice) => {
          if (notice.type === 'layout') {
            setLayout(notice.layout);
            setStatus('九库读取屏障已建立，正在验证与封装记录…');
          } else if (notice.type === 'progress') {
            const p = notice.progress;
            setStatus(
              `${p.database} / ${p.store} · 已读取 ${p.read} / ${p.total} 条`,
            );
          } else setStatus('正在回读迁移包并校验完整文件 SHA-256…');
        },
      );
      setResult(verified);
      setStatus('');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setStatus('导出已取消。');
      } else {
        setStatus('');
        setError(
          cause instanceof Error
            ? cause.message
            : '导出失败，请检查浏览器存储权限和可用空间。',
        );
        if (cause instanceof SnapshotExportError)
          setMissing(cause.missingDatabases);
      }
    } finally {
      current.current = null;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel snapshot-panel" aria-labelledby="source-title">
        <h2 id="source-title">导出来源</h2>
        <p>
          <strong>{location.origin}</strong> · 当前浏览器配置
        </p>
        <p>
          从该来源只读导出九个研究库的正文与原摘要。缺库、结构不符或记录校验失败时会中止导出。
        </p>
        <p>
          {supportsFilePicker()
            ? '文件会按块写入你选择的位置，完成后重新读取并核对 SHA-256。'
            : '此浏览器使用内存下载方式，单包上限为 64 MiB。'}
        </p>
        <label className="snapshot-confirm">
          <input
            type="checkbox"
            disabled={busy}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我确认从当前浏览器配置导出全部九个研究库。
        </label>
        <div className="snapshot-actions">
          <button disabled={!confirmed || busy} onClick={() => void start()}>
            {supportsFilePicker() ? '选择文件并开始导出' : '开始导出'}
          </button>
          {busy && (
            <button onClick={() => current.current?.abort()}>取消导出</button>
          )}
        </div>
        {status && <p role="status">{status}</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            {missing.length > 0 && (
              <>
                <p>当前来源的枚举结果</p>
                <ul>
                  {Object.values(layouts).map(([name]) => (
                    <li key={name}>
                      {name} ·{' '}
                      {missing.includes(name) ? '缺失' : '存在，布局待核对'}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
      {layout && (
        <section
          className="panel snapshot-panel"
          aria-labelledby="layout-title"
        >
          <h2 id="layout-title">源库清单</h2>
          <p>
            读取屏障时间 {new Date(layout.barrierUtcMs).toISOString()}（UTC）
          </p>
          <table>
            <thead>
              <tr>
                <th>数据库</th>
                <th>版本</th>
                <th>对象存储及条数</th>
              </tr>
            </thead>
            <tbody>
              {layout.databases.map((db) => (
                <tr key={db.name}>
                  <th scope="row">{db.name}</th>
                  <td>{db.version}</td>
                  <td>
                    {db.stores.map((s) => `${s.name}（${s.count}）`).join('、')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {result && <Results result={result} />}
    </>
  );
}

export function SnapshotPage() {
  const desktop = isDesktopRepository();
  const referrer = document.referrer;
  const arrivedFromWorkbench = [
    new URL('./', location.href).href,
    new URL('./index.html', location.href).href,
  ].includes(referrer);
  return (
    <main className="snapshot-page">
      {arrivedFromWorkbench && (
        <nav aria-label="工作台">
          <a className="text-link" href="./index.html#/datasets">
            返回研究工作台
          </a>
        </nav>
      )}
      <h1>浏览器研究库快照导出</h1>
      {desktop ? (
        <p role="alert">
          此入口仅支持浏览器研究库。请在原浏览器配置和来源中打开导出页。
        </p>
      ) : (
        <BrowserExport />
      )}
      <RiskNotice />
    </main>
  );
}
