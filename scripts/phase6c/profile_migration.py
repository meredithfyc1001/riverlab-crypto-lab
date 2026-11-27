"""Profile isolated synthetic RLIDB001 -> SQLite candidates, including subprocess memory."""

import argparse
import csv
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def processes():
    if os.name == "nt":
        command = [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1} {2}" -f '
            "$_.ProcessId,$_.ParentProcessId,[int64]($_.WorkingSetSize/1024) }",
        ]
    else:
        command = ["ps", "-A", "-o", "pid=,ppid=,rss="]
    rows = subprocess.check_output(command, text=True).splitlines()
    tree = {}
    for row in rows:
        pid, parent, rss = map(int, row.split())
        tree.setdefault(parent, []).append((pid, rss))
    return tree


def tree_rss_kib(pid):
    tree = processes()
    descendants = {pid}
    pending = [pid]
    while pending:
        for child, _ in tree.get(pending.pop(), []):
            if child not in descendants:
                descendants.add(child)
                pending.append(child)
    resident = [
        rss
        for entries in tree.values()
        for child, rss in entries
        if child in descendants
    ]
    return sum(resident), len(resident)


def measured(command, logfile):
    start = time.perf_counter()
    peak = samples = 0
    sample_path = logfile.with_suffix(".rss.csv")
    with logfile.open("x", encoding="utf-8") as log, sample_path.open(
        "x", encoding="utf-8", newline=""
    ) as samples_file:
        trace = csv.writer(samples_file)
        trace.writerow(["elapsed_ms", "process_count", "rss_kib"])
        proc = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            while proc.poll() is None:
                rss, count = tree_rss_kib(proc.pid)
                trace.writerow(
                    [round((time.perf_counter() - start) * 1000, 3), count, rss]
                )
                peak = max(peak, rss)
                samples += 1
                try:
                    proc.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    pass
        except BaseException:
            proc.terminate()
            proc.wait()
            raise
    return {
        "exitCode": proc.returncode,
        "wallMs": round((time.perf_counter() - start) * 1000, 3),
        "sampledPeakProcessTreeRssKiB": peak,
        "rssSamples": samples,
        "log": logfile.name,
        "rssTrace": sample_path.name,
    }


def profile_migration(archive, sha, folder, fault):
    candidate = folder / ("rollback" if fault else "candidate")
    if fault:
        command = [
            sys.executable,
            "-B",
            __file__,
            "_fault_worker",
            str(archive),
            sha,
            str(candidate),
        ]
    else:
        command = [
            sys.executable,
            "-B",
            str(HERE / "migrate_candidate.py"),
            str(archive),
            "--sha256",
            sha,
            "--candidate-dir",
            str(candidate),
        ]
    process = measured(command, folder / ("rollback.log" if fault else "migration.log"))
    receipt_path = candidate / ("failure.json" if fault else "candidate.json")
    receipt = read_json(receipt_path) if receipt_path.is_file() else {}
    if fault:
        ok = (
            process["exitCode"] != 0
            and receipt.get("transaction") == "rolled-back"
            and receipt.get("sourceUnchanged") is True
            and not (candidate / "candidate.json").exists()
        )
    else:
        ok = process["exitCode"] == 0 and receipt.get("status") == "READY"
    return {"status": "PASS" if ok else "FAIL", "process": process, "receipt": receipt}


def fault_worker(archive, sha, destination):
    import migrate_candidate

    def duplicate(event, _path, connection):
        if event == "after_row":
            connection.execute("INSERT INTO records SELECT * FROM records LIMIT 1")

    migrate_candidate.migrate(Path(archive), sha, Path(destination), observer=duplicate)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--snapshot",
        required=True,
        type=Path,
        help="supplied isolated nine-library snapshot",
    )
    parser.add_argument(
        "--sha256", required=True, help="trusted external digest for --snapshot"
    )
    parser.add_argument("--output-dir", required=True, type=Path, help="new directory")
    names = ["small", "large-report", "near-capacity", "retry", "codec"]
    parser.add_argument("--profiles", nargs="+", choices=names, default=names)
    parser.add_argument(
        "--generated-dir",
        type=Path,
        help="reuse source archives from a completed generator run",
    )
    args = parser.parse_args()
    root = args.output_dir.resolve()
    root.mkdir()
    result = {
        "scope": "isolated synthetic datasets and historical reports",
        "os": platform.platform(),
        "python": platform.python_version(),
        "rssMeasurement": "Maximum sampled sum of root and descendant working sets (KiB); shared pages can be counted more than once, short peaks can be missed. Poll gap 100ms plus process enumeration time.",
        "profiles": {},
    }
    for name in args.profiles:
        directory = root / name
        directory.mkdir()
        record = {}
        result["profiles"][name] = record
        try:
            if name == "codec":
                run = measured(
                    ["node", "scripts/profile-snapshot-codec.mjs"],
                    directory / "codec.log",
                )
                record.update(
                    process=run,
                    check="standalone encoder limits; no SQLite migration",
                    status="PASS" if run["exitCode"] == 0 else "FAIL",
                )
            else:
                source = args.snapshot.resolve()
                sha = args.sha256
                if name in ("large-report", "near-capacity"):
                    if args.generated_dir:
                        exported = args.generated_dir.resolve() / name / "source"
                    else:
                        exported = directory / "source"
                        generation = measured(
                            [
                                "node",
                                str(HERE / "generate-performance.mjs"),
                                name,
                                str(exported),
                            ],
                            directory / "export.log",
                        )
                        record["generation"] = generation
                        if generation["exitCode"] != 0:
                            raise RuntimeError(
                                "Synthetic source export failed; see export.log"
                            )
                    info = read_json(exported / "export.json")
                    record["export"] = info
                    source = exported / "synthetic.riverlab-migration"
                    sha = info["receipt"]["fileSha256"]
                record.update(sourceSha256=sha, archiveBytes=source.stat().st_size)
                if name == "retry":
                    record["rollback"] = profile_migration(source, sha, directory, True)
                record["migration"] = profile_migration(source, sha, directory, False)
                statuses = [
                    v["status"]
                    for k, v in record.items()
                    if k in ("rollback", "migration")
                ]
                record["status"] = (
                    "PASS" if all(x == "PASS" for x in statuses) else "FAIL"
                )
        except Exception as error:
            record.update(status="FAIL", error=str(error))
        write_json(root / "performance.json", result)
        print(name, record["status"], flush=True)
    return int(any(value["status"] != "PASS" for value in result["profiles"].values()))


if __name__ == "__main__":
    if sys.argv[1:2] == ["_fault_worker"]:
        fault_worker(*sys.argv[2:])
    else:
        raise SystemExit(main())
