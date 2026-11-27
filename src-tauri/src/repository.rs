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
const RECORDS_DDL: &str = "CREATE TABLE records (
    kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY(kind, id)
) STRICT, WITHOUT ROWID";
const SUMMARIES_DDL: &str = "CREATE TABLE summaries (
    kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL,
    PRIMARY KEY(kind, id),
    FOREIGN KEY(kind, id) REFERENCES records(kind, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID";
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
            let app: i64 = tx.query_row("PRAGMA application_id", [], |r| r.get(0))?;
            let version: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
            if app == 0 && version == 0 {
                if tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema)", [], |r| {
                    r.get::<_, bool>(0)
                })? {
                    return Err(RepoError::new(
                        "schema",
                        "数据库已有未识别结构，已停止打开。",
                    ));
                }
                tx.execute_batch(RECORDS_DDL)?;
                tx.execute_batch(SUMMARIES_DDL)?;
                tx.pragma_update(None, "application_id", APPLICATION_ID)?;
                tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            }
            check_schema(&tx)?;
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
                let tx = self
                    .db
                    .transaction_with_behavior(TransactionBehavior::Immediate)?;
                check_schema(&tx)?;
                tx.execute(
                    "DELETE FROM records WHERE kind=?1 AND id=?2",
                    params![kind.key(), id],
                )?;
                tx.commit()?;
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
        check_schema(&tx)?;
        for record in records {
            insert_record(&tx, record)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn health_check(&self) -> Result<(), RepoError> {
        check_schema(&self.db)?;
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
        check_schema(&self.db)?;
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
                "SELECT r.body=?3 COLLATE BINARY AND s.summary=?4 COLLATE BINARY FROM records r
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
        "INSERT OR ABORT INTO records(kind,id,body) VALUES (?1,?2,?3)",
        params![key, record.id, record.body],
    )?;
    tx.execute(
        "INSERT OR ABORT INTO summaries(kind,id,summary) VALUES (?1,?2,?3)",
        params![key, record.id, record.summary],
    )?;
    Ok(())
}

fn check_schema(db: &Connection) -> Result<(), RepoError> {
    let app: i64 = db.query_row("PRAGMA main.application_id", [], |r| r.get(0))?;
    let version: i64 = db.query_row("PRAGMA main.user_version", [], |r| r.get(0))?;
    if app != i64::from(APPLICATION_ID) || version != i64::from(SCHEMA_VERSION) {
        return Err(RepoError::new(
            "schema",
            format!("数据库标识或 schema 版本不受支持（{version}）。"),
        ));
    }
    for (table, payload) in [("records", "body"), ("summaries", "summary")] {
        // Inspect SQLite's parsed schema so equivalent quoted or reformatted DDL
        // and ordinary secondary indexes remain usable.
        let matches: bool = db.query_row(
            r#"SELECT
                EXISTS (SELECT 1 FROM pragma_table_list
                        WHERE schema='main' AND name=?1 COLLATE NOCASE AND type='table'
                          AND ncol=3 AND wr=1 AND strict=1)
                AND (SELECT count(*)=3 FROM pragma_table_xinfo(?1, 'main')
                     WHERE type='TEXT' COLLATE NOCASE AND "notnull"=1 AND hidden=0
                       AND dflt_value IS NULL
                       AND ((cid=0 AND name='kind' COLLATE NOCASE AND pk=1)
                         OR (cid=1 AND name='id' COLLATE NOCASE AND pk=2)
                         OR (cid=2 AND name=?2 COLLATE NOCASE AND pk=0)))
                AND (SELECT count(*)=2 FROM pragma_index_xinfo(?1, 'main')
                     WHERE key=1 AND coll='BINARY' COLLATE NOCASE)
                AND NOT EXISTS (SELECT 1 FROM pragma_index_list(?1, 'main')
                                WHERE "unique"=1 AND origin<>'pk')
                AND NOT EXISTS (SELECT 1 FROM main.sqlite_schema
                                WHERE type='trigger' AND tbl_name=?1 COLLATE NOCASE)"#,
            params![table, payload],
            |r| r.get(0),
        )?;
        if !matches {
            return Err(RepoError::new(
                "schema",
                format!("表 {table} 的 v1 列、主键或约束不匹配。"),
            ));
        }
        // A PK may override a column's declared collation. WHERE and JOIN use
        // the column default even when the primary index itself uses BINARY.
        for column in ["kind", "id", payload] {
            let (_, collation, _, _, _) = db.column_metadata(Some("main"), table, column)?;
            if !collation.is_some_and(|name| name.as_bytes().eq_ignore_ascii_case(b"BINARY")) {
                return Err(RepoError::new(
                    "schema",
                    format!("列 {table}.{column} 的排序规则不是 BINARY。"),
                ));
            }
        }
    }
    let foreign_keys_match: bool = db.query_row(
        r#"SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_list('records', 'main'))
           AND (SELECT count(*)=2 AND count(*) FILTER (
                WHERE "table"='records' COLLATE NOCASE AND on_delete='CASCADE' AND on_update='NO ACTION'
                  AND ((seq=0 AND "from"='kind' COLLATE NOCASE AND "to"='kind' COLLATE NOCASE)
                    OR (seq=1 AND "from"='id' COLLATE NOCASE AND "to"='id' COLLATE NOCASE)))=2
                FROM pragma_foreign_key_list('summaries', 'main'))"#,
        [],
        |r| r.get(0),
    )?;
    if !foreign_keys_match {
        return Err(RepoError::new(
            "schema",
            "正文和摘要之间的 v1 复合外键或级联删除规则不匹配。",
        ));
    }
    Ok(())
}

fn check_integrity(db: &Connection) -> Result<(), RepoError> {
    let snapshot = db.unchecked_transaction()?;
    check_schema(&snapshot)?;
    let result: String = snapshot.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let fk_error = snapshot.prepare("PRAGMA foreign_key_check")?.exists([])?;
    if result != "ok" || fk_error {
        return Err(RepoError::new("corrupt", "数据库完整性或外键检查失败。"));
    }
    {
        // Walk one pair at a time in this read transaction. The outer join
        // exposes missing summaries; foreign_key_check above covers orphans.
        let mut stmt = snapshot.prepare(
            "SELECT r.kind, r.id,
                    CASE WHEN octet_length(r.body) <= ?1 THEN r.body END,
                    CASE WHEN octet_length(s.summary) <= ?2 THEN s.summary END
             FROM records r LEFT JOIN summaries s USING(kind,id)",
        )?;
        let mut rows = stmt.query(params![MAX_BODY_BYTES as i64, MAX_SUMMARY_BYTES as i64])?;
        while let Some(row) = rows.next()? {
            let key_error = |_| RepoError::new("corrupt", "记录类型或原始 ID 不是有效文本。");
            let kind = row.get_ref(0)?.as_str().map_err(key_error)?;
            let id = row.get_ref(1)?.as_str().map_err(key_error)?;
            validate_id(id).map_err(|_| RepoError::new("corrupt", "记录的原始 ID 长度损坏。"))?;
            let body = row.get_ref(2)?.as_str().ok();
            let summary = row.get_ref(3)?.as_str().ok();
            for (field, value) in [("正文", body), ("摘要", summary)] {
                if !value.is_some_and(|json| validate_json_id(json, id).is_ok()) {
                    return Err(RepoError::new(
                        "corrupt",
                        format!("{kind}/{id} 的{field}缺失、无效、超限或 ID 不匹配。"),
                    ));
                }
            }
            if kind == Kind::Rule.key() && body != summary {
                return Err(RepoError::new(
                    "corrupt",
                    format!("规则 {id} 的摘要与完整正文不一致。"),
                ));
            }
        }
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
    fn integrity_and_backup_reject_mismatched_envelopes_and_rule_content() {
        let directory = temp_folder();
        for (index, edit) in [
            r#"UPDATE records SET body='{"id":"other"}'"#,
            r#"UPDATE summaries SET summary='{"id":"other"}'"#,
            r#"UPDATE summaries SET summary='{"id":"original","value":"changed"}'"#,
            "UPDATE summaries SET summary=CAST(x'ff' AS TEXT)",
        ]
        .into_iter()
        .enumerate()
        {
            let mut db = Repository::open(&directory.path().join(format!("db-{index}"))).unwrap();
            save(&mut db, vec![record(Kind::Rule, "original", "keep")]).unwrap();
            db.db.execute(edit, []).unwrap();
            assert_eq!(db.integrity_check().unwrap_err().code, "corrupt");
            assert_eq!(
                db.backup(&directory.path().join(format!("staging-{index}")))
                    .unwrap_err()
                    .code,
                "corrupt"
            );
            let count: i64 = db
                .db
                .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 1);
        }
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
    fn opening_mislabeled_v1_preserves_conflicting_and_orphaned_rows() {
        let dir = temp_folder();
        for (name, records_ddl, summaries_ddl, seed) in [
            ("duplicates", "CREATE TABLE records(kind TEXT, id TEXT, body TEXT)",
             "CREATE TABLE summaries(kind TEXT, id TEXT, summary TEXT)",
             "INSERT INTO records VALUES ('experiment','a','first'),('experiment','a','second')"),
            ("orphan", RECORDS_DDL,
             "CREATE TABLE summaries(kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL,
                 PRIMARY KEY(kind,id)) STRICT, WITHOUT ROWID",
             "INSERT INTO summaries VALUES ('experiment','orphan','preserve')"),
        ] {
            let path = dir.path().join(name);
            let db = Connection::open(&path).unwrap();
            db.pragma_update(None, "application_id", APPLICATION_ID).unwrap();
            db.pragma_update(None, "user_version", SCHEMA_VERSION).unwrap();
            db.execute_batch(records_ddl).unwrap();
            db.execute_batch(summaries_ddl).unwrap();
            db.execute_batch(seed).unwrap();
            drop(db);
            let before = std::fs::read(&path).unwrap();
            assert_eq!(Repository::open(&path).err().unwrap().code, "schema");
            assert_eq!(std::fs::read(&path).unwrap(), before);
            assert!(!path.with_file_name(format!("{name}-wal")).exists());
        }
    }

    #[test]
    fn compatible_ddl_allows_read_indexes_and_refuses_replacement_on_conflict() {
        let dir = temp_folder();
        let path = dir.path().join("compatible");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "application_id", APPLICATION_ID)
            .unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .unwrap();
        conn.execute_batch(
            r#"create table "records"(
                "kind" text not null, "id" text not null, "body" text not null,
                primary key ("kind", "id") on conflict replace) without rowid, strict"#,
        )
        .unwrap();
        conn.execute_batch(SUMMARIES_DDL).unwrap();
        conn.execute_batch("CREATE INDEX ids ON records(id)")
            .unwrap();
        drop(conn);
        let mut db = Repository::open(&path).unwrap();
        let first = record(Kind::Experiment, "a", "first");
        let expected = first.body.clone();
        save(&mut db, vec![first]).unwrap();
        assert_eq!(
            save(&mut db, vec![record(Kind::Experiment, "a", "changed")])
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(load(&mut db, Kind::Experiment, "a"), Some(expected));
        db.integrity_check().unwrap();
        db.backup(&dir.path().join("backup")).unwrap();
    }

    #[test]
    fn distinct_original_ids_require_binary_columns_and_indexes() {
        let dir = temp_folder();
        let path = dir.path().join("different-collations");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "application_id", APPLICATION_ID)
            .unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .unwrap();
        conn.execute_batch(
            "CREATE TABLE records(kind TEXT NOT NULL, id TEXT COLLATE NOCASE NOT NULL,
                body TEXT NOT NULL, PRIMARY KEY(kind, id COLLATE BINARY)) STRICT, WITHOUT ROWID;",
        )
        .unwrap();
        conn.execute_batch(SUMMARIES_DDL).unwrap();
        drop(conn);
        assert_eq!(Repository::open(&path).err().unwrap().code, "schema");

        let mut db = Repository::open(&dir.path().join("genuine-v1")).unwrap();
        let upper = record(Kind::Experiment, "A", "upper");
        let lower = record(Kind::Experiment, "a", "lower");
        let upper_body = upper.body.clone();
        let lower_body = lower.body.clone();
        save(&mut db, vec![upper, lower]).unwrap();
        assert_eq!(load(&mut db, Kind::Experiment, "A"), Some(upper_body));
        assert_eq!(
            load(&mut db, Kind::Experiment, "a").as_ref(),
            Some(&lower_body)
        );
        assert_eq!(
            db.execute(Operation::List {
                kind: Kind::Experiment
            })
            .unwrap(),
            Response::Summaries(vec![r#"{"id":"A"}"#.into(), r#"{"id":"a"}"#.into(),])
        );
        db.execute(Operation::Delete {
            kind: Kind::Experiment,
            id: "A".into(),
        })
        .unwrap();
        assert_eq!(load(&mut db, Kind::Experiment, "A"), None);
        assert_eq!(load(&mut db, Kind::Experiment, "a"), Some(lower_body));
        db.integrity_check().unwrap();
    }

    #[test]
    fn refuses_writes_and_backup_if_the_open_library_loses_its_cascade() {
        let dir = temp_folder();
        let mut db = Repository::open(&dir.path().join("library")).unwrap();
        save(&mut db, vec![record(Kind::Risk, "keep", "original")]).unwrap();
        db.db
            .execute_batch(
                "ALTER TABLE summaries RENAME TO saved_summaries;
             CREATE TABLE summaries(kind TEXT NOT NULL, id TEXT NOT NULL, summary TEXT NOT NULL,
                PRIMARY KEY(kind,id), FOREIGN KEY(kind,id) REFERENCES records(kind,id))
                STRICT, WITHOUT ROWID;
             INSERT INTO summaries SELECT * FROM saved_summaries;
             DROP TABLE saved_summaries;",
            )
            .unwrap();
        assert_eq!(db.health_check().unwrap_err().code, "schema");
        assert_eq!(db.integrity_check().unwrap_err().code, "schema");
        let destination = dir.path().join("rejected-backup");
        assert_eq!(db.backup(&destination).unwrap_err().code, "schema");
        assert!(!destination.exists());
        assert_eq!(
            save(&mut db, vec![record(Kind::Risk, "new", "value")])
                .unwrap_err()
                .code,
            "schema"
        );
        assert_eq!(
            db.execute(Operation::Delete {
                kind: Kind::Risk,
                id: "keep".into()
            })
            .unwrap_err()
            .code,
            "schema"
        );
        assert!(load(&mut db, Kind::Risk, "keep").is_some());
        assert!(load(&mut db, Kind::Risk, "new").is_none());
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
