"""Verify an isolated RLIDB001 test archive and build a new offline 6B candidate.

The sole eligibility receipt is candidate.json. A directory left by an interruption
is never reopened for writing. Retry with the same archive and a new directory.
"""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time

import verify_bundle


HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parents[1] / 'src-tauri' / 'src' / 'schema'

APPLICATION_ID = 0x52564C42
KIND = dict(zip(verify_bundle.CATALOGUE, verify_bundle.KINDS))
COLUMNS = {'body': ('records', 'body'), 'summary': ('summaries', 'summary')}
CLONES = """CREATE TABLE migration_members (
    kind TEXT NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('body','summary')),
    descriptor TEXT NOT NULL, projection_sha256 TEXT NOT NULL, clone_sha256 TEXT NOT NULL,
    PRIMARY KEY(kind,id,role), FOREIGN KEY(kind,id) REFERENCES records(kind,id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;"""


class CandidateError(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise CandidateError(message)


def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
    return sha.hexdigest()


def write_json(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(value, output, ensure_ascii=True, allow_nan=False, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())


def read_json(path):
    with path.open(encoding='utf-8') as source:
        return json.load(source)


def sync_directory(path):
    # Directory fds are supported on POSIX. Windows uses exclusive rename
    # after FlushFileBuffers (os.fsync) on the new files themselves.
    if os.name == 'posix':
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def readonly(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, isolation_level=None)


def milliseconds(start):
    return round((time.perf_counter() - start) * 1000, 3)


def insert_member(conn, decoded, member):
    kind, key, role = KIND[member['database']], member['id'], member['role']
    try:
        units = len(key.encode('utf-16-le')) // 2
    except UnicodeEncodeError as error:
        raise CandidateError(f'{kind} {key!r} {role}: unpaired surrogate in original ID') from error
    require(0 < units <= 100, f'{kind} {key!r} {role}: original ID has {units} UTF-16 units (6B limit 100)')
    prefix = f"{member['row']:08d}"
    value = (decoded / (prefix + '.projection.json')).read_bytes()
    clone = (decoded / (prefix + '.clone.json')).read_bytes()
    require(hashlib.sha256(value).hexdigest() == member['projectionSha256']
            and hashlib.sha256(clone).hexdigest() == member['cloneSha256'],
            f'{kind} {key!r} {role}: decoded data changed')
    table, column = COLUMNS[role]
    conn.execute(f'INSERT INTO {table}(kind,id,{column}) VALUES(?,?,CAST(? AS TEXT))',
                 (kind, key, value))
    conn.execute('INSERT INTO migration_members VALUES(?,?,?,CAST(? AS TEXT),?,?)',
                 (kind, key, role, clone, member['projectionSha256'], member['cloneSha256']))
    if kind == 'rule':
        require(role == 'body' and len(value) <= 20 * verify_bundle.MIB,
                f'rule {key!r}: full rule exceeds the 6B summary budget')
        conn.execute('INSERT INTO summaries SELECT kind,id,body FROM records WHERE kind=? AND id=?',
                     (kind, key))


def create_schema(conn):
    conn.execute((SCHEMA / 'records.sql').read_text(encoding='utf-8'))
    conn.execute((SCHEMA / 'summaries.sql').read_text(encoding='utf-8'))
    conn.execute(CLONES)


def verify_schema(conn):
    require(conn.execute('PRAGMA application_id').fetchone()[0] == APPLICATION_ID
            and conn.execute('PRAGMA user_version').fetchone()[0] == 1,
            'unknown candidate application ID or schema')
    # Both files were created by this tool from trusted DDL. SQLite itself
    # normalizes the stored SQL for comparison, including constraints and triggers.
    query = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'
    with closing(sqlite3.connect(':memory:')) as reference:
        create_schema(reference)
        expected = reference.execute(query).fetchall()
    actual = conn.execute(query).fetchall()
    if actual != expected:
        delta = sorted({row[1] for row in set(actual).symmetric_difference(expected)})
        raise CandidateError(f'candidate schema differs from the fixed 6B layout: {delta!r}')


def import_members(path, decoded, manifest, observe, timings, transaction):
    # Create exactly one empty staging file. Opening a pre-existing database,
    # even an empty one, is outside this migration's contract.
    path.open('xb').close()
    with closing(sqlite3.connect(path, timeout=1, isolation_level=None)) as conn:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA trusted_schema=OFF')
        conn.execute('PRAGMA synchronous=FULL')
        # A standalone candidate has no WAL dependency. 6B negotiates WAL when opened.
        require(conn.execute('PRAGMA journal_mode=DELETE').fetchone() == ('delete',),
                'cannot use a standalone rollback journal')
        observe('before_begin', path, conn)
        conn.execute('BEGIN IMMEDIATE')
        begin = time.perf_counter()
        transaction['state'] = 'active'
        try:
            create_schema(conn)
            conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
            conn.execute('PRAGMA user_version=1')
            for member in manifest['members']:
                insert_member(conn, decoded, member)
                observe('after_row', path, conn)
            require(conn.execute("SELECT count(*) FROM records WHERE kind='rule'").fetchone()[0] <= 100,
                    '6B permits at most 100 rule versions')
            timings['insertMs'] = milliseconds(begin)
            start = time.perf_counter()
            conn.commit()
            timings['commitMs'] = milliseconds(start)
            transaction['state'] = 'committed-to-staging'
        except BaseException:
            start = time.perf_counter()
            # Some SQLite errors already rolled back the entire transaction.
            if conn.in_transaction:
                conn.rollback()
                transaction['state'] = 'rolled-back'
            else:
                # SQLITE_FULL may have rolled back before Python regained
                # control. An interrupt may also arrive just after COMMIT.
                try:
                    committed = conn.execute("SELECT 1 FROM sqlite_schema WHERE name='records'").fetchone()
                    transaction['state'] = 'committed-to-staging' if committed else 'rolled-back'
                except sqlite3.Error:
                    transaction['state'] = 'unverified'
            if transaction['state'] == 'rolled-back':
                timings['rollbackMs'] = milliseconds(start)
            raise


def reconcile(path, manifest):
    stores = {(db['name'], store['name']): {
        'database': db['name'], 'kind': db['kind'], 'store': store['name'],
        'sourceCount': store['count'], 'matched': 0}
        for db in manifest['source']['databases'] for store in db['stores']}
    results = []
    counts = {'source': manifest['rows'], 'imported': 0, 'missing': 0, 'duplicates': 0,
              'conflicts': 0, 'damaged': 0, 'extra': 0}
    with closing(readonly(path)) as conn:
        conn.execute('BEGIN')
        verify_schema(conn)
        integrity = conn.execute('PRAGMA integrity_check').fetchall()
        require(integrity == [('ok',)], f'candidate SQLite integrity_check failed: {integrity!r}')
        foreign_key = conn.execute('PRAGMA foreign_key_check').fetchone()
        require(foreign_key is None, f'candidate SQLite foreign_key_check: {foreign_key!r}')
        require(conn.execute('SELECT 1 FROM records LEFT JOIN summaries USING(kind,id) '
                             'WHERE summaries.id IS NULL LIMIT 1').fetchone() is None,
                'record without a paired summary')
        for member in manifest['members']:
            kind, key, role = KIND[member['database']], member['id'], member['role']
            table, column = COLUMNS[role]
            row = conn.execute(f'SELECT CAST(t.{column} AS BLOB), CAST(m.descriptor AS BLOB), '
                               'm.projection_sha256,m.clone_sha256 '
                               f'FROM {table} t JOIN migration_members m USING(kind,id) '
                               'WHERE t.kind=? AND t.id=? AND m.role=?', (kind, key, role)).fetchone()
            actual = None
            if row is None:
                counts['missing'] += 1
            else:
                actual = [hashlib.sha256(row[0]).hexdigest(), hashlib.sha256(row[1]).hexdigest()]
                if actual != [member['projectionSha256'], member['cloneSha256']] or actual != list(row[2:]):
                    counts['damaged'] += 1
                else:
                    counts['imported'] += 1
                    stores[member['database'], member['store']]['matched'] += 1
            results.append({'database': member['database'], 'store': member['store'], 'kind': kind,
                            'role': role, 'id': key, 'row': member['row'],
                            'sourceProjectionSha256': member['projectionSha256'],
                            'sourceCloneSha256': member['cloneSha256'],
                            'sqliteProjectionSha256': actual[0] if actual else None,
                            'sqliteCloneSha256': actual[1] if actual else None})
        expected_bodies = sum(row['role'] == 'body' for row in results)
        sqlite_counts = {table: conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                         for table in ('records', 'summaries', 'migration_members')}
        for expected, actual in zip((expected_bodies, expected_bodies, len(results)), sqlite_counts.values()):
            counts['extra'] += max(0, actual - expected)
        require(conn.execute("SELECT 1 FROM records r JOIN summaries s USING(kind,id) "
                             "WHERE r.kind='rule' AND r.body<>s.summary LIMIT 1").fetchone() is None,
                'rule summary differs from its sole original versions record')
    passed = counts['source'] == counts['imported'] and not any(
        counts[k] for k in ('missing', 'duplicates', 'conflicts', 'damaged', 'extra'))
    return {'status': 'PASS' if passed else 'FAIL', 'sourceSha256': manifest['packageSha256'],
            'snapshotContentId': manifest['snapshotContentId'], 'counts': counts,
            'sqliteCounts': sqlite_counts, 'stores': list(stores.values()), 'members': results}


def validate_domain(database, decoded, report, members):
    completed = subprocess.run(['node', str(HERE / 'recompute.mjs'), str(database),
                                str(decoded), str(report)], check=False)
    require(completed.returncode == 0 and report.is_file(),
            f'historical report verifier exited with {completed.returncode}; inspect recomputation.json')
    result = read_json(report)
    rows = result.get('records', [])
    expected = {(r['kind'], r['id']) for r in members if r['role'] == 'body'}
    actual = {(r['kind'], r['id']) for r in rows if r.get('status') == 'PASS'}
    require(result.get('status') == 'PASS' and len(rows) == len(expected) and actual == expected,
            'historical reproduction did not pass for every original body')


def independent(archive, manifest, database, report):
    from verify_candidate import run
    receipt = run(archive, manifest['packageSha256'], database, report)
    saved = read_json(report)
    require(receipt.get('status') == 'PASS' and saved.get('status') == 'PASS',
            f'independent comparison failed: {report.name}')
    require(saved.get('sourceSha256') == manifest['packageSha256']
            and saved.get('snapshotContentId') == manifest['snapshotContentId']
            and saved.get('candidateSha256') == digest(database),
            f'{report.name}: receipt is not bound to the verified files')
    return saved['candidateSha256']


def backup(source, target):
    target.open('xb').close()
    def check_progress(status, _remaining, _total):
        if status not in (sqlite3.SQLITE_OK, sqlite3.SQLITE_DONE):
            raise CandidateError(f'SQLite online backup failed with status {status}')

    with closing(readonly(source)) as db, closing(sqlite3.connect(target)) as restored:
        db.backup(restored, pages=128, progress=check_progress, sleep=0)
    require(target.is_file() and target.stat().st_size, 'empty recovery candidate')


def migrate(archive, expected_sha256, candidate_dir, *, observer=None):
    archive, candidate_dir = Path(archive).absolute(), Path(candidate_dir).absolute()
    expected_sha256 = expected_sha256.lower()
    require(verify_bundle.hash_text(expected_sha256), 'expected external SHA-256 must be 64 hex digits')
    # Never write a failure receipt into any pre-existing owner directory.
    candidate_dir.mkdir(mode=0o700)
    stage = candidate_dir / '.staging'
    database, decoded = stage / 'research.sqlite', stage / 'decoded'
    observe = observer or (lambda event, path, connection: None)
    timings = {'commitMs': None, 'rollbackMs': None}
    transaction = {'state': 'not-started'}
    start = time.perf_counter()
    source_before = None
    report_name = None
    published_database = False
    step = 'create-staging'
    try:
        stage.mkdir(mode=0o700)
        step = 'external-sha256'
        tick = time.perf_counter()
        source_before = digest(archive)
        require(source_before == expected_sha256, 'external SHA-256 mismatch')
        timings['fileHashMs'] = milliseconds(tick)
        step = 'decode-archive'
        tick = time.perf_counter()
        verify_bundle.run(archive, expected_sha256, decode_dir=decoded)
        manifest = read_json(decoded / 'manifest.json')
        timings['archiveDecodeAndHashMs'] = milliseconds(tick)
        step = 'sqlite-transaction'
        import_members(database, decoded, manifest, observe, timings, transaction)
        step = 'sqlite-cold-read'
        tick = time.perf_counter()
        observe('before_integrity', database, None)
        verified_database_sha = digest(database)
        reconciliation = reconcile(database, manifest)
        report_name = 'reconciliation.json'
        write_json(candidate_dir / report_name, reconciliation)
        require(reconciliation['status'] == 'PASS', 'physical source/SQLite reconciliation failed')
        timings['coldReadAndHashMs'] = milliseconds(tick)
        step = 'historical-recomputation'
        report_name = 'recomputation.json'
        tick = time.perf_counter()
        validate_domain(database, decoded, candidate_dir / report_name, reconciliation['members'])
        timings['recomputationMs'] = milliseconds(tick)
        step = 'independent-verification'
        report_name = 'reference.json'
        tick = time.perf_counter()
        independent_sha = independent(archive, manifest, database, candidate_dir / report_name)
        timings['independentMs'] = milliseconds(tick)
        step = 'recovery'
        report_name = 'recovery.json'
        tick = time.perf_counter()
        restored = stage / 'restored.sqlite'
        backup(database, restored)
        observe('before_restore_check', restored, None)
        try:
            with closing(readonly(restored)) as recovery:
                verify_schema(recovery)
        except (sqlite3.Error, CandidateError) as error:
            write_json(candidate_dir / report_name, {'status': 'FAIL', 'stage': 'restore-schema',
                       'error': f'{type(error).__name__}: {error}'})
            raise
        independent(archive, manifest, restored, candidate_dir / report_name)
        timings['backupRestoreAndVerifyMs'] = milliseconds(tick)
        step = 'publication'
        require(digest(archive) == expected_sha256, 'source changed during verification')
        names = ['reconciliation.json', 'recomputation.json', 'reference.json', 'recovery.json']
        seals = {name: digest(candidate_dir / name) for name in names}
        seals['research.sqlite'] = digest(database)
        require(seals['research.sqlite'] == independent_sha == verified_database_sha,
                'candidate file changed between cold checks and publication')
        for path in [database, *(candidate_dir / name for name in names)]:
            with path.open('rb+') as handle:
                os.fsync(handle.fileno())
        receipt = {'status': 'READY', 'scope': 'isolated-test-candidate',
                   'sourceSha256': expected_sha256, 'snapshotContentId': manifest['snapshotContentId'],
                   'sourceBytes': manifest['packageBytes'], 'sqliteBytes': database.stat().st_size,
                   'sourceRows': manifest['rows'], 'sqliteCounts': reconciliation['sqliteCounts'],
                   'sha256': seals, 'timings': timings, 'totalMs': milliseconds(start)}
        write_json(stage / 'candidate.json', receipt)
        verify_bundle.exclusive_publish(database, candidate_dir / 'research.sqlite')
        published_database = True
        sync_directory(candidate_dir)
        # Publish the eligibility receipt last. A killed process cannot publish partial JSON.
        ready_path = candidate_dir / 'candidate.json'
        verify_bundle.exclusive_publish(stage / 'candidate.json', ready_path)
        try:
            sync_directory(candidate_dir)
        except OSError:
            ready_path.unlink()
            raise
        return receipt
    except (Exception, KeyboardInterrupt) as error:
        try:
            source_after = digest(archive) if source_before is not None else None
        except OSError:
            source_after = None
        cleanup_error = None
        try:
            # Withdraw only the new file published by this invocation. A killed
            # process may instead leave an unmarked file; it is never eligible.
            if published_database:
                (candidate_dir / 'research.sqlite').unlink()
            if stage.exists():
                shutil.rmtree(stage)
        except OSError as cleanup:
            cleanup_error = str(cleanup)
        failure = {'status': 'FAILED', 'stage': step, 'errorType': type(error).__name__,
                   'error': str(error), 'detail': getattr(error, 'detail', None),
                   'transaction': transaction['state'], 'ready': False,
                   'stagingRetained': stage.exists(), 'cleanupError': cleanup_error,
                   'expectedSourceSha256': expected_sha256, 'sourceSha256Before': source_before, 'sourceSha256After': source_after,
                   'sourceUnchanged': None if source_after is None else source_before == source_after,
                   'productionDatabaseOpened': False, 'retry': 'new-directory',
                   'report': report_name if report_name and (candidate_dir / report_name).is_file() else None,
                   'timings': timings}
        try:
            write_json(candidate_dir / 'failure.json', failure)
        except OSError as evidence_error:
            print(f'Cannot persist failure receipt: {evidence_error}', file=sys.stderr)
        raise
    finally:
        # This directory was exclusively created by this invocation. Killed
        # processes leave it available for forensic recovery and never reuse it.
        if (candidate_dir / 'candidate.json').is_file():
            shutil.rmtree(stage, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='isolated RLIDB001 test file')
    parser.add_argument('--sha256', required=True, help='trusted external SHA-256 of source file')
    parser.add_argument('--candidate-dir', required=True, type=Path, help='new, previously absent output directory')
    args = parser.parse_args()
    try:
        result = migrate(args.archive, args.sha256, args.candidate_dir)
    except (Exception, KeyboardInterrupt) as error:
        print(f'Candidate rejected: {type(error).__name__}: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
