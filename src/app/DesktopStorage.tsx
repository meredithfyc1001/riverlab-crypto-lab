import { useState } from 'react';

type Command =
  'local_service_health' | 'local_service_integrity' | 'local_service_backup';

interface Health {
  status: 'running';
  serviceVersion: string;
  protocolVersion: number;
  schemaVersion: number;
  dataDirectory: string;
  availableBytes: number;
}

async function invoke<T>(command: Command): Promise<T> {
  const host = (
    window as Window & {
      __TAURI__?: { core: { invoke<R>(name: Command): Promise<R> } };
    }
  ).__TAURI__;
  if (!host) throw new Error('无法连接桌面服务，请重新启动应用。');
  return host.core.invoke<T>(command);
}

export function DesktopStorage() {
  const [health, setHealth] = useState<Health>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run(command: Command) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (command === 'local_service_health') {
        setHealth(undefined);
        setHealth(await invoke<Health>(command));
      } else if (command === 'local_service_integrity') {
        const result = await invoke<string>(command);
        if (result !== 'ok') throw new Error(result);
        setMessage('数据库完整性检查通过。');
      } else {
        const path = await invoke<string>(command);
        setMessage(`备份已保存至 ${path}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel desktop-storage"
      aria-labelledby="desktop-storage-title"
    >
      <h2 id="desktop-storage-title">桌面数据存储</h2>
      <p>
        研究记录保存在当前用户的 SQLite 数据库中。程序升级后可继续打开已有记录。
      </p>
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() => void run('local_service_health')}
        >
          查看数据目录与服务状态
        </button>
        <button
          disabled={busy}
          onClick={() => void run('local_service_integrity')}
        >
          检查数据库完整性
        </button>
        <button
          disabled={busy}
          onClick={() => void run('local_service_backup')}
        >
          创建数据库备份
        </button>
      </div>
      {health && (
        <dl>
          <dt>数据目录</dt>
          <dd>{health.dataDirectory}</dd>
          <dt>当前状态</dt>
          <dd>服务运行中，目录可写</dd>
          <dt>可用空间</dt>
          <dd>
            {(health.availableBytes / 1024 ** 3).toLocaleString('zh-CN', {
              maximumFractionDigits: 2,
            })}{' '}
            GiB
          </dd>
          <dt>版本</dt>
          <dd>
            服务 {health.serviceVersion} · 协议 {health.protocolVersion} ·
            数据库 {health.schemaVersion}
          </dd>
        </dl>
      )}
      {busy && <p role="status">正在访问本地存储…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
