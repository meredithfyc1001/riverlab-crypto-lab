"""Independent, read-only check of a synthetic RLIDB001 snapshot and a cold SQLite candidate."""

import argparse
from collections import Counter
from contextlib import closing
from hashlib import sha256, file_digest
import json
from pathlib import Path
import sqlite3
import tempfile

import verify_bundle
from historical_reference import check_history

LAYOUT = {
    "riverlab-crypto-lab": ("dataset", "datasets"),
    "riverlab-crypto-lab-experiments": ("experiment", "experiments"),
    "riverlab-crypto-lab-rules": ("rule", "versions"),
    "riverlab-crypto-lab-replays": ("replay", "replays"),
    "riverlab-crypto-lab-risk": ("risk", "studies"),
    "riverlab-crypto-lab-portfolios": ("portfolio", "experiments"),
    "riverlab-crypto-lab-shared-pool": ("shared_pool", "experiments"),
    "riverlab-crypto-lab-market-regime": ("regime", "reports"),
    "riverlab-crypto-lab-advanced-research": ("advanced", "reports"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def cold_connection(path):
    connection = sqlite3.connect(Path(path).resolve(strict=True).as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.execute("BEGIN")
    return connection


def check_schema(db):
    tables = {
        "records": ("kind", "id", "body"),
        "summaries": ("kind", "id", "summary"),
        "migration_members": ("kind", "id", "role", "descriptor", "projection_sha256", "clone_sha256"),
    }
    for table, columns in tables.items():
        shape = db.execute(
            "SELECT type, wr, strict FROM pragma_table_list WHERE schema='main' AND name=?", (table,)
        ).fetchall()
        require(shape == [("table", 1, 1)], f"{table} requires STRICT WITHOUT ROWID")
        pk = 3 if table == "migration_members" else 2
        expected = [(name, "TEXT", 1, (i + 1 if i < pk else 0), 0) for i, name in enumerate(columns)]
        actual = db.execute(
            'SELECT name,type,"notnull",pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid', (table,)
        ).fetchall()
        require(actual == expected, f"{table} column/primary-key definition")
        coll = db.execute(
            "SELECT name,coll FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno", (table,)
        ).fetchall()
        require(coll == [(key, "BINARY") for key in columns[:pk]], f"{table} key collation")
        refs = db.execute(
            'SELECT id,seq,"table","from","to",on_delete FROM pragma_foreign_key_list(?) ORDER BY id,seq',
            (table,),
        ).fetchall()
        required = (
            []
            if table == "records"
            else [(0, i, "records", name, name, "CASCADE") for i, name in enumerate(("kind", "id"))]
        )
        require(refs == required, f"{table} foreign key definition")


def check_rows(directory, manifest, db, report):
    require(db.execute("PRAGMA application_id").fetchone() == (0x52564C42,), "application_id")
    require(db.execute("PRAGMA user_version").fetchone() == (1,), "user_version")
    check_schema(db)
    require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "SQLite integrity_check")
    require(not db.execute("PRAGMA foreign_key_check").fetchall(), "SQLite foreign_key_check")
    rows, bodies, summaries = set(), set(), set()
    counts = Counter()
    source_hashes = {}
    for member in manifest["members"]:
        kind, body_store = LAYOUT[member["database"]]
        role, key = member["role"], member["key"]
        store = body_store if role == "body" else "summaries"
        require(
            member["store"] == store and key == member["id"] and (kind != "rule" or role == "body"),
            "source store or inline id mismatch",
        )
        identity = (kind, key, role)
        require(identity not in rows, f"duplicate source key {identity}")
        rows.add(identity)
        counts[(kind, store)] += 1
        prefix = f"{member['row']:08d}"
        expected = (directory / (prefix + ".projection.json")).read_bytes()
        descriptor = (directory / (prefix + ".clone.json")).read_bytes()
        expected_sha = sha256(expected).hexdigest()
        clone_sha = sha256(descriptor).hexdigest()
        hashes = source_hashes.setdefault((kind, key), {"kind": kind, "id": key})
        hashes["bodySha256" if role == "body" else "summarySha256"] = expected_sha
        if kind == "rule":
            hashes["summarySha256"] = expected_sha
        detail = {
            "database": member["database"],
            "store": store,
            "kind": kind,
            "id": key,
            "role": role,
            "sourceProjectionSha256": expected_sha,
            "sourceCloneSha256": clone_sha,
        }
        report["members"].append(detail)
        table, column = ("records", "body") if role == "body" else ("summaries", "summary")
        stored = db.execute(
            f"SELECT CAST({column} AS BLOB) FROM {table} WHERE kind=? AND id=?", (kind, key)
        ).fetchall()
        extras = db.execute(
            "SELECT CAST(descriptor AS BLOB), projection_sha256, clone_sha256 "
            "FROM migration_members WHERE kind=? AND id=? AND role=?",
            identity,
        ).fetchall()
        require(len(stored) == 1 and len(extras) == 1, f"missing or duplicated SQLite key {identity}")
        actual = stored[0][0]
        actual_desc, saved_sha, saved_clone_sha = extras[0]
        detail.update(
            sqliteProjectionSha256=sha256(actual).hexdigest(),
            sqliteCloneSha256=sha256(actual_desc).hexdigest(),
        )
        require(
            expected == actual
            and descriptor == actual_desc
            and expected_sha == saved_sha == member["projectionSha256"]
            and clone_sha == saved_clone_sha == member["cloneSha256"],
            f"byte or SHA mismatch {identity}",
        )
        require(json.loads(actual)["id"] == key, f"SQLite internal id mismatch {identity}")
        if role == "body":
            bodies.add((kind, key))
            if kind == "rule":
                mirror = db.execute(
                    "SELECT CAST(summary AS BLOB) FROM summaries WHERE kind=? AND id=?", (kind, key)
                ).fetchall()
                require(mirror == [(actual,)], f"rule full revision mirror mismatch {key}")
                summaries.add((kind, key))
        else:
            summaries.add((kind, key))
        detail["status"] = "PASS"
    for table, keys in [("records", bodies), ("summaries", summaries)]:
        actual = db.execute(f"SELECT kind,id FROM {table}").fetchall()
        require(len(actual) == len(keys) and set(actual) == keys, f"{table} key inventory mismatch")
    actual = db.execute("SELECT kind,id,role FROM migration_members").fetchall()
    require(len(actual) == len(rows) and set(actual) == rows, "clone member key inventory mismatch")
    require(summaries == bodies, "body/summary pairing")
    report["records"] = [source_hashes[k] for k in sorted(source_hashes)]
    report["sqliteCounts"] = {
        "records": len(bodies),
        "summaries": len(summaries),
        "migration_members": len(rows),
    }
    report["sourceStores"] = [
        {"database": name, "kind": kind, "store": store, "rows": counts[kind, store]}
        for name, (kind, body_store) in LAYOUT.items()
        for store in ((body_store,) if kind == "rule" else (body_store, "summaries"))
    ]
    for kind, key in sorted(bodies):
        result = {"kind": kind, "id": key}
        try:
            value = json.loads(
                db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()[0]
            )
            result.update(check_history(kind, value, db), status="PASS")
        except (ValueError, ArithmeticError, TypeError, KeyError, IndexError, AssertionError) as err:
            result.update(status="FAIL", error=f"{type(err).__name__}: {err}")
        report["historicalChecks"].append(result)
    require(
        all(row["status"] == "PASS" for row in report["historicalChecks"]),
        "independent historical reference failed; see historicalChecks",
    )


def run(archive, expected_sha256, sqlite_path, report_path=None):
    report = {
        "format": "riverlab-python-candidate-check-v1",
        "status": "FAIL",
        "members": [],
        "historicalChecks": [],
    }
    try:
        with tempfile.TemporaryDirectory(prefix="riverlab-verify-candidate-") as tmp:
            directory = Path(tmp) / "decoded"
            verify_bundle.run(Path(archive), expected_sha256, decode_dir=directory)
            with (directory / "manifest.json").open(encoding="utf-8") as source:
                manifest = json.load(source)
            report.update(
                sourceSha256=manifest["packageSha256"],
                sourceRows=manifest["rows"],
                snapshotContentId=manifest["snapshotContentId"],
            )
            path = Path(sqlite_path).resolve(strict=True)

            def file_identity():
                for suffix in ("-wal", "-shm", "-journal"):
                    require(not Path(str(path) + suffix).exists(), "candidate has a live SQLite sidecar")
                st = path.stat()
                with path.open("rb") as contents:
                    digest = file_digest(contents, "sha256").hexdigest()
                return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, digest

            before = file_identity()
            with closing(cold_connection(path)) as db:
                check_rows(directory, manifest, db, report)
            require(file_identity() == before, "candidate changed during cold verification")
            report["candidateSha256"] = before[-1]
            report["status"] = "PASS"
    except (ValueError, OSError, sqlite3.Error, ArithmeticError, TypeError, KeyError, IndexError) as err:
        report["error"] = f"{type(err).__name__}: {err}"
    if report_path is not None:
        with Path(report_path).open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=True, indent=2, allow_nan=False)
            output.write("\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.archive, args.sha256, args.sqlite, args.report)
    print(json.dumps({k: result[k] for k in ("status", "sqliteCounts", "error") if k in result}))
    raise SystemExit(result["status"] != "PASS")
