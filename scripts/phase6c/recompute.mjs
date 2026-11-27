// Source checkout entry. The Windows test package bundles the same TS entry
// and its historical engines into an offline Node 24 ESM file.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./recompute.ts', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  write: false,
});
await import(
  'data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].contents).toString('base64')
);
