"""Exercise the standalone reader with generated, isolated RLIDB001 files."""
import copy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'phase6c'))
import verify_bundle as verifier


CATALOGUE = [
    ('dataset', '', 'datasets'),
    ('experiment', '-experiments', 'experiments'),
    ('rule', '-rules', 'versions'),
    ('replay', '-replays', 'replays'),
    ('risk', '-risk', 'studies'),
    ('portfolio', '-portfolios', 'experiments'),
    ('shared_pool', '-shared-pool', 'experiments'),
    ('regime', '-market-regime', 'reports'),
    ('advanced', '-advanced-research', 'reports'),
]
EMPTY = {'version': 1, 'objects': [], 'aliases': []}
RULE = json.loads((ROOT / 'tests/fixtures/phase-5e-breakout-rule.json').read_text(encoding='utf-8'))


def raw(obj):
    if isinstance(obj, bytes):
        return obj
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def frame(tag, value):
    payload = raw(value)
    return struct.pack('>BQ', tag, len(payload)) + payload


def data_row(key, value, clone=None):
    return key, raw(value), raw(EMPTY if clone is None else clone)


def snapshot(values, change=None, split=False):
    header = {'version': 1, 'origin': 'http://127.0.0.1:4173', 'startedUtcMs': 100}
    layout = {'databases': []}
    source = {'scope': 'all-databases', 'origin': header['origin'], 'startedUtcMs': 100, 'barrierUtcMs': 110,
              'barrierSequence': 10, 'fenceName': 'riverlab-crypto-lab:snapshot-v1', 'fenceVersion': 1,
              'fenceId': 'c0de0001-b00c-4def-a000-000000000000', 'missingDatabases': [],
              'databases': [], 'finishedUtcMs': 120}
    frames = [(1, header), (0x10, layout)]
    rows = 0
    for i, (kind, suffix, body) in enumerate(CATALOGUE):
        name = 'riverlab-crypto-lab' + suffix
        db = {'name': name, 'kind': kind, 'version': 1, 'stores': []}
        proof = {**db, 'stores': [], 'firstRead': i+1, 'postBarrierRead': 11+i, 'completed': 20+i}
        layout['databases'].append(db)
        source['databases'].append(proof)
        for store in ([body] if kind == 'rule' else [body, 'summaries']):
            role = 'summary' if store == 'summaries' else 'body'
            items = values.get((kind, store), [])
            store_layout = {'name': store, 'role': role, 'keyPath': 'id', 'autoIncrement': False,
                            'indexes': [], 'count': len(items)}
            db['stores'].append(store_layout)
            proof['stores'].append({k: v for k, v in store_layout.items() if k != 'role'})
            for key, projection, descriptor in items:
                rows += 1
                identity = {'database': name, 'store': store, 'role': role, 'keyType': 'string',
                            'key': key, 'id': key}
                seal = {'projectionBytes': len(projection), 'projectionSha256': sha256(projection).hexdigest(),
                        'cloneBytes': len(descriptor), 'cloneSha256': sha256(descriptor).hexdigest()}
                frames.append((2, identity))
                for tag, content in [(3, projection), (4, descriptor)]:
                    step = 7 if split else 1024*1024
                    frames.extend((tag, content[n:n+step]) for n in range(0, len(content), step))
                frames.append((5, seal))
    footer = {'rows': rows, 'snapshotContentId': '', 'source': source}
    frames.append((255, footer))
    if change:
        change(frames)
    content = sha256(b'RLIDB001/content/v1\0')
    for tag, payload in frames:
        if tag in (16, 2, 5):
            content.update(frame(tag, payload))
    if not footer['snapshotContentId']:
        footer['snapshotContentId'] = content.hexdigest()
    return b'RLIDB001' + b''.join(frame(tag, payload) for tag, payload in frames)


def verify(data, expected_sha=None, frozen=False):
    return verifier.read_archive(BytesIO(data), expected_sha or sha256(data).hexdigest(), None, None, frozen)


def mutate(tag, fn, index=0):
    return lambda frames: fn([payload for n, payload in frames if n == tag][index])


def rows_with(projection, clone=None):
    row = data_row('a', projection, clone)
    return {('dataset', 'datasets'): [row], ('dataset', 'summaries'): [row]}


class ArchiveTests(unittest.TestCase):
    def test_fixed_rule_hash_and_bytes(self):
        data = snapshot({('rule', 'versions'): [data_row(RULE['id'], RULE)]}, split=True)
        self.assertEqual(verify(data, frozen=True)['frozenRule']['recordHash'], RULE['recordHash'])
        tampered = {**RULE, 'name': 'other'}
        with self.assertRaisesRegex(ValueError, 'frozen recordHash'):
            verify(snapshot({('rule', 'versions'): [data_row(RULE['id'], tampered)]}), frozen=True)
        with self.assertRaisesRegex(ValueError, 'missing frozen'):
            verify(snapshot({}), frozen=True)

    def test_empty_layout_and_physical_integrity(self):
        data = snapshot({})
        result = verify(data)
        self.assertEqual(result['rows'], 0)
        self.assertEqual(result['snapshotContentId'], '79b2d398efb5e51f07034a9be772035387f6a9c293ab1d2674c6742a932a826d')
        self.assertEqual(len(result['source']['databases']), 9)
        self.assertEqual(sum(len(d['stores']) for d in result['source']['databases']), 17)
        for candidate in (data[:-1], data[:50], data + b'\x00', b'RLIDB002' + data[8:],
                          data[:8] + frame(2, {}) + data[8:],
                          data[:8] + b'\x01' + (2**63).to_bytes(8, 'big') + data[17:]):
            with self.subTest(size=len(candidate)), self.assertRaises(ValueError):
                verify(candidate)
        with self.assertRaisesRegex(ValueError, 'external SHA'):
            verify(data, 'f'*64)

    def test_layout_member_and_footer_forgery_even_with_fresh_outer_sha(self):
        rows = rows_with({'id': 'a'})
        changes = [
            mutate(16, lambda m: m['databases'].pop()),
            mutate(16, lambda m: m['databases'][0].update(version=True)),
            mutate(16, lambda m: m['databases'][0]['stores'][0].update(indexes=['fake'])),
            mutate(16, lambda m: m['databases'][0]['stores'][0].update(count=2)),
            mutate(2, lambda m: m.update(id='x')),
            mutate(2, lambda m: m.update(keyType='number')),
            mutate(5, lambda m: m.update(cloneBytes=0)),
            mutate(5, lambda m: m.update(projectionSha256='f'*64)),
            mutate(255, lambda m: m.update(rows=3)),
            mutate(255, lambda m: m.update(snapshotContentId='a'*64)),
            mutate(255, lambda m: m['source']['databases'][0]['stores'][0].update(count=0)),
            mutate(255, lambda m: m['source'].update(missingDatabases=['gone'])),
            mutate(255, lambda m: m['source'].update(barrierSequence=3)),
            mutate(255, lambda m: m['source']['databases'][0].update(completed=11)),
            mutate(255, lambda m: m['source'].update(origin='http://other')),
            mutate(255, lambda m: m['source'].update(finishedUtcMs=98)),
        ]
        for index, fn in enumerate(changes):
            with self.subTest(index=index), self.assertRaises(ValueError):
                verify(snapshot(rows, fn))

    def test_utf16_order_and_same_store_uniqueness(self):
        keys = ['a', '\U00010000', '\uffff']  # UTF-16 order differs from Unicode scalar order.
        rows = [data_row(key, {'id': key}) for key in keys]
        for bad_rows in ([rows[0], rows[0]], rows[::-1]):
            bad = {('rule', 'versions'): bad_rows}
            with self.assertRaisesRegex(ValueError, 'duplicate or out-of-order'):
                verify(snapshot(bad))
        self.assertEqual(verify(snapshot({('rule', 'versions'): rows}))['rows'], 3)
        with self.assertRaisesRegex(ValueError, 'orphan'):
            verify(snapshot({('dataset', 'datasets'): rows, ('dataset', 'summaries'): rows[1:]}))

    def test_lossless_sidecar_validated_against_exact_projection(self):
        clone = {'version': 1, 'objects': [
            {'path': ['source'], 'keys': ['url','x','expectedSha256'], 'undefinedKeys': ['url','expectedSha256']},
            {'path': ['quality','issues',0], 'keys': ['raw'], 'undefinedKeys': ['raw']},
        ], 'aliases': []}
        value = {'id': 'a', 'source': {'x': 'x'}, 'quality': {'issues': [{}]}}
        data = snapshot(rows_with(value, clone), split=True)
        result = verify(data)
        self.assertNotEqual(result['snapshotContentId'], verify(snapshot(rows_with(value)))['snapshotContentId'])
        # Chunk boundaries affect the physical digest, not the stable content ID.
        self.assertEqual(result['snapshotContentId'], verify(snapshot(rows_with(value, clone)))['snapshotContentId'])
        variants = [
            lambda c: c['objects'].reverse(),
            lambda c: c['objects'].append(copy.deepcopy(c['objects'][0])),
            lambda c: c['objects'][0].update(keys=['x','url','url']),
            lambda c: c['objects'][0].update(undefinedKeys=['expectedSha256','url']),
            lambda c: c['objects'][0].update(path=['source','__proto__']),
            lambda c: c['objects'][1].update(path=['quality','issues',1]),
            lambda c: c['objects'][0].update(keys=['url','expectedSha256']),
        ]
        for index, change in enumerate(variants):
            copy_clone = copy.deepcopy(clone)
            change(copy_clone)
            with self.subTest(index=index), self.assertRaises(ValueError):
                verify(snapshot(rows_with(value, copy_clone)))

    def test_aliases_require_prior_identical_trees_and_safe_paths(self):
        value = {'id': 'a', 'a': [{'x': 1, 'y': True}], 'b': [{'x': 1, 'y': True}]}
        def verify_alias(aliases, data=value):
            return verify(snapshot(rows_with(data, {**EMPTY, 'aliases': [
                {'path': path, 'target': target} for path, target in aliases
            ]})))
        valid = [(['b'], ['a'])]
        self.assertNotEqual(verify_alias(valid)['snapshotContentId'], verify_alias([])['snapshotContentId'])
        cases = [
            [(['a'], ['b'])], [(['b'], ['id'])], [(['a', 0], ['a'])], [(['a'], [])],
            [(['b'], ['a']), (['b', 0], ['a', 0])], [(['b'], ['a']), (['b'], ['a'])],
            [(['b'], ['__proto__'])], [(['b', 0], ['a', '0'])],
        ]
        for aliases in cases:
            with self.subTest(aliases=aliases), self.assertRaises(ValueError):
                verify_alias(aliases)
        for wrong in ([{'x': True, 'y': True}], [{'y': True,'x': 1}], [], [{'x': 2,'y': True}]):
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                verify_alias(valid, {**value, 'b': wrong})

    def test_undefined_inside_alias_needs_a_permitted_destination(self):
        value = {'id': 'a', 'source': {}, 'other': {}}
        clone = {'version': 1,
                 'objects': [{'path': ['source'], 'keys': ['url'], 'undefinedKeys': ['url']}],
                 'aliases': [{'path': ['other'], 'target': ['source']}]}
        with self.assertRaisesRegex(ValueError, 'unsupported undefined'):
            verify(snapshot(rows_with(value, clone)))

    def test_real_member_limits_before_json_allocation(self):
        # Reuse one immutable block rather than constructing a 256 MiB test file.
        class Frames:
            def __init__(self, tag, extra):
                self.tag = tag
                self.extra = extra
            def next_frame(self):
                if self.extra:
                    self.extra -= 1
                    return self.tag, block
                return 5, b'{}'
        class Discard:
            def write(self, data):
                pass
        block = bytes(1024 * 1024)
        for tag, limit in [(3, 20), (3, 256), (4, 20)]:
            with self.subTest(tag=tag, limit=limit), self.assertRaisesRegex(ValueError, 'byte budget'):
                verifier.collect_chunks(Frames(tag, limit), (tag, block), tag, limit*len(block), Discard())

    def test_json_types_and_nesting_limits(self):
        for raw_value in (b'{"id":"a","x":-0}', b'{"id":"a","x":-0.0}', b'{"id":"a","x":1e999}',
                          b'{"id":"a","x":1e-999}', b'{"id":"a","x":9007199254740993}',
                          b'{"id":"a","x":1.0000000000000001}', b'{"id":"a","id":"a"}', b'{"id":"a","x":"\xff"}',
                          b'{"id":"a","prototype":{}}', b'{"id":"a","x":{"9":9,"2":2}}',
                          b'{"id":"a","x":'+b'['*65 + b'0'+b']'*65+b'}'):
            with self.subTest(raw=raw_value), self.assertRaises(ValueError):
                verify(snapshot(rows_with(raw_value)))

    def test_new_output_only_and_raw_members(self):
        value = {'id': 'a', 'source': {'kind': '人工 合成'}}
        data = snapshot(rows_with(value))
        with tempfile.TemporaryDirectory() as test:
            root = Path(test)
            archive = root/'合成 文件.rlidb'
            archive.write_bytes(data)
            directory = root/'decoded'
            manifest = root/'inventory.json'
            digest = sha256(data).hexdigest()
            with self.assertRaisesRegex(ValueError, 'external SHA'):
                verifier.run(archive, '0'*64, manifest, directory)
            self.assertEqual(list(root.iterdir()), [archive])
            verifier.run(archive, digest, manifest, directory)
            self.assertEqual((directory/'00000001.projection.json').read_bytes(), raw(value))
            self.assertEqual((directory/'00000001.clone.json').read_bytes(), raw(EMPTY))
            receipt = json.loads(manifest.read_text())
            self.assertEqual(manifest.read_bytes(), (directory/'manifest.json').read_bytes())
            self.assertEqual([m['role'] for m in receipt['members']], ['body','summary'])
            with self.assertRaisesRegex(ValueError, 'already exists'):
                verifier.run(archive, digest, manifest, directory)


if __name__ == '__main__':
    unittest.main()
