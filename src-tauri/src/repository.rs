//! Desktop persistence. The research validators own the domain formats. SQLite
//! stores their JSON text verbatim, including field order and decimal strings.
use rusqlite::{
    backup::{Backup, StepResult},
    params, Connection, ErrorCode, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::{error::Error, fmt, path::Path, time::Duration};

pub const SCHEMA_VERSION: u32 = 1;
const APPLICATION_ID: u32 = 0x5256_4c42; // RVLB
const MIB: usize = 1024 * 1024;
const MAX_BATCH_BYTES: usize = 512 * MIB;
const MAX_BODY_BYTES: usize = 256 * MIB;
const MAX_SUMMARY_BYTES: usize = 20 * MIB;

#[derive(Debug, Serialize)]
pub struct RepoError {
    pub code: &'static str,
    pub message: String,
}

impl RepoError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for RepoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for RepoError {}

impl From<rusqlite::Error> for RepoError {
    fn from(error: rusqlite::Error) -> Self {
        let code = match error.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => "busy",
            Some(ErrorCode::DiskFull) => "diskFull",
            Some(ErrorCode::ReadOnly | ErrorCode::PermissionDenied) => "permissionDenied",
            Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => "corrupt",
            Some(ErrorCode::ConstraintViolation) => "conflict",
            Some(ErrorCode::TooBig) => "limit",
            _ => "io",
        };
        Self::new(code, format!("SQLite 操作失败：{error}"))
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Dataset,
    Experiment,
    Rule,
    Replay,
    Risk,
    Portfolio,
    SharedPool,
    Regime,
    Advanced,
}

impl Kind {
    fn key(self) -> &'static str {
        match self {
            Self::Dataset => "dataset",
            Self::Experiment => "experiment",
            Self::Rule => "rule",
            Self::Replay => "replay",
            Self::Risk => "risk",
            Self::Portfolio => "portfolio",
            Self::SharedPool => "shared_pool",
            Self::Regime => "regime",
            Self::Advanced => "advanced",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub kind: Kind,
    pub id: String,
    pub body: String,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Save { records: Vec<Record> },
    List { kind: Kind },
    Load { kind: Kind, id: String },
    Delete { kind: Kind, id: String },
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Response {
    Done,
    Body(Option<String>),
    Summaries(Vec<String>),
}

pub struct Repository {
    db: Connection,
}

impl Repository {
    /// The service resolves and checks this fixed, private path before opening.
    pub fn open(path: &Path) -> Result<Self, RepoError> {
        let mut db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;")?;
        {
            // Serialize initialization even if a second connection opens an
            // empty database at the same time. Unknown schemas are never reset.
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let app: u32 = tx.query_row("PRAGMA application_id", [], |r| r.get(0))?;
            let version: u32 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if app == 0 && version == 0 {
                if tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema)", [], |r| {
                    r.get::<_, bool>(0)
                })? {
                    return Err(RepoError::new(
                        "schema",
                        "数据库已有未识别结构，已停止打开。",
                    ));
                }
                tx.execute_batch(
                    "CREATE TABLE records (
                         kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                         PRIMARY KEY(kind, id)
                     ) STRICT, WITHOUT ROWID;
                     CREATE TABLE summaries (
                         kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL,
                         PRIMARY KEY(kind, id),
                         FOREIGN KEY(kind, id) REFERENCES records(kind, id) ON DELETE CASCADE
                     ) STRICT, WITHOUT ROWID;",
                )?;
                tx.pragma_update(None, "application_id", APPLICATION_ID)?;
                tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            } else if app != APPLICATION_ID || version != SCHEMA_VERSION {
                return Err(RepoError::new(
                    "schema",
                    format!("数据库标识或 schema 版本不受支持（{version}）。"),
                ));
            }
            // Reject an incomplete schema before declaring the service ready.
            tx.prepare("SELECT r.kind,r.id,r.body,s.summary FROM records r JOIN summaries s USING(kind,id) LIMIT 0")?;
            tx.commit()?;
        }
        let mode: String = db.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(RepoError::new("io", "当前数据目录无法启用 SQLite WAL。"));
        }
        db.execute_batch("PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;")?;
        Ok(Self { db })
    }

    pub fn execute(&mut self, op: Operation) -> Result<Response, RepoError> {
        match op {
            Operation::Save { records } => {
                self.insert_batch(&records)?;
                Ok(Response::Done)
            }
            Operation::List { kind } => {
                let tx = self.db.transaction()?;
                let rows = read_summaries(&tx, kind, MAX_BODY_BYTES)?;
                tx.commit()?;
                Ok(Response::Summaries(rows))
            }
            Operation::Load { kind, id } => {
                validate_id(&id)?;
                // Determine length in SQLite before materializing any stored body.
                let found: Option<Option<String>> = self
                    .db
                    .query_row(
                        "SELECT CASE WHEN octet_length(body) <= ?3 THEN body END
                     FROM records WHERE kind=?1 AND id=?2",
                        params![kind.key(), id, MAX_BODY_BYTES as i64],
                        |r| r.get(0),
                    )
                    .optional()?;
                let body = match found {
                    None => None,
                    Some(None) => {
                        return Err(RepoError::new("limit", "正文超过桌面存储字节预算。"))
                    }
                    Some(Some(value)) => {
                        validate_json_id(&value, &id)
                            .map_err(|_| RepoError::new("corrupt", "正文或记录 ID 损坏。"))?;
                        Some(value)
                    }
                };
                Ok(Response::Body(body))
            }
            Operation::Delete { kind, id } => {
                validate_id(&id)?;
                self.db.execute(
                    "DELETE FROM records WHERE kind=?1 AND id=?2",
                    params![kind.key(), id],
                )?;
                Ok(Response::Done)
            }
        }
    }

    fn insert_batch(&mut self, records: &[Record]) -> Result<(), RepoError> {
        if records.is_empty() || records.len() > 512 {
            return Err(RepoError::new("limit", "单批需包含 1 到 512 条记录。"));
        }
        let mut total = 0usize;
        for record in records {
            total = total
                .saturating_add(record.body.len())
                .saturating_add(record.summary.len());
            if record.body.len() > MAX_BODY_BYTES
                || record.summary.len() > MAX_SUMMARY_BYTES
                || total > MAX_BATCH_BYTES
            {
                return Err(RepoError::new(
                    "limit",
                    "记录或事务批次超过桌面存储字节预算。",
                ));
            }
            validate_id(&record.id)?;
            validate_json_id(&record.body, &record.id)?;
            validate_json_id(&record.summary, &record.id)?;
            if record.kind == Kind::Rule && record.body != record.summary {
                return Err(RepoError::new(
                    "invalidRequest",
                    "规则列表项必须与规则正文相同。",
                ));
            }
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for record in records {
            insert_record(&tx, record)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn health_check(&self) -> Result<(), RepoError> {
        let version: u32 = self.db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version != SCHEMA_VERSION {
            return Err(RepoError::new(
                "schema",
                format!("不支持数据库 schema 版本 {version}。"),
            ));
        }
        // Resolve both tables and perform bounded index reads, including when empty.
        self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM records), EXISTS(SELECT 1 FROM summaries)",
            [],
            |_| Ok(()),
        )?;
        Ok(())
    }

    pub fn integrity_check(&self) -> Result<(), RepoError> {
        check_integrity(&self.db)
    }

    pub fn checkpoint(&self) -> Result<(), RepoError> {
        // A reader may retain its snapshot. In that case do not remove WAL
        // sidecars: SQLite must replay them on the next open.
        let busy: u32 = self
            .db
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
        if busy != 0 {
            return Err(RepoError::new(
                "busy",
                "读取连接仍在使用 WAL，checkpoint 未完成。",
            ));
        }
        Ok(())
    }

    /// The service supplies a new private staging file. Refuse an existing
    /// non-empty database before SQLite can replace any of its content.
    pub fn backup(&self, path: &Path) -> Result<(), RepoError> {
        let mut target = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        if target.query_row("PRAGMA page_count", [], |r| r.get::<_, i64>(0))? != 0 {
            return Err(RepoError::new(
                "conflict",
                "备份目的文件已有内容，已拒绝覆盖。",
            ));
        }
        {
            let backup = Backup::new(&self.db, &mut target)?;
            loop {
                match backup.step(128)? {
                    StepResult::Done => break,
                    StepResult::More => continue,
                    _ => return Err(RepoError::new("busy", "数据库正忙，备份未发布。")),
                }
            }
        }
        // The published snapshot must be a standalone file. Source WAL pages
        // were read by the Online Backup API as part of its consistent view.
        let mode: String = target.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
        if !mode.eq_ignore_ascii_case("delete") {
            return Err(RepoError::new("io", "备份文件未完成独立落盘。"));
        }
        drop(target);
        let snapshot = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let version: u32 = snapshot.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let app: u32 = snapshot.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        if version != SCHEMA_VERSION || app != APPLICATION_ID {
            return Err(RepoError::new("schema", "备份标识或版本不匹配。"));
        }
        check_integrity(&snapshot)
    }
}

fn read_summaries(
    tx: &Transaction<'_>,
    kind: Kind,
    limit: usize,
) -> Result<Vec<String>, RepoError> {
    // Inspect byte lengths in the same snapshot used by the list read. SQLite
    // can read octet_length from record headers without loading large TEXT.
    let bytes: i64 = tx.query_row(
        "SELECT COALESCE(SUM(octet_length(summary) + ?2),0) FROM summaries WHERE kind=?1",
        params![kind.key(), std::mem::size_of::<String>() as i64],
        |r| r.get(0),
    )?;
    if bytes > limit as i64 {
        return Err(RepoError::new("limit", "摘要列表超过本次读取的内存预算。"));
    }
    let mut stmt = tx.prepare("SELECT id,summary FROM summaries WHERE kind=?1 ORDER BY id")?;
    let rows = stmt.query_map([kind.key()], |r| {
        let id: String = r.get(0)?;
        // The TS validator isolates invalid rows. An invalid UTF-8 or mismatched
        // envelope must be counted there without hiding other valid summaries.
        let value = r.get_ref(1)?.as_str().ok();
        Ok(value
            .filter(|json| validate_json_id(json, &id).is_ok())
            .unwrap_or_default()
            .to_owned())
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn validate_id(id: &str) -> Result<(), RepoError> {
    if id.is_empty() || id.encode_utf16().count() > 100 {
        Err(RepoError::new("invalidRequest", "记录 ID 长度不受支持。"))
    } else {
        Ok(())
    }
}

fn validate_json_id(json: &str, expected: &str) -> Result<(), RepoError> {
    // Skip domain fields during deserialization. Large experiments need no
    // Rust copy of the research object tree, or number/key normalization.
    #[derive(Deserialize)]
    struct Identity {
        id: String,
    }
    let matched = json.trim_start().starts_with('{')
        && serde_json::from_str::<Identity>(json).is_ok_and(|value| value.id == expected);
    if matched {
        Ok(())
    } else {
        Err(RepoError::new(
            "invalidRequest",
            "记录正文或摘要格式无效，或 ID 不匹配。",
        ))
    }
}

fn insert_record(tx: &Transaction<'_>, record: &Record) -> Result<(), RepoError> {
    let key = record.kind.key();
    if record.kind == Kind::Dataset {
        let identical = tx
            .query_row(
                "SELECT r.body=?3 AND s.summary=?4 FROM records r
             JOIN summaries s USING(kind,id) WHERE r.kind=?1 AND r.id=?2",
                params![key, record.id, record.body, record.summary],
                |r| r.get::<_, bool>(0),
            )
            .optional()?;
        match identical {
            Some(true) => return Ok(()),
            Some(false) => {
                return Err(RepoError::new(
                    "conflict",
                    "相同 ID 的数据集或摘要内容冲突，已拒绝覆盖。",
                ))
            }
            None => (),
        }
    }
    if record.kind == Kind::Rule
        && tx.query_row("SELECT COUNT(*) FROM records WHERE kind='rule'", [], |r| {
            r.get::<_, u32>(0)
        })? >= 100
    {
        return Err(RepoError::new("limit", "策略库最多 100 个版本。"));
    }
    tx.execute(
        "INSERT INTO records(kind,id,body) VALUES (?1,?2,?3)",
        params![key, record.id, record.body],
    )?;
    tx.execute(
        "INSERT INTO summaries(kind,id,summary) VALUES (?1,?2,?3)",
        params![key, record.id, record.summary],
    )?;
    Ok(())
}

fn check_integrity(db: &Connection) -> Result<(), RepoError> {
    let snapshot = db.unchecked_transaction()?;
    let result: String = snapshot.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let fk_error = snapshot.prepare("PRAGMA foreign_key_check")?.exists([])?;
    let missing_summary = snapshot.query_row(
        "SELECT EXISTS(SELECT 1 FROM records r LEFT JOIN summaries s USING(kind,id) WHERE s.id IS NULL)",
        [], |r| r.get::<_, bool>(0),
    )?;
    if result != "ok" || fk_error || missing_summary {
        return Err(RepoError::new(
            "corrupt",
            "数据库完整性、外键或正文/摘要配对检查失败。",
        ));
    }
    snapshot.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Command,
        sync::{Arc, Barrier},
    };

    fn temp_folder() -> tempfile::TempDir {
        // macOS TMPDIR can use /var, a system symlink to /private/var.
        tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
    }

    fn record(kind: Kind, id: &str, value: &str) -> Record {
        let body = serde_json::json!({"id":id, "value":value}).to_string();
        Record {
            kind,
            id: id.to_owned(),
            summary: if kind == Kind::Rule {
                body.clone()
            } else {
                serde_json::json!({"id":id}).to_string()
            },
            body,
        }
    }

    fn load(db: &mut Repository, kind: Kind, id: &str) -> Option<String> {
        match db
            .execute(Operation::Load {
                kind,
                id: id.into(),
            })
            .unwrap()
        {
            Response::Body(body) => body,
            other => panic!("unexpected load response {other:?}"),
        }
    }

    fn save(db: &mut Repository, records: Vec<Record>) -> Result<Response, RepoError> {
        db.execute(Operation::Save { records })
    }

    #[test]
    fn persists_all_kinds_in_one_commit_with_their_original_json_text() {
        let folder = temp_folder();
        let path = folder.path().join("研究 记录.sqlite");
        let kinds = [
            Kind::Dataset,
            Kind::Experiment,
            Kind::Rule,
            Kind::Replay,
            Kind::Risk,
            Kind::Portfolio,
            Kind::SharedPool,
            Kind::Regime,
            Kind::Advanced,
        ];
        let mut db = Repository::open(&path).unwrap();
        let body = r#"{"z":0,"id":"同一 ID","amount":"100.000000000000000001","a":9e-11}"#;
        let rows = kinds.map(|kind| {
            let mut r = record(kind, "同一 ID", "");
            r.body = body.to_string();
            if kind == Kind::Rule {
                r.summary = r.body.clone()
            }
            r
        });
        assert_eq!(save(&mut db, Vec::from(rows)).unwrap(), Response::Done);
        db.integrity_check().unwrap();
        db.checkpoint().unwrap();
        drop(db);
        let mut db = Repository::open(&path).unwrap();
        for kind in kinds {
            assert_eq!(load(&mut db, kind, "同一 ID").as_deref(), Some(body));
            let expected = if kind == Kind::Rule {
                body.to_string()
            } else {
                record(kind, "同一 ID", "").summary
            };
            assert_eq!(
                db.execute(Operation::List { kind }).unwrap(),
                Response::Summaries(vec![expected])
            );
        }
        db.execute(Operation::Delete {
            kind: Kind::Replay,
            id: "同一 ID".to_string(),
        })
        .unwrap();
        assert_eq!(load(&mut db, Kind::Replay, "同一 ID"), None);
        assert_eq!(
            db.execute(Operation::List { kind: Kind::Replay }).unwrap(),
            Response::Summaries(vec![])
        );
        assert_eq!(
            load(&mut db, Kind::Dataset, "同一 ID").as_deref(),
            Some(body)
        );
    }

    #[test]
    fn conflict_rolls_back_the_whole_batch_and_identical_datasets_are_idempotent() {
        let folder = temp_folder();
        let mut db = Repository::open(&folder.path().join("db")).unwrap();
        for _ in 0..2 {
            save(&mut db, vec![record(Kind::Dataset, "a", "original")]).unwrap();
        }
        let error = save(
            &mut db,
            vec![
                record(Kind::Experiment, "other", "new"),
                record(Kind::Dataset, "a", "changed"),
            ],
        )
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(load(&mut db, Kind::Experiment, "other"), None);
        assert_eq!(
            load(&mut db, Kind::Dataset, "a"),
            Some(record(Kind::Dataset, "a", "original").body)
        );
        let mut changed = record(Kind::Dataset, "a", "original");
        changed.summary = r#"{"id":"a","name":"different summary"}"#.into();
        assert_eq!(save(&mut db, vec![changed]).unwrap_err().code, "conflict");

        // Fail the second statement, after the body was successfully inserted.
        db.db
            .execute_batch(
                "CREATE TEMP TRIGGER reject_summary BEFORE INSERT ON summaries
                             BEGIN SELECT RAISE(ABORT,'summary write failure'); END;",
            )
            .unwrap();
        assert!(save(&mut db, vec![record(Kind::Replay, "midway", "new")]).is_err());
        assert_eq!(load(&mut db, Kind::Replay, "midway"), None);
        db.integrity_check().unwrap();
    }

    #[test]
    fn sqlite_full_rolls_back_both_tables_and_preserves_committed_data() {
        let folder = temp_folder();
        let path = folder.path().join("db");
        let mut db = Repository::open(&path).unwrap();
        save(&mut db, vec![record(Kind::Replay, "original", "old")]).unwrap();
        let pages: u32 = db
            .db
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap();
        let cap: u32 = db
            .db
            .query_row(&format!("PRAGMA max_page_count={pages}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(cap, pages);
        let full = save(
            &mut db,
            vec![
                record(Kind::Replay, "small", "new"),
                record(Kind::Replay, "big", &"x".repeat(MIB)),
            ],
        )
        .unwrap_err();
        assert_eq!(full.code, "diskFull");
        drop(db);
        let mut db = Repository::open(&path).unwrap();
        assert!(load(&mut db, Kind::Replay, "original").is_some());
        assert_eq!(load(&mut db, Kind::Replay, "small"), None);
        assert_eq!(load(&mut db, Kind::Replay, "big"), None);
        db.integrity_check().unwrap();
    }

    #[test]
    fn concurrent_connections_accept_exactly_one_immutable_experiment() {
        let root = temp_folder();
        let path = root.path().join("db");
        let a = Repository::open(&path).unwrap();
        let b = Repository::open(&path).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let jobs = [a, b]
            .into_iter()
            .enumerate()
            .map(|(writer, mut db)| {
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    let body = writer.to_string();
                    let result = save(&mut db, vec![record(Kind::Experiment, "race", &body)]);
                    (body, result.map_err(|e| e.code))
                })
            })
            .collect::<Vec<_>>();
        let results: Vec<_> = jobs.into_iter().map(|j| j.join().unwrap()).collect();
        assert_eq!(
            results
                .iter()
                .filter(|(_, r)| *r == Err("conflict"))
                .count(),
            1
        );
        let winner = &results.iter().find(|(_, r)| r.is_ok()).unwrap().0;
        let mut reopened = Repository::open(&path).unwrap();
        assert_eq!(
            load(&mut reopened, Kind::Experiment, "race"),
            Some(record(Kind::Experiment, "race", winner).body)
        );
        reopened.integrity_check().unwrap();
    }

    #[test]
    fn crash_during_transaction_recovers_committed_wal_frames_only() {
        const CHILD_PATH: &str = "RIVERLAB_REPO_CRASH_TEST_DB";
        if let Some(path) = std::env::var_os(CHILD_PATH) {
            // Even an inadvertently inherited test variable cannot direct
            // this crash fixture to a pre-existing database.
            drop(std::fs::File::create_new(&path).unwrap());
            let mut db = Repository::open(Path::new(&path)).unwrap();
            db.db
                .execute_batch("PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=5;")
                .unwrap();
            save(&mut db, vec![record(Kind::Experiment, "keep", "committed")]).unwrap();
            let tx = db
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            insert_record(&tx, &record(Kind::Replay, "lose", &"x".repeat(512 * 1024))).unwrap();
            // OS closes descriptors, without Drop/COMMIT/ROLLBACK/checkpoint.
            std::process::exit(23);
        }
        let folder = temp_folder();
        let path = folder.path().join("crash.sqlite3");
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "repository::tests::crash_during_transaction_recovers_committed_wal_frames_only",
            ])
            .env(CHILD_PATH, &path)
            .status()
            .unwrap();
        assert_eq!(result.code(), Some(23));
        assert!(
            folder
                .path()
                .join("crash.sqlite3-wal")
                .metadata()
                .unwrap()
                .len()
                > 32
        );
        let mut db = Repository::open(&path).unwrap();
        assert_eq!(
            load(&mut db, Kind::Experiment, "keep"),
            Some(record(Kind::Experiment, "keep", "committed").body)
        );
        assert_eq!(load(&mut db, Kind::Replay, "lose"), None);
        db.integrity_check().unwrap();
    }

    #[test]
    fn online_backup_includes_committed_wal_and_survives_subsequent_deletes() {
        let folder = temp_folder();
        let source = folder.path().join("live.sqlite");
        let backup = folder.path().join("backup.sqlite");
        let mut db = Repository::open(&source).unwrap();
        db.db.execute_batch("PRAGMA wal_autocheckpoint=0").unwrap();
        save(
            &mut db,
            vec![record(Kind::Experiment, "saved", "before backup")],
        )
        .unwrap();
        db.backup(&backup).unwrap();
        db.execute(Operation::Delete {
            kind: Kind::Experiment,
            id: "saved".into(),
        })
        .unwrap();
        assert_eq!(db.backup(&backup).unwrap_err().code, "conflict");
        let mut restored = Repository::open(&backup).unwrap();
        assert_eq!(
            load(&mut restored, Kind::Experiment, "saved"),
            Some(record(Kind::Experiment, "saved", "before backup").body)
        );
        assert_eq!(load(&mut db, Kind::Experiment, "saved"), None);
        restored.integrity_check().unwrap();
    }

    #[test]
    fn damaged_list_rows_are_isolated_and_integrity_checks_both_directions() {
        let directory = temp_folder();
        let mut db = Repository::open(&directory.path().join("library")).unwrap();
        let good = record(Kind::Risk, "healthy", "original");
        let good_summary = good.summary.clone();
        save(&mut db, vec![record(Kind::Risk, "damaged", "old"), good]).unwrap();
        db.db
            .execute(
                "UPDATE summaries SET summary=CAST(x'ff' AS TEXT) WHERE id='damaged'",
                [],
            )
            .unwrap();
        assert_eq!(
            db.execute(Operation::List { kind: Kind::Risk }).unwrap(),
            Response::Summaries(vec![String::new(), good_summary])
        );
        {
            let tx = db.db.transaction().unwrap();
            assert_eq!(
                read_summaries(&tx, Kind::Risk, 1).unwrap_err().code,
                "limit"
            );
        }
        db.db
            .execute("DELETE FROM summaries WHERE id='damaged'", [])
            .unwrap();
        assert_eq!(db.integrity_check().unwrap_err().code, "corrupt");
        assert_eq!(
            db.backup(&directory.path().join("staging"))
                .unwrap_err()
                .code,
            "corrupt"
        );
        assert!(load(&mut db, Kind::Risk, "healthy").is_some());

        db.db
            .execute_batch(
                "DELETE FROM records WHERE id='damaged';
                             PRAGMA foreign_keys=OFF;
                             INSERT INTO summaries VALUES ('risk','orphan','{}');
                             PRAGMA foreign_keys=ON;",
            )
            .unwrap();
        assert_eq!(db.integrity_check().unwrap_err().code, "corrupt");
    }

    #[test]
    fn unknown_schema_and_unrelated_sqlite_files_are_preserved() {
        let folder = temp_folder();
        for foreign in [false, true] {
            let path = folder
                .path()
                .join(if foreign { "unrelated.db" } else { "future.db" });
            let db = Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE existing (value TEXT); INSERT INTO existing VALUES ('keep');",
            )
            .unwrap();
            if !foreign {
                db.pragma_update(None, "application_id", APPLICATION_ID)
                    .unwrap();
                db.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
                    .unwrap();
            }
            drop(db);
            assert_eq!(Repository::open(&path).err().unwrap().code, "schema");
            let db = Connection::open(&path).unwrap();
            assert_eq!(
                db.query_row("SELECT value FROM existing", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "keep"
            );
            assert_eq!(
                db.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "delete"
            );
        }
    }

    #[test]
    fn maximum_size_experiment_body_round_trips_and_next_byte_is_rejected() {
        use sha2::{Digest, Sha256};
        let directory = temp_folder();
        let path = directory.path().join("capacity");
        let mut db = Repository::open(&path).unwrap();
        // Synthetic transport payload only. Domain experiments are checked by
        // the research Workers independently of this SQLite byte boundary.
        let mut body = String::with_capacity(MAX_BODY_BYTES);
        body.push_str(r#"{"id":"capacity","padding":""#);
        let chunk = "x".repeat(MIB);
        let padding = MAX_BODY_BYTES - body.len() - 2;
        for _ in 0..padding / MIB {
            body.push_str(&chunk);
        }
        body.push_str(&chunk[..padding % MIB]);
        body.push_str(r#""}"#);
        assert_eq!(body.len(), MAX_BODY_BYTES);
        let digest = Sha256::digest(body.as_bytes());
        let mut record = record(Kind::Experiment, "capacity", "");
        record.body = body;
        save(&mut db, vec![record]).unwrap();
        drop(db);
        let mut db = Repository::open(&path).unwrap();
        let body = load(&mut db, Kind::Experiment, "capacity").unwrap();
        assert_eq!(Sha256::digest(body.as_bytes()), digest);
        // Use a clone-free move; reserve one additional byte before growing.
        let mut oversized = Record {
            kind: Kind::Experiment,
            id: "capacity".to_owned(),
            body,
            summary: r#"{"id":"capacity"}"#.to_owned(),
        };
        oversized.body.reserve_exact(1);
        oversized.body.push(' ');
        assert_eq!(save(&mut db, vec![oversized]).unwrap_err().code, "limit");
        db.integrity_check().unwrap();
    }

    #[test]
    fn validates_envelope_identity_and_enforces_rule_limit_inside_write_transaction() {
        let root = temp_folder();
        let mut db = Repository::open(&root.path().join("db")).unwrap();
        let mut mismatch = record(Kind::Rule, "a", "original");
        mismatch.body = r#"{"id":"other"}"#.into();
        assert_eq!(
            save(&mut db, vec![mismatch]).unwrap_err().code,
            "invalidRequest"
        );
        let batch = (1..=101)
            .map(|id| record(Kind::Rule, &id.to_string(), "v"))
            .collect();
        assert_eq!(save(&mut db, batch).unwrap_err().code, "limit");
        let batch = (1..=100)
            .map(|id| record(Kind::Rule, &id.to_string(), "v"))
            .collect();
        save(&mut db, batch).unwrap();
        assert_eq!(
            save(&mut db, vec![record(Kind::Rule, "101", "v")])
                .unwrap_err()
                .code,
            "limit"
        );
        assert!(serde_json::from_str::<Operation>(r#"{"op":"list","kind":"other"}"#).is_err());
        assert!(serde_json::from_str::<Operation>(
            r#"{"op":"list","kind":"rule","path":"/tmp/example"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Operation>(r#"{"op":"sql","sql":"SELECT 1"}"#).is_err());
    }
}
