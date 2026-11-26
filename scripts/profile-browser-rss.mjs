import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function rssKiB(session) {
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  const ids = processInfo.map((p) => p.id).filter(Number.isSafeInteger);
  if (process.platform === 'win32') {
    const command = `$p=Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; [int64](($p | Measure-Object -Property WorkingSet64 -Sum).Sum / 1024)`;
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ]);
    return Number(stdout.trim());
  }
  if (process.platform === 'darwin') {
    const { stdout } = await exec('ps', ['-o', 'rss=', '-p', ids.join(',')]);
    return stdout
      .trim()
      .split(/\s+/)
      .reduce((sum, kib) => sum + Number(kib), 0);
  }
  if (process.platform !== 'linux') return null;
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const status = await readFile('/proc/' + id + '/status', 'utf8');
        return Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] ?? 0);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') return 0;
        throw error;
      }
    }),
  );
  return rows.reduce((a, b) => a + b, 0);
}
