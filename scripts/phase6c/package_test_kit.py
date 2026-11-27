"""Build or run the isolated Phase 6C-B Python/Node offline acceptance kit."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = 'samples/synthetic-versions.riverlab-migration'
RECEIPT = 'samples/browser-receipt.json'
METADATA = 'kit.json'
SUMS = 'SHA256SUMS.txt'
CHECKLIST = 'docs/phase-6c-b-acceptance.md'
def python_sources():
    """Follow the same two local module roots as the offline migration entry."""
    tools = ROOT / 'scripts/phase6c'
    references = ROOT / 'tests/reference'
    pending = [tools / 'migrate_candidate.py', Path(__file__).resolve()]
    included = set()
    while pending:
        path = pending.pop()
        if path in included:
            continue
        included.add(path)
        tree = ast.parse(path.read_bytes(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                filename = name.split('.', 1)[0] + '.py'
                for directory in (tools, references):
                    local = directory / filename
                    if local.is_file():
                        pending.append(local)
                        break
    return sorted(path.relative_to(ROOT).as_posix() for path in included)


def file_hash(path):
    with path.open('rb') as file:
        digest = hashlib.sha256()
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
        return digest.hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def dump(value):
    return (json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + '\n').encode()


def require(value, message):
    if not value:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def trusted_sample(archive, receipt_path):
    receipt = read_json(receipt_path)
    require(file_hash(archive) == receipt['fileSha256'], 'export receipt and archive SHA-256 differ')
    require(archive.stat().st_size == receipt['bytes'], 'export receipt size differs')
    with archive.open('rb') as file:
        require(file.read(8) == b'RLIDB001', 'expected the browser RLIDB001 test export')
    require(receipt['rows'] == 22 and len(receipt['source']['databases']) == 9,
            'expected the 22-member nine-library Phase 6C-B browser test fixture')
    return receipt


def run_extracted():
    metadata = read_json(ROOT / METADATA)
    require(metadata['format'] == 'riverlab-offline-synthetic-kit-v1', 'unknown test kit')
    listed = set()
    for line in (ROOT / SUMS).read_text(encoding='ascii').splitlines():
        digest, name = line.split('  ', 1)
        parts = Path(name).parts
        require(re.fullmatch('[a-f0-9]{64}', digest) and not Path(name).is_absolute()
                and '..' not in parts and name not in listed,
                'bad or duplicate test kit checksum entry')
        listed.add(name)
        require(file_hash(ROOT / name) == digest, f'test kit hash mismatch: {name}')
    require(listed == set(metadata['members']) | {METADATA}, 'test kit member set differs')
    require(sys.version_info >= (3, 11) and sqlite3.sqlite_version_info >= (3, 37, 0),
            'Python 3.11+ with SQLite 3.37+ is required')
    node = subprocess.check_output(['node', '-p', 'process.versions.node'], text=True).strip()
    require(node.split('.')[0] == '24', f'this test kit requires Node 24, got {node}')
    receipt = trusted_sample(ROOT / ARCHIVE, ROOT / RECEIPT)
    require(receipt['fileSha256'] == metadata['archiveSha256'], 'sample identity differs')
    output = Path(tempfile.mkdtemp(prefix='riverlab-6cb-synthetic-')).resolve()
    candidate = output / 'candidate'
    command = [sys.executable, '-B', str(ROOT / 'scripts/phase6c/migrate_candidate.py'),
               str(ROOT / ARCHIVE), '--sha256', receipt['fileSha256'], '--candidate-dir', str(candidate)]
    print(f'Synthetic candidate and reports: {candidate}', flush=True)
    subprocess.run(command, check=True, cwd=ROOT)
    result = read_json(candidate / 'candidate.json')
    require(result['status'] == 'READY' and
            result['sha256']['research.sqlite'] == file_hash(candidate / 'research.sqlite'),
            'missing READY receipt or SQLite hash mismatch')
    print(json.dumps({'status': 'PASS', 'candidate': str(candidate),
                      'candidateSha256': result['sha256']['research.sqlite'],
                      'sourceCommit': metadata['sourceCommit'], 'sourceDirty': metadata['sourceDirty'],
                      'os': sys.platform, 'node': node, 'python': sys.version.split()[0],
                      'sqlite': sqlite3.sqlite_version}, ensure_ascii=True))
    return candidate


def build(archive, receipt_path, out):
    receipt = trusted_sample(archive, receipt_path)
    project_version = read_json(ROOT / 'package.json')['version']
    source = git('rev-parse', 'HEAD')
    dirty = bool(git('status', '--porcelain', '--untracked-files=all'))
    out.mkdir(parents=True, exist_ok=False)
    name = f'RiverLab-{project_version}-Windows-isolated-test-{source[:12]}'
    if dirty:
        name += '-dirty'
    kit = out / (name + '.zip')
    files = {name: (ROOT / name).read_bytes() for name in [
        *python_sources(), 'src-tauri/src/schema/records.sql', 'src-tauri/src/schema/summaries.sql', CHECKLIST,
    ]}
    files[ARCHIVE] = archive.read_bytes()
    files[RECEIPT] = receipt_path.read_bytes()
    files['run-isolated.cmd'] = (ROOT / 'scripts/phase6c/run-isolated.cmd').read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    options = ("import { build } from 'esbuild'; const {outputFiles} = await build({"
               "entryPoints:['scripts/phase6c/recompute.ts'], bundle:true, platform:'node', "
               "format:'esm', target:'node24', write:false}); process.stdout.write(outputFiles[0].contents);")
    files['scripts/phase6c/recompute.mjs'] = subprocess.check_output(
        ['node', '--input-type=module', '-e', options], cwd=ROOT)
    hashes = {member: hashlib.sha256(data).hexdigest() for member, data in files.items()}
    require(hashes[ARCHIVE] == receipt['fileSha256'] and json.loads(files[RECEIPT]) == receipt,
            'the browser archive or trusted receipt changed while packaging')
    files[METADATA] = dump({
        'format': 'riverlab-offline-synthetic-kit-v1', 'projectVersion': project_version,
        'sourceCommit': source, 'sourceDirty': dirty, 'members': sorted(files),
        'archiveSha256': receipt['fileSha256'], 'archiveContentId': receipt['snapshotContentId'],
        'windowsNativeRunAtPackaging': 'NOT TESTED', 'requires': ['Node 24', 'Python 3.11+ with SQLite 3.37+'],
    })
    hashes[METADATA] = hashlib.sha256(files[METADATA]).hexdigest()
    files[SUMS] = ''.join(f'{hashes[member]}  {member}\n' for member in sorted(hashes)).encode('ascii')
    with zipfile.ZipFile(kit, 'x', compression=zipfile.ZIP_DEFLATED) as target:
        for member, data in sorted(files.items()):
            target.writestr(member, data)
    with kit.with_suffix('.zip.sha256').open('x', encoding='ascii') as file:
        file.write(f'{file_hash(kit)}  {kit.name}\n')
    hashes[SUMS] = hashlib.sha256(files[SUMS]).hexdigest()
    with kit.with_suffix('.members.sha256').open('x', encoding='ascii') as file:
        for member in sorted(hashes):
            file.write(f'{hashes[member]}  {member}\n')
    print(kit)
    return kit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('build', help='package a new browser-generated synthetic snapshot and its export receipt')
    p.add_argument('--archive', required=True, type=Path)
    p.add_argument('--receipt', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path, help='directory that does not exist')
    sub.add_parser('run', help='verify and migrate the bundled synthetic sample into a new temporary directory')
    args = parser.parse_args()
    if args.action == 'build':
        build(args.archive, args.receipt, args.out)
    else:
        run_extracted()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'Isolated kit failed: {error}', file=sys.stderr)
        sys.exit(1)
