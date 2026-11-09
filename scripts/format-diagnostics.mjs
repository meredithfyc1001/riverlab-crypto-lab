// Read-only formatting diagnostics. Never rewrites the checkout or alters check results.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import prettier from 'prettier';
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const path of paths) {
  const info = await prettier.getFileInfo(path, {
    ignorePath: '.prettierignore',
  });
  if (info.ignored || !info.inferredParser) continue;
  const source = await readFile(path, 'utf8');
  const result = await prettier.format(source, {
    ...(await prettier.resolveConfig(path)),
    filepath: path,
  });
  if (source !== result)
    process.stdout.write(
      'FORMAT_FIX ' + JSON.stringify({ path, content: result }) + '\n',
    );
}
