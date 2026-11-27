"""Destructive migration tests restricted to copies of the frozen 6C-A synthetic export.

    python tests/reference/test_phase6cb_faults.py --snapshot SYNTHETIC_FILE \
        --sha256 EXTERNAL_SHA256 --report faults.json

The regular CLI handles archive failures and every retry. A separate child invokes
that same importer with a library observer to cause real filesystem/SQLite faults.
"""

import argparse
from contextlib import closing, contextmanager, nullcontext
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "scripts/phase6c/migrate_candidate.py"
SYNTHETIC_CONTENT_ID = (
    "da5a03bb410c69b46803e712fe4f715f7d80974f790f9965247d7a6e40d54fae"
)


def need(ok, message):
    if not ok:
        raise AssertionError(message)


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def framed(tag, data):
    return struct.pack(">BQ", tag, len(data)) + data


def fixture_frames(archive):
    # Frame editor for this known 149 KiB fixture only. The production migration
    # and its eligibility decision always use the official complete reader.
    need(
        archive[:8] == b"RLIDB001" and len(archive) < 2**20,
        "unexpected synthetic fixture",
    )
    frames = []
    cursor = 8
    while cursor < len(archive):
        tag, count = struct.unpack_from(">BQ", archive, cursor)
        cursor += 9
        need(0 < count <= len(archive) - cursor, "invalid fixture frame")
        frames.append((tag, archive[cursor : cursor + count]))
        cursor += count
    need(
        frames[-1][0] == 255
        and json.loads(frames[-1][1])["snapshotContentId"] == SYNTHETIC_CONTENT_ID,
        "fault suite accepts only the complete frozen 6C-A synthetic fixture",
    )
    return frames


def sealed(frames):
    digest = sha256(b"RLIDB001/content/v1\0")
    for tag, data in frames:
        if tag in (16, 2, 5):
            digest.update(framed(tag, data))
    footer = json.loads(frames[-1][1])
    footer["snapshotContentId"] = digest.hexdigest()
    return (
        b"RLIDB001"
        + b"".join(framed(tag, data) for tag, data in frames[:-1])
        + framed(255, compact(footer))
    )


def row_start(frames, **selection):
    return next(
        i
        for i, (tag, data) in enumerate(frames)
        if tag == 2
        and all(json.loads(data)[field] == value for field, value in selection.items())
    )


def duplicate_rule(frames, conflict):
    start = row_start(frames, store="versions")
    end = next(i for i in range(start + 1, len(frames)) if frames[i][0] == 5)
    duplicate = frames[start : end + 1]
    if conflict:
        # The second row is a well-formed, resealed historical rule with the
        # same ID and a different name. Both original rows remain in the file.
        record = json.loads(b"".join(data for tag, data in duplicate if tag == 3))
        record["name"] += " synthetic conflict"
        preimage = {k: v for k, v in record.items() if k != "recordHash"}
        record["recordHash"] = sha256(
            json.dumps(
                preimage, ensure_ascii=True, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        projection = compact(record)
        seal = json.loads(duplicate[-1][1])
        seal.update(
            projectionBytes=len(projection),
            projectionSha256=sha256(projection).hexdigest(),
        )
        duplicate = [
            duplicate[0],
            (3, projection),
            *(p for p in duplicate if p[0] == 4),
            (5, compact(seal)),
        ]
    frames[end + 1 : end + 1] = duplicate
    layout, footer = json.loads(frames[1][1]), json.loads(frames[-1][1])
    for databases in (layout["databases"], footer["source"]["databases"]):
        next(d for d in databases if d["kind"] == "rule")["stores"][0]["count"] += 1
    footer["rows"] += 1
    frames[1], frames[-1] = (16, compact(layout)), (255, compact(footer))


def broken_archives(archive, frames):
    yield "truncated", archive[:-1], "unexpected end|truncat"
    yield "external-sha", archive, "external SHA|file SHA|package SHA"
    yield "unknown-frame", archive[:8] + b"\x8e" + archive[9:], "unknown frame"
    yield (
        "frame-length",
        archive[:9] + struct.pack(">Q", 2**20 + 1) + archive[17:],
        "frame length",
    )
    for name, change, expected in [
        ("missing-database", lambda ds: ds.pop(), "incomplete database"),
        ("missing-store", lambda ds: ds[0]["stores"].pop(), "incomplete store"),
        (
            "unknown-schema",
            lambda ds: ds[0].update(version=99),
            "unknown database version",
        ),
    ]:
        edited = frames.copy()
        layout = json.loads(edited[1][1])
        footer = json.loads(edited[-1][1])
        for databases in (layout["databases"], footer["source"]["databases"]):
            change(databases)
        edited[1], edited[-1] = (16, compact(layout)), (255, compact(footer))
        yield name, sealed(edited), expected
    for conflict in (False, True):
        edited = frames.copy()
        duplicate_rule(edited, conflict)
        yield (
            ("id-conflict" if conflict else "duplicate-id"),
            sealed(edited),
            ("conflict" if conflict else "duplicate"),
        )
    for role in ("body", "summary"):
        edited = frames.copy()
        i = row_start(edited, role=role) + 1
        tag, data = edited[i]
        need(
            tag == 3 and len(data) > 3, "fixture member does not begin with projection"
        )
        # Preserve a valid external digest; the specific member seal must fail.
        edited[i] = (tag, data[:-1] + bytes([data[-1] ^ 1]))
        yield f"corrupt-{role}", sealed(edited), "member length or SHA-256 mismatch"

    for name, selection in [
        ("stale-business-hash", {"store": "versions"}),
        ("resealed-wrong-summary", {"role": "summary"}),
    ]:
        edited = frames.copy()
        start = row_start(edited, **selection)
        end = next(i for i in range(start + 1, len(edited)) if edited[i][0] == 5)
        record = json.loads(
            b"".join(data for tag, data in edited[start + 1 : end] if tag == 3)
        )
        record["name"] += " synthetic tamper"
        projection = compact(record)
        seal = json.loads(edited[end][1])
        seal.update(
            projectionBytes=len(projection),
            projectionSha256=sha256(projection).hexdigest(),
        )
        edited[start + 1 : end + 1] = [
            (3, projection),
            *(v for v in edited[start + 1 : end] if v[0] == 4),
            (5, compact(seal)),
        ]
        yield (
            name,
            sealed(edited),
            (
                "hash|哈希|摘要|校验和"
                if name == "stale-business-hash"
                else "summary|摘要"
            ),
        )


def write_json(path, obj):
    with path.open("x", encoding="utf-8") as out:
        json.dump(obj, out, indent=2, ensure_ascii=False)
        out.write("\n")


def inject(name, archive, digest, target, evidence):
    sys.path.insert(0, str(CLI.parent))
    from migrate_candidate import migrate

    held = []
    rollback_sql = []

    def observer(event, path, conn):
        if name == "cancel" and event == "after_row":
            need(
                conn.in_transaction
                and conn.execute("SELECT count(*) FROM records").fetchone()[0] == 1,
                "cooperative cancellation did not interrupt a populated transaction",
            )
            conn.set_trace_callback(rollback_sql.append)
            raise KeyboardInterrupt(
                "synthetic cancellation after first imported record"
            )
        if name == "process-kill" and event == "before_begin":
            # Allocate a valid pre-transaction header and force dirty-page spill.
            conn.execute("PRAGMA user_version=0")
            conn.execute("PRAGMA cache_size=1")
            conn.execute("PRAGMA cache_spill=ON")
        if (name in ("sqlite-lock", "write-denied") and event == "before_begin") or (
            name == "sqlite-full" and event == "after_row" and not evidence.exists()
        ):
            if name == "sqlite-lock":
                blocker = sqlite3.connect(path, isolation_level=None)
                blocker.execute("BEGIN IMMEDIATE")
                held.append(blocker)
                conn.execute("PRAGMA busy_timeout=100")
                detail = "competing connection holds BEGIN IMMEDIATE"
            elif name == "sqlite-full":
                pages = conn.execute("PRAGMA page_count").fetchone()[0]
                actual = conn.execute(f"PRAGMA max_page_count={pages}").fetchone()[0]
                need(actual == pages, "SQLite page cap not installed")
                detail = f"max_page_count={pages}, zero additional pages permitted"
            else:
                conn.execute("PRAGMA query_only=ON")
                need(
                    conn.execute("PRAGMA query_only").fetchone() == (1,),
                    "writer still has write permission",
                )
                detail = "SQLite writer permission denied by PRAGMA query_only"
            write_json(evidence, {"event": event, "detail": detail})
        if name == "process-kill" and event == "after_row" and not evidence.exists():
            need(conn.in_transaction, "child row is already committed")
            count = conn.execute("SELECT count(*) FROM records").fetchone()[0]
            need(count > 0, "child has not inserted any records")
            journal = Path(str(path) + "-journal")
            need(
                journal.is_file() and journal.stat().st_size > 512,
                "missing rollback journal before kill",
            )
            pending = evidence.with_suffix(".pending")
            write_json(
                pending,
                {
                    "event": event,
                    "rowsVisibleInsideTransaction": count,
                    "databaseBytesBeforeKill": Path(path).stat().st_size,
                    "journalBytesBeforeKill": journal.stat().st_size,
                },
            )
            pending.rename(evidence)
            # The parent kills the process. EOF or timeouts cannot simulate it.
            time.sleep(240)
            raise RuntimeError("parent did not kill the child")
        if name == "schema-drift" and event == "before_integrity":
            with closing(sqlite3.connect(path)) as drift:
                before = drift.execute(
                    "SELECT kind,id,summary FROM summaries ORDER BY kind,id"
                ).fetchall()
                drift.executescript("""BEGIN IMMEDIATE;
                    ALTER TABLE summaries RENAME TO original;
                    CREATE TABLE summaries(kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL) STRICT;
                    INSERT INTO summaries SELECT kind,id,summary FROM original;
                    DROP TABLE original;
                    COMMIT;""")
                need(
                    before
                    == drift.execute(
                        "SELECT kind,id,summary FROM summaries ORDER BY kind,id"
                    ).fetchall(),
                    "drift injection changed the row bytes",
                )
                need(
                    drift.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
                    "unexpected SQLite corruption",
                )
                aid, version = (
                    drift.execute(f"PRAGMA {field}").fetchone()[0]
                    for field in ("application_id", "user_version")
                )
                need(
                    aid == 0x52564C42 and version == 1,
                    "drift fixture schema identity changed",
                )
                need(
                    not any(r[5] for r in drift.execute("PRAGMA table_info(summaries)"))
                    and drift.execute("PRAGMA foreign_key_list(summaries)").fetchall()
                    == [],
                    "drift fixture still enforces primary or foreign keys",
                )
            write_json(
                evidence,
                {
                    "event": event,
                    "rowsPreserved": len(before),
                    "applicationId": aid,
                    "userVersion": version,
                    "sqliteIntegrityCheck": "ok",
                    "missingConstraints": [
                        "summaries primary key",
                        "summaries foreign key",
                    ],
                },
            )
        if name == "integrity-check" and event == "before_integrity":
            # SQLite's file format stores the freelist page count at byte 36.
            # The catalog and all rows stay readable, but integrity_check must
            # reject the mismatch between the recorded and traversed lengths.
            with Path(path).open("r+b") as out:
                need(
                    out.read(16) == b"SQLite format 3\x00",
                    "invalid synthetic SQLite header",
                )
                out.seek(36)
                pages = struct.unpack(">I", out.read(4))[0]
                out.seek(36)
                out.write(struct.pack(">I", pages + 1))
                out.flush()
                os.fsync(out.fileno())
            with closing(
                sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True)
            ) as damaged:
                detected = damaged.execute("PRAGMA integrity_check").fetchall()
                need(
                    "freelist" in str(detected).lower(),
                    "cold SQLite reader did not detect the injected fault",
                )
            write_json(evidence, {"event": event, "integrityCheck": detected})
        if name == "restore-check" and event == "before_restore_check":
            with Path(path).open("r+b") as out:
                need(
                    out.read(16) == b"SQLite format 3\x00",
                    "injection target is not the synthetic SQLite file",
                )
                out.seek(0)
                out.write(b"Fault fixture v1")
                out.flush()
                os.fsync(out.fileno())
            write_json(
                evidence,
                {"event": event, "detail": "overwrote the 16-byte SQLite header"},
            )

    @contextmanager
    def watch_cancelled_writer():
        connect = sqlite3.connect
        db_path = target / ".staging" / "research.sqlite"

        class ObservedWriter(sqlite3.Connection):
            def rollback(self):
                # Forward the real DB-API operation. A separate connection sees
                # the post-ROLLBACK file while the candidate still owns staging.
                super().rollback()
                need(
                    not self.in_transaction and "ROLLBACK" in rollback_sql,
                    "SQLite did not roll back",
                )
                rows = cold_rows(db_path, allow_rolled_back_schema=True)
                need(
                    rows == {"records": 0, "summaries": 0},
                    "partial rows after cancellation",
                )
                write_json(
                    evidence,
                    {
                        "event": "after_rollback",
                        "signal": "KeyboardInterrupt",
                        "rollbackSql": rollback_sql,
                        "rowsBeforeCancel": 1,
                        "coldRowsAfterRollback": rows,
                    },
                )

        def open_writer(database, *args, **kwargs):
            # Only the production writer gets a forwarding observer. The cold
            # reader and every other connection use the unmodified sqlite3 API.
            if database == db_path and kwargs.get("isolation_level", "") is None:
                kwargs["factory"] = ObservedWriter
            return connect(database, *args, **kwargs)

        with patch.object(sqlite3, "connect", open_writer):
            yield

    try:
        with watch_cancelled_writer() if name == "cancel" else nullcontext():
            migrate(archive, digest, target, observer=observer)
    except (Exception, KeyboardInterrupt) as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        for conn in held:
            conn.close()
    return 0


def cli(archive, digest, target):
    return [
        sys.executable,
        "-X",
        "utf8",
        str(CLI),
        str(archive),
        "--sha256",
        digest,
        "--candidate-dir",
        str(target),
    ]


def kill_after_insert(cmd, evidence):
    with subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        cwd=ROOT,
    ) as proc:
        try:
            deadline = time.monotonic() + 160
            while (
                not evidence.exists()
                and proc.poll() is None
                and time.monotonic() < deadline
            ):
                time.sleep(0.025)
            need(
                evidence.exists() and proc.poll() is None,
                "child did not reach live transaction",
            )
            proc.kill()
            output = proc.communicate(timeout=30)[0]
            return proc.returncode, output
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()


def cold_rows(path, allow_rolled_back_schema=False):
    # Read-write open permits SQLite itself to recover an interrupted journal.
    # This is *only* called on SQLite candidates in the suite's own temp tree.
    with closing(sqlite3.connect(path)) as db:
        need(
            db.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
            "integrity check after reopen failed",
        )
        names = set(
            name
            for (name,) in db.execute(
                "SELECT name FROM sqlite_schema WHERE type='table'"
            )
        )
        if allow_rolled_back_schema and not names:
            return {"records": 0, "summaries": 0}
        return {
            table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("records", "summaries")
        }


def canary_hash(path):
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        need(
            db.execute("SELECT value FROM sentinel").fetchall()
            == [("synthetic formal database",)],
            "formal canary changed",
        )
    return sha256(path.read_bytes()).hexdigest()


@contextmanager
def deny_directory_writes(directory):
    # Only the fresh per-case parent is affected. Windows ACLs are restored
    # even if spawning the candidate process fails.
    if os.name == "nt":
        sid = subprocess.check_output(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
            ],
            text=True,
        ).strip()
        need(
            re.fullmatch(r"S-1-[0-9-]+", sid),
            "cannot identify current Windows test SID",
        )
        principal = "*" + sid
        subprocess.run(
            ["icacls", str(directory), "/deny", principal + ":(WD,AD)"],
            check=True,
            capture_output=True,
        )
        try:
            yield
        finally:
            subprocess.run(
                ["icacls", str(directory), "/remove:d", principal],
                check=True,
                capture_output=True,
            )
    else:
        saved = directory.stat().st_mode & 0o777
        directory.chmod(0o500)
        try:
            need(
                not os.access(directory, os.W_OK),
                "run filesystem denial test as an ordinary user",
            )
            yield
        finally:
            directory.chmod(saved)


def run_suite(archive_path, expected_sha, report_path):
    archive = archive_path.read_bytes()
    need(
        sha256(archive).hexdigest() == expected_sha,
        "supplied synthetic fixture does not match external receipt",
    )
    frames = fixture_frames(archive)
    results = []
    with tempfile.TemporaryDirectory(
        prefix="riverlab-synthetic-migration-fault-"
    ) as temporary:
        root = Path(temporary)
        source = root / "healthy.riverlab-migration"
        source.write_bytes(archive)
        canary = root / "synthetic-formal" / "research.sqlite3"
        canary.parent.mkdir()
        with closing(sqlite3.connect(canary)) as db:
            db.execute("CREATE TABLE sentinel(value TEXT NOT NULL)")
            db.execute("INSERT INTO sentinel VALUES ('synthetic formal database')")
            db.commit()
        canary_before = canary_hash(canary)
        faults = list(broken_archives(archive, frames))
        faults.extend(
            (name, None, expected)
            for name, expected in [
                (
                    "filesystem-write-denied",
                    "PermissionError|Permission denied|Access is denied",
                ),
                ("sqlite-lock", "database is locked|SQLITE_BUSY"),
                ("write-denied", "readonly|read.only|SQLITE_READONLY"),
                ("sqlite-full", "database or disk is full|SQLITE_FULL"),
                ("cancel", "KeyboardInterrupt.*synthetic cancellation"),
                ("process-kill", ""),
                ("schema-drift", "schema|primary key|foreign key"),
                ("integrity-check", "SQLite integrity_check failed"),
                ("restore-check", "not a database|SQLITE_NOTADB"),
            ]
        )
        for name, malformed, expected_error in faults:
            directory = root / name
            directory.mkdir()
            target = directory / "failed-candidate"
            evidence = directory / "injection.json"
            selected, digest = source, expected_sha
            if malformed is not None:
                selected = directory / "synthetic-broken.riverlab-migration"
                selected.write_bytes(malformed)
                digest = sha256(malformed).hexdigest()
            selected_before = sha256(selected.read_bytes()).hexdigest()
            if name == "external-sha":
                digest = "0" * 64
            if malformed is None and name != "filesystem-write-denied":
                command = [
                    sys.executable,
                    "-X",
                    "utf8",
                    __file__,
                    "--inject",
                    name,
                    str(selected),
                    digest,
                    str(target),
                    str(evidence),
                ]
            else:
                command = cli(selected, digest, target)
            start = time.monotonic()
            if name == "process-kill":
                code, output = kill_after_insert(command, evidence)
            elif name == "filesystem-write-denied":
                with deny_directory_writes(directory):
                    child = subprocess.run(
                        command,
                        capture_output=True,
                        encoding="utf-8",
                        cwd=ROOT,
                        timeout=180,
                    )
                code, output = child.returncode, child.stdout + child.stderr
            else:
                child = subprocess.run(
                    command,
                    capture_output=True,
                    encoding="utf-8",
                    cwd=ROOT,
                    timeout=180,
                )
                code, output = child.returncode, child.stdout + child.stderr
            failed_ms = round(1000 * (time.monotonic() - start), 2)
            failure_path = target / "failure.json"
            failure = (
                json.loads(failure_path.read_text(encoding="utf-8"))
                if failure_path.is_file()
                else None
            )
            need(
                code != 0 and not (target / "candidate.json").exists(),
                f"{name} published or exited successfully",
            )
            if malformed is None and name != "filesystem-write-denied":
                need(
                    evidence.is_file(),
                    f"{name} never reached injection: {output[-1000:]}",
                )
            injection = (
                json.loads(evidence.read_text(encoding="utf-8"))
                if evidence.exists()
                else None
            )
            error = output.strip()[-1500:].replace(str(root), "<synthetic-test>")
            if name != "process-kill":
                if name != "filesystem-write-denied":
                    need(
                        failure is not None, f"{name} missing failure receipt: {error}"
                    )
                    reference_stage = {
                        "external-sha": "external-sha256",
                        "sqlite-lock": "sqlite-transaction",
                        "write-denied": "sqlite-transaction",
                        "sqlite-full": "sqlite-transaction",
                        "cancel": "sqlite-transaction",
                        "schema-drift": "sqlite-cold-read",
                        "integrity-check": "sqlite-cold-read",
                        "restore-check": "recovery",
                        "stale-business-hash": "historical-recomputation",
                        "resealed-wrong-summary": "historical-recomputation",
                    }.get(name, "decode-archive")
                    need(
                        failure["stage"] == reference_stage,
                        f"{name} failed at unexpected stage: {failure}",
                    )
                detail = failure or {}
                if name in ("stale-business-hash", "resealed-wrong-summary"):
                    kind = "rule" if name == "stale-business-hash" else "dataset"
                    detail = json.loads(
                        (target / "recomputation.json").read_text(encoding="utf-8")
                    )
                    bad_row = next(r for r in detail["records"] if r["kind"] == kind)
                    need(
                        bad_row.get("status") == "FAIL",
                        "forged history passed historical engine",
                    )
                    error += " / " + " / ".join(bad_row["errors"])
                    detail = {"errors": bad_row["errors"]}
                if name == "restore-check":
                    detail = json.loads(
                        (target / "recovery.json").read_text(encoding="utf-8")
                    )
                    error += " / " + str(detail.get("error", ""))
                need(
                    re.search(
                        expected_error,
                        error + json.dumps(detail, ensure_ascii=False),
                        re.I,
                    ),
                    f"{name} reached a different error: {error} {failure}",
                )
            else:
                error = f"child killed by parent, returncode {code}"
            counts = None
            db_path = target / "research.sqlite"
            staging_retained = (target / ".staging").exists()
            need(
                staging_retained == (name == "process-kill"),
                f"{name}: staging cleanup mismatch",
            )
            need(not db_path.exists(), f"{name}: failed database was published")
            if name == "process-kill":
                db_path = target / ".staging" / "research.sqlite"
            if db_path.exists() and name != "integrity-check":
                counts = cold_rows(db_path, allow_rolled_back_schema=True)
            if name == "cancel":
                need(
                    failure["transaction"] == "rolled-back",
                    "cancelled transaction missing rollback receipt",
                )
                counts = injection["coldRowsAfterRollback"]
            if name in (
                "sqlite-full",
                "sqlite-lock",
                "write-denied",
                "process-kill",
                "cancel",
            ):
                need(
                    counts in (None, {"records": 0, "summaries": 0}),
                    f"{name} left partially committed rows",
                )
            if name == "process-kill":
                need(
                    counts == {"records": 0, "summaries": 0},
                    "missing cold recovery evidence after kill",
                )
                recovered_digest = sha256(db_path.read_bytes()).hexdigest()
                same_dir = subprocess.run(
                    cli(source, expected_sha, target),
                    capture_output=True,
                    encoding="utf-8",
                    cwd=ROOT,
                    timeout=30,
                )
                need(
                    same_dir.returncode != 0
                    and not (target / "candidate.json").exists()
                    and sha256(db_path.read_bytes()).hexdigest() == recovered_digest,
                    "retry reused or overwrote the interrupted staging directory",
                )
            retries = directory / "retry-candidate"
            start = time.monotonic()
            retry = subprocess.run(
                cli(source, expected_sha, retries),
                capture_output=True,
                encoding="utf-8",
                cwd=ROOT,
                timeout=180,
            )
            retry_ms = round(1000 * (time.monotonic() - start), 2)
            need(
                retry.returncode == 0,
                f"{name}: healthy retry failed: {retry.stderr} {retry.stdout}",
            )
            marker = json.loads(
                (retries / "candidate.json").read_text(encoding="utf-8")
            )
            retry_counts = cold_rows(retries / "research.sqlite")
            need(
                marker["status"] == "READY"
                and retry_counts == {"records": 9, "summaries": 9},
                "retry mismatch",
            )
            need(
                sha256(selected.read_bytes()).hexdigest() == selected_before
                and sha256(source.read_bytes()).hexdigest() == expected_sha
                and sha256(archive_path.read_bytes()).hexdigest() == expected_sha,
                "source changed",
            )
            need(
                canary_hash(canary) == canary_before
                and list(canary.parent.iterdir()) == [canary],
                "formal DB touched",
            )
            results.append(
                {
                    "case": name,
                    "exit": code,
                    "actualError": error,
                    "injection": injection,
                    "failureReceipt": failure,
                    "failedMs": failed_ms,
                    "readyPublished": False,
                    "stagingDirectoryRetained": staging_retained,
                    "candidateFilePublished": False,
                    "transactionOutcome": (
                        failure["transaction"]
                        if failure
                        else (
                            "SQLite cold recovery rolled back"
                            if name == "process-kill"
                            else "not-started"
                        )
                    ),
                    "coldRowCountsAfterFailure": counts,
                    "sourceSha256Unchanged": True,
                    "injectedInputSha256Unchanged": True,
                    "formalCanarySha256Unchanged": True,
                    "retryStatus": marker["status"],
                    "retryCounts": retry_counts,
                    "retryMs": retry_ms,
                }
            )
            print(f"{name}: failed closed, healthy retry READY", flush=True)
    write_json(
        report_path,
        {
            "fixture": "frozen 6C-A synthetic 9-database / 17-store export",
            "sourceSha256": expected_sha,
            "formalCanarySha256": canary_before,
            "platform": platform.system(),
            "python": platform.python_version(),
            "sqlite": sqlite3.sqlite_version,
            "cases": results,
        },
    )


if __name__ == "__main__":
    if len(sys.argv) == 7 and sys.argv[1] == "--inject":
        sys.exit(
            inject(
                sys.argv[2],
                Path(sys.argv[3]),
                sys.argv[4],
                Path(sys.argv[5]),
                Path(sys.argv[6]),
            )
        )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    run_suite(args.snapshot, args.sha256, args.report)
