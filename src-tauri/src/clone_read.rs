// A single SQLite snapshot binds each descriptor to exactly the projection
// being returned, including during delete/reinsert by another connection.
use super::{
    validate_json_id, Kind, RepoError, Response, MAX_BODY_BYTES, MAX_CLONE_FRAME, MAX_SUMMARY_BYTES,
};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

pub(super) fn read(
    db: &mut Connection,
    kind: Kind,
    id: Option<&str>,
) -> Result<Response, RepoError> {
    let tx = db.transaction()?;
    let (table, column, role, filter, budget) = if id.is_some() {
        ("records", "body", "body", "p.id=?3", MAX_BODY_BYTES)
    } else {
        let role = if kind == Kind::Rule {
            "body"
        } else {
            "summary"
        };
        (
            "summaries",
            "summary",
            role,
            "?3 IS NULL",
            MAX_SUMMARY_BYTES,
        )
    };
    let sql = format!(
        "SELECT p.id,CASE WHEN octet_length(p.{column})<=?4 THEN p.{column} END,
             m.role,CASE WHEN octet_length(m.descriptor)<=?5 THEN m.descriptor END,
             m.projection_sha256,m.clone_sha256,
             EXISTS(SELECT 1 FROM migration_members peer WHERE peer.kind=p.kind AND peer.id=p.id)
         FROM {table} p LEFT JOIN migration_members m
         ON m.kind=p.kind AND m.id=p.id AND m.role=?2 WHERE p.kind=?1 AND {filter} ORDER BY p.id"
    );
    let mut frame = vec![0; 4];
    let mut count = 0u32;
    {
        let mut stmt = tx.prepare(&sql)?;
        let mut rows = stmt.query(params![
            kind.key(),
            role,
            id,
            budget as i64,
            MAX_SUMMARY_BYTES as i64
        ])?;
        while let Some(row) = rows.next()? {
            let key = row.get_ref(0)?.as_str().ok();
            let projection = row.get_ref(1)?.as_str().ok();
            let descriptor = row.get_ref(3)?.as_str().ok();
            let is_archived = row.get::<_, bool>(6)?;
            let valid = key
                .zip(projection)
                .is_some_and(|(key, text)| validate_json_id(text, key).is_ok())
                && (!is_archived
                    || (row.get_ref(2)?.as_str().ok() == Some(role)
                        && projection.is_some_and(|text| {
                            matches_digest(text, row.get_ref(4).ok().and_then(|v| v.as_str().ok()))
                        })
                        && descriptor.is_some_and(|text| {
                            matches_digest(text, row.get_ref(5).ok().and_then(|v| v.as_str().ok()))
                        })));
            // Preserve the existing summary-list contract: a damaged row is
            // counted by the domain list while other healthy rows remain usable.
            let (value, clone) = if valid {
                (projection.unwrap(), descriptor.unwrap_or(""))
            } else if id.is_none() {
                ("", "")
            } else {
                return Err(RepoError::new(
                    "corrupt",
                    "正文、原键或迁移克隆描述 SHA-256 损坏。",
                ));
            };
            let needed = 8 + value.len() + clone.len();
            let limit = if id.is_some() {
                MAX_CLONE_FRAME
            } else {
                MAX_BODY_BYTES
            };
            if needed > limit - frame.len() {
                return Err(RepoError::new("limit", "结构化数据读取超过内存预算。"));
            }
            frame
                .try_reserve(needed)
                .map_err(|_| RepoError::new("limit", "内存不足，无法读取结构化数据。"))?;
            frame.extend_from_slice(&(value.len() as u32).to_le_bytes());
            frame.extend_from_slice(&(clone.len() as u32).to_le_bytes());
            frame.extend_from_slice(value.as_bytes());
            frame.extend_from_slice(clone.as_bytes());
            count += 1;
        }
    }
    tx.commit()?;
    if count == 0 && id.is_some() {
        return Ok(Response::Structured(None));
    }
    frame[..4].copy_from_slice(&count.to_le_bytes());
    Ok(Response::Structured(Some(frame)))
}

fn matches_digest(text: &str, expected: Option<&str>) -> bool {
    !text.is_empty()
        && expected.is_some_and(|expected| {
            expected.len() == 64 && format!("{:x}", Sha256::digest(text.as_bytes())) == expected
        })
}
