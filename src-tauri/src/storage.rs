use rusqlite::{backup::NO_PROGRESS, Connection, OpenFlags, MAIN_DB};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{error::Error, fs, path::Path, time::Instant};

const FIXTURE: &[u8] = "6A 合成研究快照\n金额=100.000000000000000001\0\n".as_bytes();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEvidence {
    status: &'static str,
    sqlite_version: String,
    committed_rows: u32,
    rows_after_rollback: u32,
    restored_rows: u32,
    fixture_sha256: String,
    restored_payload_sha256: String,
    backup_file_sha256: String,
    integrity_check: String,
    elapsed_ms: u64,
}

// The caller selects only the disposable parent. Every file lives in a fresh
// private directory for this invocation, including SQLite journal sidecars.
pub fn verify_sqlite(sandbox_parent: &Path) -> Result<StorageEvidence, String> {
    run_probe(sandbox_parent).map_err(|error| format!("SQLite 6A 验证失败: {error}"))
}

fn row_count(db: &Connection) -> rusqlite::Result<u32> {
    db.query_row("SELECT COUNT(*) FROM probe", [], |row| row.get(0))
}

fn read_payload(db: &Connection) -> rusqlite::Result<Vec<u8>> {
    db.query_row("SELECT payload FROM probe WHERE id = 1", [], |row| {
        row.get(0)
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn run_probe(parent: &Path) -> Result<StorageEvidence, Box<dyn Error>> {
    let start = Instant::now();
    let sandbox = tempfile::Builder::new()
        .prefix("RiverLab 6A 合成验证 ")
        .tempdir_in(parent)?;
    let live_path = sandbox.path().join("活动 数据.sqlite");
    let backup_path = sandbox.path().join("备份 副本.sqlite");
    let restored_path = sandbox.path().join("恢复 数据.sqlite");

    let mut live = Connection::open(&live_path)?;
    live.execute_batch("CREATE TABLE probe(id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")?;
    let insert = live.transaction()?;
    insert.execute("INSERT INTO probe VALUES (1, ?1)", [FIXTURE])?;
    insert.commit()?;
    drop(live);
    let mut live = Connection::open_with_flags(&live_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    let committed_rows = row_count(&live)?;
    if committed_rows != 1 || read_payload(&live)? != FIXTURE {
        return Err("committed row changed after reopening database".into());
    }

    let tx = live.transaction()?;
    tx.execute(
        "INSERT INTO probe VALUES (2, ?1)",
        [b"temporary".as_slice()],
    )?;
    tx.execute("UPDATE probe SET payload = x'00' WHERE id = 1", [])?;
    tx.rollback()?;
    let rows_after_rollback = row_count(&live)?;
    if rows_after_rollback != 1 || read_payload(&live)? != FIXTURE {
        return Err("rollback did not preserve the committed state".into());
    }

    // Back up an open database, then change it to make stale/live-source
    // mixups observable when the snapshot is restored to a third file.
    live.backup(MAIN_DB, &backup_path, NO_PROGRESS)?;
    let backup_file_sha256 = sha256(&fs::read(&backup_path)?);
    live.execute("UPDATE probe SET payload = x'FF' WHERE id = 1", [])?;
    if read_payload(&live)? != [0xff] {
        return Err("post-backup change missing from live database".into());
    }
    drop(live);

    let mut restored = Connection::open(&restored_path)?;
    restored.restore(MAIN_DB, &backup_path, NO_PROGRESS)?;
    drop(restored);
    let restored = Connection::open_with_flags(&restored_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity_check: String = restored.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let restored_rows = row_count(&restored)?;
    let payload = read_payload(&restored)?;
    if integrity_check != "ok" || restored_rows != 1 || payload != FIXTURE {
        return Err("restored database failed integrity, row count or byte comparison".into());
    }
    drop(restored);
    sandbox.close()?;

    Ok(StorageEvidence {
        status: "PASS",
        sqlite_version: rusqlite::version().to_owned(),
        committed_rows,
        rows_after_rollback,
        restored_rows,
        fixture_sha256: sha256(FIXTURE),
        restored_payload_sha256: sha256(&payload),
        backup_file_sha256,
        integrity_check,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_probes_restore_the_same_fixture_and_preserve_sibling_files() {
        let parent = tempfile::tempdir().unwrap();
        let existing = parent.path().join("活动 数据.sqlite");
        fs::write(&existing, b"existing user bytes").unwrap();
        for _ in 0..2 {
            let result = verify_sqlite(parent.path()).unwrap();
            assert_eq!(result.status, "PASS");
            assert_eq!(result.integrity_check, "ok");
            assert_eq!(result.rows_after_rollback, 1);
            assert_eq!(result.fixture_sha256, result.restored_payload_sha256);
            assert_eq!(
                result.restored_payload_sha256,
                "34429675a4ac768482806ffe80475cb5e601bf1f2ffa8069cac2a0076f0c0f55"
            );
            assert_eq!(result.backup_file_sha256.len(), 64);
        }
        assert_eq!(fs::read(existing).unwrap(), b"existing user bytes");
        assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 1);
    }

    #[test]
    fn missing_parent_returns_error_without_creating_it() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("missing");
        assert!(verify_sqlite(&missing).is_err());
        assert!(!missing.exists());
    }
}
