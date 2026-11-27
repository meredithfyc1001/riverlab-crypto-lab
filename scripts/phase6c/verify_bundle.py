"""Independent reference reader for RiverLab browser archives. Python stdlib only."""
import argparse
from contextlib import ExitStack
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urlsplit


# Catalogue fixed at the nine v1 IndexedDB layouts, independent of application code.
CATALOGUE = {
    'riverlab-crypto-lab': ('datasets', 'summaries'),
    'riverlab-crypto-lab-experiments': ('experiments', 'summaries'),
    'riverlab-crypto-lab-rules': ('versions',),
    'riverlab-crypto-lab-replays': ('replays', 'summaries'),
    'riverlab-crypto-lab-risk': ('studies', 'summaries'),
    'riverlab-crypto-lab-portfolios': ('experiments', 'summaries'),
    'riverlab-crypto-lab-shared-pool': ('experiments', 'summaries'),
    'riverlab-crypto-lab-market-regime': ('reports', 'summaries'),
    'riverlab-crypto-lab-advanced-research': ('reports', 'summaries'),
}


class InvalidArchive(ValueError):
    """A required invariant of the v1 archive failed."""


class MemberValidationError(InvalidArchive):
    def __init__(self, error, database, store, row, frame):
        self.detail = {'issue': 'damaged', 'database': database, 'store': store, 'row': row}
        if frame[0] == 2:
            try:
                identity = parse_json(frame[1])
                if isinstance(identity, dict) and isinstance(identity.get('key'), str):
                    self.detail['declaredKey'] = identity['key']
            except (ValueError, RecursionError):
                pass
        super().__init__(f'{error}: ' + json.dumps(self.detail, ensure_ascii=True))


class MemberIdentityError(InvalidArchive):
    """Retain both source identities on rejection for candidate diagnostics."""

    def __init__(self, member, previous):
        same_id = member['key'] == previous['key']
        same_content = all(member[k] == previous[k] for k in ('projectionSha256', 'cloneSha256'))
        self.detail = {
            'issue': ('duplicate' if same_content else 'conflict') if same_id else 'order',
            'database': member['database'], 'store': member['store'], 'id': member['key'],
            'first': previous, 'second': member,
        }
        super().__init__('duplicate or out-of-order source key: ' + json.dumps(self.detail, ensure_ascii=True))


def require(condition, message):
    if not condition:
        raise InvalidArchive(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON property')
        result[key] = value
    return result


def invalid_constant(token):
    raise InvalidArchive(f'invalid JSON number {token}')


def parse_json(data):
    return json.loads(data.decode('utf-8', 'strict'), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def hash_text(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def temporary_file(stack, directory=None):
    fd, name = tempfile.mkstemp(dir=directory)
    os.close(fd)
    path = Path(name)
    stack.callback(path.unlink, missing_ok=True)
    return path


def exclusive_publish(staged, target):
    # Windows rename fails for existing destinations, including on removable
    # volumes without hard links. On POSIX link provides the no-replace operation.
    if os.name == 'nt':
        os.rename(staged, target)
    else:
        os.link(staged, target)


MIB = 1024 * 1024
CLONE_LIMIT = 20 * MIB
SAFE_INTEGER = 2**53 - 1
FORBIDDEN = {'__proto__', 'constructor', 'prototype'}
KINDS = ('dataset', 'experiment', 'rule', 'replay', 'risk', 'portfolio',
         'shared_pool', 'regime', 'advanced')


def compact_json(value):
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    # JS's well-formed stringify escapes lone UTF-16 surrogate code units.
    return re.sub('[\ud800-\udfff]', lambda m: '\\u%04x' % ord(m[0]), text).encode()


def fields(obj, names, context):
    require(isinstance(obj, dict) and list(obj) == names.split(), f'invalid {context} fields/order')


def parse_integer(token):
    if token == '-0':
        raise InvalidArchive('negative zero')
    # Large integral literals are also subject to JavaScript binary64 range.
    if len(token.lstrip('-')) > 15:
        number = float(token)
        require(math.isfinite(number) and Decimal(token) == Decimal(repr(number)),
                'unrepresentable integer')
    return int(token)


def parse_float(token):
    number = float(token)
    require(math.isfinite(number) and not (number == 0 and token.startswith('-')),
            'non-finite number or negative zero')
    # Decimal(repr(binary64)) supplies the shortest round-trip decimal without
    # relying on either the browser encoder or Python's exponent formatting.
    require(Decimal(token) == Decimal(repr(number)), 'number loses precision')
    return number


def projection_json(data):
    return json.loads(data.decode('utf-8', 'strict'), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant, parse_int=parse_integer, parse_float=parse_float)


class Reader:
    def __init__(self, file):
        self.file = file
        self.external = sha256()
        self.content = sha256(b'RLIDB001/content/v1\0')
        self.byte_count = 0

    def take(self, size):
        data = self.file.read(size)
        require(len(data) == size, 'unexpected end of archive')
        self.external.update(data)
        self.byte_count += size
        require(self.byte_count <= SAFE_INTEGER, 'archive length out of bounds')
        return data

    def next_frame(self):
        header = self.take(9)
        tag = header[0]
        length = int.from_bytes(header[1:], 'big')
        require(tag in (1, 0x10, 2, 3, 4, 5, 0xff), 'unknown frame tag')
        require(0 < length <= MIB, 'frame length out of bounds')
        data = self.take(length)
        if tag in (0x10, 2, 5):
            self.content.update(header)
            self.content.update(data)
        return tag, data

    def metadata(self, frame, expected):
        tag, raw = frame
        require(tag == expected, f'expected frame {expected:#04x}')
        value = parse_json(raw)
        require(raw == compact_json(value), 'noncanonical metadata')
        return value


def check_database(database, expected_kind, expected_name, with_role):
    required = 'name kind version stores' if with_role else 'name kind version stores firstRead postBarrierRead completed'
    fields(database, required, 'database')
    require(database['kind'] == expected_kind and database['name'] == expected_name, 'database identity')
    require(type(database['version']) is int and database['version'] == 1, 'unknown database version')
    stores = database['stores']
    required_stores = CATALOGUE[expected_name]
    require(isinstance(stores, list) and len(stores) == len(required_stores), 'incomplete store set')
    counts = []
    for i, (store, name) in enumerate(zip(stores, required_stores)):
        spec = 'name role keyPath autoIncrement indexes count' if with_role else 'name keyPath autoIncrement indexes count'
        fields(store, spec, 'store')
        require(store['name'] == name and store['keyPath'] == 'id'
                and store['autoIncrement'] is False and store['indexes'] == [], 'unexpected store layout')
        if with_role:
            require(store['role'] == ('body' if i == 0 else 'summary'), 'invalid store role')
        count = store['count']
        require(integer(count, 0, SAFE_INTEGER), 'invalid store count')
        counts.append(count)
    return counts


def database_counts(databases, with_role):
    require(isinstance(databases, list) and len(databases) == len(CATALOGUE), 'incomplete database set')
    return [check_database(db, kind, name, with_role)
            for db, kind, name in zip(databases, KINDS, CATALOGUE)]


def verify_cut(source, header, counts):
    # Footer proof fields are checked individually; timestamps never establish a
    # common cut without distinct, correctly bracketed acknowledgement sequences.
    required = {'scope', 'origin', 'startedUtcMs', 'barrierUtcMs', 'finishedUtcMs',
                'barrierSequence', 'fenceName', 'fenceVersion', 'fenceId',
                'missingDatabases', 'databases'}
    require(isinstance(source, dict) and set(source) == required, 'source report fields')
    require(source['scope'] == 'all-databases' and source['missingDatabases'] == [],
            'no full snapshot proof')
    require(source['origin'] == header['origin'] and source['startedUtcMs'] == header['startedUtcMs'],
            'source observation mismatch')
    times = [source[key] for key in ('startedUtcMs', 'barrierUtcMs', 'finishedUtcMs')]
    require(all(integer(t, 0, SAFE_INTEGER) for t in times) and times == sorted(times),
            'invalid observation interval')
    require(source['fenceName'] == 'riverlab-crypto-lab:snapshot-v1'
            and integer(source['fenceVersion'], 1, 1)
            and isinstance(source['fenceId'], str)
            and re.fullmatch('[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}', source['fenceId']),
            'invalid write fence')
    dbs = source['databases']
    require(database_counts(dbs, False) == counts, 'footer layout/count discrepancy')
    first, post, done = ([db[k] for db in dbs] for k in ('firstRead', 'postBarrierRead', 'completed'))
    barrier = source['barrierSequence']
    events = [*first, barrier, *post, *done]
    require(all(integer(n, 1, SAFE_INTEGER) for n in events) and len(set(events)) == len(events)
            and max(first) < barrier < min(post) and max(post) < min(done),
            'inconsistent transaction barrier proof')


def js_index(key):
    if not re.fullmatch(r'0|[1-9][0-9]{0,9}', key):
        return None
    value = int(key)
    return value if value < 2**32 - 1 else None


def object_keys(keys):
    require(isinstance(keys, list) and all(isinstance(key, str) and key not in FORBIDDEN for key in keys)
            and len(set(keys)) == len(keys), 'unsafe or duplicate object key')
    indexes = [k for k in keys if js_index(k) is not None]
    require(keys == sorted(indexes, key=js_index) + [k for k in keys if js_index(k) is None],
            'invalid ECMAScript key order')


def undefined_allowed(kind, path, key):
    if kind != 'dataset':
        return False
    if path == ('source',):
        return key in ('url', 'expectedSha256')
    return (len(path) == 3 and path[:2] == ('quality', 'issues')
            and integer(path[2], 0, 999) and key in ('line', 'field', 'raw'))


def checked_path(path):
    require(isinstance(path, list) and len(path) <= 64 and all(
        (isinstance(part, str) and part not in FORBIDDEN) or integer(part, 0, 2**32-2)
        for part in path), 'invalid clone path')
    return tuple(path)


def same_projection(left, right):
    if type(left) is not type(right):
        # JS has a single Number type. Booleans are distinct values.
        return type(left) in (int, float) and type(right) in (int, float) and left == right
    if isinstance(left, dict):
        return list(left) == list(right) and all(same_projection(v, right[k]) for k, v in left.items())
    if isinstance(left, list):
        return len(left) == len(right) and all(same_projection(a, b) for a, b in zip(left, right))
    return left == right


def verify_projection(projection, clone, kind, key):
    require(isinstance(projection, dict) and projection.get('id') == key, 'projection identity')
    fields(clone, 'version objects aliases', 'clone')
    require(integer(clone['version'], 1, 1) and isinstance(clone['objects'], list)
            and isinstance(clone['aliases'], list), 'clone version/objects/aliases')
    objects = {}
    undefined_slots = {}
    for patch in clone['objects']:
        fields(patch, 'path keys undefinedKeys', 'clone object')
        path = checked_path(patch['path'])
        require(path not in objects, 'duplicate clone path')
        keys, missing = patch['keys'], patch['undefinedKeys']
        object_keys(keys)
        require(isinstance(missing, list) and missing and all(
            isinstance(k, str) and undefined_allowed(kind, path, k) for k in missing),
                'unsupported undefined')
        absent = set(missing)
        require([k for k in keys if k in absent] == missing, 'undefined key order or missing slot')
        objects[path] = [k for k in keys if k not in absent]
        undefined_slots[path] = missing

    aliases = {}
    for alias in clone['aliases']:
        fields(alias, 'path target', 'clone alias')
        path, target = checked_path(alias['path']), checked_path(alias['target'])
        require(path and target and path not in aliases and path not in objects
                and path[:len(target)] != target, 'duplicate, cyclic or invalid alias')
        aliases[path] = target
    targets = set(aliases.values())
    visited_targets = {}
    encountered = []
    seen_aliases = []

    def visit(value, path, source_path):
        original = path == source_path
        require(len(path) <= 64, 'value nesting limit')
        if original and path in aliases:
            target = aliases[path]
            require(target in visited_targets and same_projection(value, visited_targets[target]),
                    'alias target missing, forward or incompatible with projection')
            seen_aliases.append(path)
            original = False  # No descriptors may target or patch an expanded alias subtree.
        # The same shared object may occur at a different schema path. Every
        # occurrence of an own-undefined slot must also be permitted there.
        source_path = aliases.get(source_path, source_path)
        require(all(undefined_allowed(kind, path, k) for k in undefined_slots.get(source_path, ())),
                'unsupported undefined at alias destination')
        if original and path in targets:
            require(isinstance(value, (dict, list)), 'alias target must be an object or array')
            visited_targets[path] = value
        if isinstance(value, dict):
            keys = list(value)
            object_keys(keys)
            if original and path in objects:
                require(keys == objects[path], 'clone keys differ from projection')
                encountered.append(path)
            for k, child in value.items():
                visit(child, (*path, k), (*source_path, k))
        elif isinstance(value, list):
            for i, child in enumerate(value):
                visit(child, (*path, i), (*source_path, i))
    visit(projection, (), ())
    require(encountered == list(objects) and seen_aliases == list(aliases),
            'unknown, hidden or out-of-order clone paths')


def collect_chunks(reader, initial, tag, limit, link):
    current = initial
    digest = sha256()
    length = 0
    require(current[0] == tag, 'missing member data')
    while current[0] == tag:
        block = current[1]
        length += len(block)
        require(length <= limit, 'member exceeds byte budget')
        link.write(block)
        digest.update(block)
        current = reader.next_frame()
    return current, length, digest.hexdigest()


def fixture_rule_check(record):
    # This fixed vector contains integer numbers and BMP names. The historical
    # canonical identity uses ASCII Unicode escapes and lexicographically sorted keys.
    def canonical_hash(value):
        raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()
        return sha256(raw).hexdigest()
    expected_rule = '7335d971c1d49699fe10cc8354c2a052029d21f43ee89eabd15303340f359798'
    expected_record = '27260d40f1d3e80551573f72c9a15b04bb0e807485ab54c6b12ee77bbcdfec50'
    require(record.get('ruleHash') == expected_rule and canonical_hash(record.get('rule')) == expected_rule,
            'frozen ruleHash mismatch')
    body = {k: v for k, v in record.items() if k != 'recordHash'}
    require(record.get('recordHash') == expected_record and canonical_hash(body) == expected_record,
            'frozen recordHash mismatch')
    return {'id': record['id'], 'ruleHash': expected_rule, 'recordHash': expected_record}


def read_row(reader, frame, db_name, kind, store, row_number, stage, check_frozen):
    identity = reader.metadata(frame, 2)
    fields(identity, 'database store role keyType key id', 'member identity')
    require(identity['database'] == db_name and identity['store'] == store['name']
            and identity['role'] == store['role'] and identity['keyType'] == 'string',
            'member outside declared store/order')
    key = identity['key']
    require(isinstance(key, str) and key and key == identity['id'], 'invalid source key/id')
    prefix = f'{row_number:08d}'
    size_limit = (20 if store['role'] == 'summary' else 256) * MIB
    with ExitStack() as stack:
        def spool(suffix):
            if stage is not None:
                return stack.enter_context((stage / f'{prefix}.{suffix}.json').open('x+b'))
            return stack.enter_context(tempfile.SpooledTemporaryFile(max_size=MIB))
        body, descriptor = spool('projection'), spool('clone')
        next_frame, body_len, body_hash = collect_chunks(reader, reader.next_frame(), 3, size_limit, body)
        next_frame, clone_len, clone_hash = collect_chunks(reader, next_frame, 4, CLONE_LIMIT, descriptor)
        seal = reader.metadata(next_frame, 5)
        fields(seal, 'projectionBytes projectionSha256 cloneBytes cloneSha256', 'member seal')
        require(integer(seal['projectionBytes'], 1, size_limit) and seal['projectionBytes'] == body_len
                and integer(seal['cloneBytes'], 1, CLONE_LIMIT) and seal['cloneBytes'] == clone_len
                and seal['projectionSha256'] == body_hash and seal['cloneSha256'] == clone_hash,
                'member length or SHA-256 mismatch')
        body.seek(0)
        descriptor.seek(0)
        projection = projection_json(body.read())
        clone_data = descriptor.read()
        clone = parse_json(clone_data)
        require(clone_data == compact_json(clone), 'noncanonical clone descriptor')
        verify_projection(projection, clone, kind, key)
        frozen = None
        if check_frozen and kind == 'rule' and key == 'phase-5e-breakout@1':
            frozen = fixture_rule_check(projection)
    return {**identity, **seal, 'row': row_number}, frozen


def read_archive(stream, expected_hash, stage, member_list, check_frozen):
    reader = Reader(stream)
    require(reader.take(8) == b'RLIDB001', 'wrong archive magic/version')
    header = reader.metadata(reader.next_frame(), 1)
    fields(header, 'version origin startedUtcMs', 'header')
    require(integer(header['version'], 1, 1) and integer(header['startedUtcMs'], 0, SAFE_INTEGER),
            'invalid header version/time')
    origin = header['origin']
    require(isinstance(origin, str) and origin, 'invalid origin')
    url = urlsplit(origin)
    require(url.scheme in ('http', 'https') and url.hostname and re.fullmatch(r'[!-~]+', origin)
            and not any(char in url.netloc for char in ('%', '#', '?', '/', '@', '\\'))
            and not (url.path or url.query or url.fragment), 'invalid browser origin')
    host = f'[{url.hostname}]' if ':' in url.hostname else url.hostname
    port = '' if url.port in (None, 80 if url.scheme == 'http' else 443) else f':{url.port}'
    require(origin == f'{url.scheme}://{host}{port}', 'noncanonical browser origin')
    layout = reader.metadata(reader.next_frame(), 0x10)
    fields(layout, 'databases', 'layout')
    databases = layout['databases']
    counts = database_counts(databases, True)
    require(sum(map(sum, counts)) <= SAFE_INTEGER, 'declared row total out of bounds')
    rows = 0
    frozen = None
    for db in databases:
        body_keys = None
        for store in db['stores']:
            keys_digest = sha256()
            previous = None
            previous_member = None
            for _ in range(store['count']):
                rows += 1
                frame = reader.next_frame()
                try:
                    member, fixture = read_row(reader, frame, db['name'], db['kind'],
                                               store, rows, stage, check_frozen)
                except (ValueError, TypeError, RecursionError, OverflowError) as error:
                    raise MemberValidationError(error, db['name'], store['name'], rows, frame) from error
                # IndexedDB strings compare by UTF-16 code unit, not Unicode scalar.
                key = member['key'].encode('utf-16-be', 'surrogatepass')
                if previous is not None and previous >= key:
                    prior = previous_member
                    # The normal sorted scan keeps one key. Consult the on-disk
                    # inventory only when an out-of-order row may repeat an earlier ID.
                    if key != previous and member_list is not None:
                        member_list.seek(0)
                        for entry in member_list:
                            seen = json.loads(entry)
                            if all(seen[k] == member[k] for k in ('database', 'store', 'id')):
                                prior = seen
                                break
                    raise MemberIdentityError(member, prior)
                previous, previous_member = key, member
                keys_digest.update(len(key).to_bytes(8, 'big'))
                keys_digest.update(key)
                if member_list is not None:
                    member_list.write(json.dumps(member, ensure_ascii=True, separators=(',', ':')) + '\n')
                if fixture is not None:
                    frozen = fixture
            if store['role'] == 'body':
                body_keys = keys_digest.digest()
            else:
                require(keys_digest.digest() == body_keys, 'orphan body or summary')
    footer = reader.metadata(reader.next_frame(), 0xff)
    fields(footer, 'rows snapshotContentId source', 'footer')
    require(integer(footer['rows'], 0, SAFE_INTEGER) and footer['rows'] == rows, 'row total discrepancy')
    require(footer['snapshotContentId'] == reader.content.hexdigest(), 'snapshotContentId discrepancy')
    verify_cut(footer['source'], header, counts)
    require(stream.read(1) == b'', 'trailing bytes after footer')
    require(reader.external.hexdigest() == expected_hash, 'external SHA-256 mismatch')
    if check_frozen:
        require(frozen is not None, 'missing frozen reference rule')
    return {'packageSha256': expected_hash, 'packageBytes': reader.byte_count, 'rows': rows,
            'snapshotContentId': footer['snapshotContentId'], 'source': footer['source'],
            'frozenRule': frozen}


def write_manifest(path, receipt, member_list):
    member_list.seek(0)
    with path.open('w', encoding='utf-8', newline='\n') as output:
        output.write(json.dumps(receipt, ensure_ascii=True, separators=(',', ':'))[:-1] + ',"members":[')
        for i, member in enumerate(member_list):
            if i:
                output.write(',')
            output.write(member.rstrip('\n'))
        output.write(']}\n')


def run(package, expected_hash, manifest=None, decode_dir=None, check_frozen=False):
    expected_hash = expected_hash.lower()
    require(hash_text(expected_hash), 'expected external SHA-256 must be 64 hex digits')
    for target in (manifest, decode_dir):
        if target is not None:
            require(not os.path.lexists(target), 'output target already exists')
    if manifest is not None and decode_dir is not None:
        require(decode_dir.resolve() not in (manifest.resolve(), *manifest.resolve().parents),
                'separate manifest must be outside the decode directory')
    with ExitStack() as stack:
        stage = None
        if decode_dir is not None:
            stage = Path(stack.enter_context(tempfile.TemporaryDirectory(dir=decode_dir.parent)))
        members = None
        if manifest is not None or stage is not None:
            members = stack.enter_context(tempfile.TemporaryFile(mode='w+', encoding='ascii', newline='\n'))
        with package.open('rb') as stream:
            receipt = read_archive(stream, expected_hash, stage, members, check_frozen)
        manifest_stage = None
        if manifest is not None:
            manifest_stage = temporary_file(stack, manifest.parent)
            write_manifest(manifest_stage, receipt, members)
        if stage is not None:
            write_manifest(stage / 'manifest.json', receipt, members)
            # mkdir is exclusive even on filesystems where rename may replace an
            # empty directory. Publish only files from this private staging root.
            decode_dir.mkdir(mode=0o700)
            # Publish the directory manifest last as the completeness marker.
            for row in range(1, receipt['rows'] + 1):
                for suffix in ('projection', 'clone'):
                    name = f'{row:08d}.{suffix}.json'
                    exclusive_publish(stage / name, decode_dir / name)
            exclusive_publish(stage / 'manifest.json', decode_dir / 'manifest.json')
            if manifest_stage is not None:
                exclusive_publish(manifest_stage, manifest)
        elif manifest_stage is not None:
            exclusive_publish(manifest_stage, manifest)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--sha256', required=True, help='expected external archive SHA-256')
    parser.add_argument('--manifest', type=Path, help='write a new verified inventory JSON file')
    parser.add_argument('--decode-dir', type=Path, help='extract verified projections/descriptors to a new test directory')
    parser.add_argument('--check-frozen-rule', action='store_true',
                        help='require and independently verify the Phase 5E synthetic golden rule')
    args = parser.parse_args()
    try:
        receipt = run(args.package, args.sha256, args.manifest, args.decode_dir, args.check_frozen_rule)
    except (ValueError, OSError, TypeError, OverflowError, RecursionError, InvalidOperation) as error:
        print(f'Archive rejected: {error}', file=sys.stderr)
        return 1
    print(json.dumps({k: v for k, v in receipt.items() if k != 'source'}, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
