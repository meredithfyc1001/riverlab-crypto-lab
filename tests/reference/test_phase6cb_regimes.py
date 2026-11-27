"""Historical report bytes are inputs under test; the Python reference regenerates their entire result.

The three synthetic reports were sealed with the original Phase 6C-A engine
(e0d3476344aa667b6a2bfc4e9b41b89ccc11292a) from the frozen 5C-A/5C-B
sources in tests/fixtures, reference asset BBB/USDT, lookback 2 and 500 bps.
"""
from contextlib import closing
from copy import deepcopy
import gzip
import json
from pathlib import Path
import sqlite3
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'phase6c'))
from historical_reference import check_history
from reference_ledger import historical_hash


def load(name):
    with gzip.open(ROOT / 'tests' / 'fixtures' / name, 'rt', encoding='utf-8') as source:
        return json.load(source)


class PortfolioRegimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.samples = load('phase-6c-b-regime-synthetic.json.gz')

    def test_independent_allocation_and_full_attribution(self):
        for sample in self.samples:
            report = sample['report']
            source = load(sample['file'])
            with self.subTest(report=report['id']), closing(sqlite3.connect(':memory:')) as db:
                db.execute('CREATE TABLE records(kind TEXT,id TEXT,body TEXT)')
                # Embedded-only replay has no physical source report or stored fills to copy.
                replay = check_history('regime', report, db)
                self.assertEqual(replay['sourceResolution'], 'embedded')
                kind = 'portfolio' if report['source']['kind'] == 'portfolio' else 'shared_pool'
                db.execute('INSERT INTO records VALUES(?,?,?)', (kind, source['id'], json.dumps(source)))
                self.assertEqual(check_history('regime', report, db)['sourceResolution'], 'physical+embedded')

    def test_resealed_forgery_and_wrong_reference(self):
        for sample in self.samples:
            for field in ('exposure', 'reference', 'version'):
                record = deepcopy(sample['report'])
                with self.subTest(report=record['id'], field=field), closing(sqlite3.connect(':memory:')) as db:
                    db.execute('CREATE TABLE records(kind TEXT,id TEXT,body TEXT)')
                    if field == 'exposure':
                        record['result']['summaries'][0]['exposedMs'] += 1
                    elif field == 'reference':
                        record['reference'] = 'unavailable-synthetic-symbol'
                    else:
                        record['source']['versions']['algorithm'] += '-unknown'
                    del record['reportHash']
                    record['reportHash'] = historical_hash(record)
                    with self.assertRaises(ValueError):
                        check_history('regime', record, db)


if __name__ == '__main__':
    unittest.main()
