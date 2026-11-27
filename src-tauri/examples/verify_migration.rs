//! Acceptance of a standalone synthetic migration candidate through the desktop Repository.
//! Usage: verify_migration <candidate.sqlite3> <independent-python-report.json>
#[allow(dead_code)]
#[path = "../src/repository.rs"]
mod repository;

use repository::{Kind, Operation, Repository, Response, SCHEMA_VERSION};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    error::Error,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read},
    path::Path,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const KINDS: [Kind; 9] = [
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    format: String,
    members: Vec<SourceMember>,
    status: String,
    candidate_sha256: String,
    records: Vec<RecordHashes>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceMember {
    kind: String,
    id: String,
    role: String,
    source_projection_sha256: String,
    source_clone_sha256: String,
}

#[derive(Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RecordHashes {
    kind: String,
    id: String,
    body_sha256: String,
    summary_sha256: String,
}

#[derive(Deserialize)]
struct Identity {
    id: String,
}

#[derive(Serialize)]
struct Readback {
    counts: BTreeMap<String, usize>,
    records: Vec<RecordHashes>,
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn copy_standalone(source: &Path, copy: &Path) -> Result<()> {
    if !fs::symlink_metadata(source)?.is_file() {
        return Err("expected a regular standalone SQLite candidate or backup".into());
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut name = source.as_os_str().to_owned();
        name.push(suffix);
        match fs::symlink_metadata(&name) {
            Ok(_) => {
                return Err(format!(
                    "SQLite sidecar {suffix} exists; close and checkpoint the source"
                )
                .into())
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new().create_new(true).write(true).open(copy)?;
    io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(())
}

fn open_existing(copy: &Path, source_count: usize) -> Result<Repository> {
    // Repository::open can bootstrap a new empty DB for the application. An
    // acceptance input must already be an initialized, supported database.
    let db = Connection::open_with_flags(
        copy,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let version: i64 = db.query_row("PRAGMA main.user_version", [], |row| row.get(0))?;
    if version != i64::from(SCHEMA_VERSION) {
        return Err(format!("expected existing SQLite v{SCHEMA_VERSION}, found v{version}").into());
    }
    let count: i64 = db.query_row("SELECT COUNT(*) FROM migration_members", [], |row| {
        row.get(0)
    })?;
    if count != i64::try_from(source_count)? {
        return Err(
            format!("expected {source_count} structured-clone descriptors, found {count}").into(),
        );
    }
    drop(db);
    Ok(Repository::open(copy)?)
}

type Members<'a> = BTreeMap<(&'a str, &'a str, &'a str), &'a SourceMember>;

fn take<'a>(bytes: &mut &'a [u8], n: usize) -> Result<&'a [u8]> {
    let (head, tail) = bytes
        .split_at_checked(n)
        .ok_or("truncated structured Repository frame")?;
    *bytes = tail;
    Ok(head)
}

fn frame_length(bytes: &mut &[u8]) -> Result<usize> {
    Ok(u32::from_le_bytes(take(bytes, 4)?.try_into()?) as usize)
}

// This is the desktop IPC response framing, not an archive decoder. The
// oracle contains the original bytes' hashes from the independent RLIDB001 reader.
fn verify_structured(
    response: Response,
    kind: &str,
    selected_id: Option<&str>,
    count: usize,
    members: &Members<'_>,
) -> Result<()> {
    let Response::Structured(Some(frame)) = response else {
        return Err("missing structured Repository read".into());
    };
    let mut bytes = frame.as_slice();
    if frame_length(&mut bytes)? != count {
        return Err(format!("wrong structured item count for {kind}").into());
    }
    let role = if selected_id.is_some() || kind == "rule" {
        "body"
    } else {
        "summary"
    };
    let mut previous = None;
    for _ in 0..count {
        let n = frame_length(&mut bytes)?;
        let m = frame_length(&mut bytes)?;
        let projection = take(&mut bytes, n)?;
        let descriptor = take(&mut bytes, m)?;
        let Identity { id } = serde_json::from_slice(projection)?;
        if selected_id.is_some_and(|selected| selected != id)
            || previous
                .as_deref()
                .is_some_and(|last: &str| last >= id.as_str())
        {
            return Err(
                format!("wrong, duplicate or out-of-order structured ID for {kind}/{id}").into(),
            );
        }
        let source = members
            .get(&(kind, id.as_str(), role))
            .ok_or("unknown structured Repository key")?;
        if format!("{:x}", Sha256::digest(projection)) != source.source_projection_sha256
            || format!("{:x}", Sha256::digest(descriptor)) != source.source_clone_sha256
        {
            return Err(
                format!("structured Repository bytes differ for {kind}/{id}/{role}").into(),
            );
        }
        previous = Some(id);
    }
    if !bytes.is_empty() {
        return Err("extra bytes in structured Repository frame".into());
    }
    Ok(())
}

fn verify(
    repo: &mut Repository,
    expected: &[RecordHashes],
    members: &Members<'_>,
) -> Result<Readback> {
    repo.health_check()?;
    repo.integrity_check()?;
    let mut counts = BTreeMap::new();
    let mut records = Vec::with_capacity(expected.len());
    for kind in KINDS {
        let label = serde_json::to_value(kind)?;
        let label = label.as_str().ok_or("invalid Repository kind")?;
        let Response::Summaries(summaries) = repo.execute(Operation::List { kind })? else {
            return Err(format!("missing summary list for {label}").into());
        };
        counts.insert(label.to_owned(), summaries.len());
        verify_structured(
            repo.execute(Operation::ListStructured { kind })?,
            label,
            None,
            summaries.len(),
            members,
        )?;
        for summary in summaries {
            let Identity { id } = serde_json::from_str(&summary)?;
            let Response::Body(Some(body)) = repo.execute(Operation::Load {
                kind,
                id: id.clone(),
            })?
            else {
                return Err(format!("missing body for {label}/{id}").into());
            };
            verify_structured(
                repo.execute(Operation::LoadStructured {
                    kind,
                    id: id.clone(),
                })?,
                label,
                Some(&id),
                1,
                members,
            )?;
            records.push(RecordHashes {
                kind: label.to_owned(),
                id,
                body_sha256: format!("{:x}", Sha256::digest(body.as_bytes())),
                summary_sha256: format!("{:x}", Sha256::digest(summary.as_bytes())),
            });
        }
    }
    records.sort_unstable_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
    if records.len() != expected.len() {
        return Err(format!(
            "Repository returned {} records; independent reference expects {}",
            records.len(),
            expected.len()
        )
        .into());
    }
    for (actual, wanted) in records.iter().zip(expected) {
        if actual != wanted {
            return Err(format!("Repository readback differs for {}/{} (expected {}/{}): body {} vs {}, summary {} vs {}",
                actual.kind,actual.id,wanted.kind,wanted.id,actual.body_sha256,wanted.body_sha256,
                actual.summary_sha256,wanted.summary_sha256).into());
        }
    }
    Ok(Readback { counts, records })
}

fn main() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let [source, reference] = args.as_slice() else {
        return Err("usage: verify_migration <synthetic candidate.sqlite3> <independent Python report.json>".into());
    };
    let mut reference: Reference = serde_json::from_reader(BufReader::new(File::open(reference)?))?;
    if reference.format != "riverlab-python-candidate-check-v1" || reference.status != "PASS" {
        return Err("independent comparison must pass first".into());
    }
    reference
        .records
        .sort_unstable_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
    let members: Members<'_> = reference
        .members
        .iter()
        .map(|m| ((m.kind.as_str(), m.id.as_str(), m.role.as_str()), m))
        .collect();
    if members.len() != reference.members.len() {
        return Err("duplicate source member in independent report".into());
    }
    let mut temporary = tempfile::Builder::new();
    temporary.prefix("riverlab-synthetic-acceptance-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary.permissions(fs::Permissions::from_mode(0o700));
    }
    let temp = temporary.tempdir_in(env::temp_dir().canonicalize()?)?;
    let copied = temp.path().join("candidate.sqlite3");
    let backup = temp.path().join("verified-backup.sqlite3");
    let recovered = temp.path().join("recovered.sqlite3");
    copy_standalone(Path::new(source), &copied)?;
    let candidate_sha256 = file_sha256(&copied)?;
    if candidate_sha256 != reference.candidate_sha256 {
        return Err("candidate SHA-256 differs from the independently checked file".into());
    }
    let mut candidate = open_existing(&copied, members.len())?;
    let direct = verify(&mut candidate, &reference.records, &members)?;
    candidate.backup(&backup)?;
    candidate.checkpoint()?;
    drop(candidate);

    copy_standalone(&backup, &recovered)?;
    let backup_sha256 = file_sha256(&backup)?;
    if file_sha256(&recovered)? != backup_sha256 {
        return Err("restored copy differs from the verified online backup".into());
    }
    let mut restored = open_existing(&recovered, members.len())?;
    let recovery = verify(&mut restored, &reference.records, &members)?;
    restored.checkpoint()?;
    drop(restored);
    let evidence = serde_json::json!({
        "status":"PASS", "schemaVersion":SCHEMA_VERSION, "candidateSha256":candidate_sha256,
        "backupSha256":backup_sha256, "sourceMembersVerifiedOnBothReads":reference.members.len(), "coldOpen":direct, "recoveredBackup":recovery,
    });
    serde_json::to_writer_pretty(io::stdout().lock(), &evidence)?;
    println!();
    Ok(())
}
