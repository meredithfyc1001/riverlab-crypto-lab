import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const base = dirname(fileURLToPath(import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error(
      'Node.js 24 LTS is required. Install Node 24, then double-click start-local.bat.',
    );
  const args = process.argv.slice(2),
    portArg = args.find((a) => a.startsWith('--port='));
  if (args.some((a) => a !== '--no-open' && !/^--port=\d+$/.test(a)))
    throw new Error('Usage: node server.mjs [--port=4173] [--no-open]');
  const port = portArg ? Number(portArg.slice(7)) : 4173;
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Port must be 1024..65535.');
  const root = await realpath(join(base, 'dist'));
  const allowed = new Set();
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const target = join(dir, entry.name);
      if (entry.isDirectory()) await scan(target);
      else if (entry.isFile() && mime[extname(entry.name)])
        allowed.add(relative(root, target).split('\\').join('/'));
    }
  }
  await scan(root);
  if (!allowed.has('index.html'))
    throw new Error(
      'dist/index.html is missing. Extract the complete ZIP before starting.',
    );
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const respond = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      respond(405, 'Read-only static server');
      return;
    }
    if (![`127.0.0.1:${port}`].includes(req.headers.host)) {
      respond(403, 'Invalid Host');
      return;
    }
    try {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (
        !path.startsWith('/') ||
        /[\\\0:%]/.test(path) ||
        path.split('/').some((s) => s === '..' || s.startsWith('.'))
      ) {
        respond(403, 'Forbidden path');
        return;
      }
      const key = path === '/' ? 'index.html' : path.slice(1);
      if (!allowed.has(key)) {
        respond(404, 'Not found');
        return;
      }
      const file = await realpath(join(root, key)),
        rel = relative(root, file);
      if (
        rel.startsWith('..') ||
        isAbsolute(rel) ||
        !(await stat(file)).isFile()
      ) {
        respond(403, 'Forbidden path');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch {
      respond(404, 'Not found');
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.on('error', (e) => {
    process.stderr.write(`Server error: ${e.message}\n`);
    stop(1);
  });
  let closing = false;
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  function stop(code = 0) {
    if (closing) return;
    closing = true;
    input.close();
    server.close(() => {
      process.stdout.write('STOPPED: local server exited.\n');
      process.exit(code);
    });
    server.closeAllConnections();
  }
  input.on('line', (line) => {
    if (line.trim() === '' || line.trim().toLowerCase() === 'q') stop();
  });
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(
    `READY ${url}\nKeep this window open. Press Enter, q+Enter, or Ctrl+C to stop.\n`,
  );
  if (port !== 4173)
    process.stdout.write(
      'Different ports use separate browser storage. Return to 4173 to see earlier saved records.\n',
    );
  if (!args.includes('--no-open')) {
    const command =
      process.platform === 'win32'
        ? 'rundll32.exe'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    const child = spawn(
      command,
      process.platform === 'win32'
        ? ['url.dll,FileProtocolHandler', url]
        : [url],
      { stdio: 'ignore', windowsHide: true },
    );
    child.on('error', () =>
      process.stdout.write(
        `Browser could not open automatically. Copy ${url} into Chrome or Edge.\n`,
      ),
    );
    child.on('exit', (code) => {
      if (code) process.stdout.write(`Open ${url} in Chrome or Edge.\n`);
    });
  }
}
main().catch((e) => {
  process.stderr.write(
    `START FAILED: ${e.code === 'EADDRINUSE' ? 'Port is occupied. Close the previous RiverLab window, or run node server.mjs --port=4174 (separate storage).' : e.message}\n`,
  );
  process.exitCode = 1;
});
