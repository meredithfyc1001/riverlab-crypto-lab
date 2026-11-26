//! Versioned IPC for a single trusted document. Body transfers have one acknowledged
//! chunk in flight. Only a completely verified upload reaches a SQLite transaction.
use crate::repository::{Kind, Operation, Record, RepoError, Response, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

const VERSION: u32 = 1;
const CHUNK: usize = 1024 * 1024;
const MAX_BODY: usize = 256 * CHUNK;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Serialize)]
pub struct WireError {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl WireError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: matches!(
                code,
                "busy" | "diskFull" | "permissionDenied" | "unavailable"
            ),
        }
    }
}

impl From<RepoError> for WireError {
    fn from(error: RepoError) -> Self {
        Self::new(error.code, error.message)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    protocol_version: u32,
    session_id: String,
    request_id: String,
}

#[derive(Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    BeginSave {
        kind: Kind,
        id: String,
        summary_length: usize,
        length: usize,
    },
    Commit {
        sha256: String,
    },
    Load {
        kind: Kind,
        id: String,
    },
    List {
        kind: Kind,
    },
    Delete {
        kind: Kind,
        id: String,
    },
    Cancel,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handshake<'a> {
    protocol_version: u32,
    minor_version: u32,
    schema_version: u32,
    session_id: &'a str,
    chunk_bytes: usize,
    max_body_bytes: usize,
    capabilities: [&'static str; 4],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    request_id: String,
    #[serde(flatten)]
    result: Outcome,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum Outcome {
    Ready,
    Missing,
    Committed,
    Cancelled,
    Download { length: usize, sha256: String },
}

enum Transfer {
    Upload {
        kind: Kind,
        id: String,
        summary_length: usize,
        length: usize,
        buffer: Vec<u8>,
        hash: Sha256,
    },
    Download {
        buffer: Vec<u8>,
        offset: usize,
    },
}

impl Transfer {
    fn size(&self) -> usize {
        match self {
            Self::Upload {
                length,
                summary_length,
                ..
            } => *length + *summary_length,
            Self::Download { buffer, .. } => buffer.len(),
        }
    }
}

struct Active {
    last_activity: Instant,
    transfer: Transfer,
}

#[derive(Default)]
struct Transfers {
    active: HashMap<Uuid, Active>,
    // A lost commit reply may be retried without inserting the record twice.
    committed: VecDeque<Uuid>,
}

impl Transfers {
    fn prepare(&mut self, id: Uuid) -> Result<(), WireError> {
        self.active
            .retain(|_, transfer| transfer.last_activity.elapsed() < IDLE_TIMEOUT);
        if self.active.contains_key(&id) || self.committed.contains(&id) {
            return Err(WireError::new("conflict", "该传输标识已使用。"));
        }
        if self.active.len() >= 8 {
            return Err(WireError::new("busy", "并发传输达到上限，请稍后重试。"));
        }
        Ok(())
    }

    fn insert(&mut self, id: Uuid, transfer: Transfer) -> Result<(), WireError> {
        let reserved = self
            .active
            .values()
            .map(|state| state.transfer.size())
            .sum::<usize>();
        if reserved + transfer.size() > 2 * MAX_BODY + CHUNK {
            return Err(WireError::new("busy", "并发传输超过内存预算。"));
        }
        self.active.insert(
            id,
            Active {
                last_activity: Instant::now(),
                transfer,
            },
        );
        Ok(())
    }

    fn current(&mut self, id: &Uuid) -> Result<&mut Transfer, WireError> {
        let active = self
            .active
            .get_mut(id)
            .ok_or_else(|| WireError::new("cancelled", "传输不存在或已结束。"))?;
        if active.last_activity.elapsed() >= IDLE_TIMEOUT {
            return Err(WireError::new("cancelled", "传输已超时，请重新打开。"));
        }
        active.last_activity = Instant::now();
        Ok(&mut active.transfer)
    }
}

// Count and byte lengths are little-endian u32. Keep individual JSON documents
// intact, so an invalid row can be isolated without escaping every other row.
fn encode_summaries(rows: Vec<String>) -> Result<Vec<u8>, WireError> {
    let length = rows
        .iter()
        .try_fold(4usize, |total, row| {
            total
                .checked_add(4)?
                .checked_add(row.len())
                .filter(|n| *n <= MAX_BODY)
        })
        .ok_or_else(|| WireError::new("limit", "摘要列表超过内存预算。"))?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length)
        .map_err(|_| WireError::new("limit", "内存不足，无法读取摘要。"))?;
    bytes.extend_from_slice(&(rows.len() as u32).to_le_bytes());
    for row in rows {
        bytes.extend_from_slice(&(row.len() as u32).to_le_bytes());
        bytes.extend_from_slice(row.as_bytes());
    }
    Ok(bytes)
}

pub struct Protocol {
    session: String,
    transfers: Mutex<Transfers>,
}

impl Protocol {
    pub fn new() -> Self {
        Self {
            session: Uuid::new_v4().to_string(),
            transfers: Mutex::new(Transfers::default()),
        }
    }

    fn handshake(&self, version: u32) -> Result<Handshake<'_>, WireError> {
        if version != VERSION {
            return Err(WireError::new("version", "桌面数据协议版本不兼容。"));
        }
        Ok(Handshake {
            protocol_version: VERSION,
            minor_version: 0,
            schema_version: SCHEMA_VERSION,
            session_id: &self.session,
            chunk_bytes: CHUNK,
            max_body_bytes: MAX_BODY,
            capabilities: ["read", "list", "write", "delete"],
        })
    }

    fn identify(&self, frame: &Frame) -> Result<Uuid, WireError> {
        if frame.protocol_version != VERSION {
            return Err(WireError::new("version", "桌面数据协议版本不兼容。"));
        }
        if frame.session_id != self.session {
            return Err(WireError::new(
                "session",
                "本地服务会话已变更，请重新打开。",
            ));
        }
        Uuid::parse_str(&frame.request_id)
            .map_err(|_| WireError::new("invalidRequest", "请求标识无效。"))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Transfers>, WireError> {
        self.transfers
            .lock()
            .map_err(|_| WireError::new("unavailable", "本地服务未就绪。"))
    }

    fn command(
        &self,
        frame: Frame,
        command: Command,
        execute: impl FnOnce(Operation) -> Result<Response, RepoError>,
    ) -> Result<Reply, WireError> {
        let key = self.identify(&frame)?;
        let mut transfers = self.lock()?;
        let result = match command {
            Command::BeginSave {
                kind,
                id,
                summary_length,
                length,
            } => {
                transfers.prepare(key)?;
                if length == 0
                    || length > MAX_BODY
                    || summary_length == 0
                    || summary_length > 20 * CHUNK
                    || id.is_empty()
                    || id.len() > 1024
                {
                    return Err(WireError::new("limit", "记录、标识或摘要超过协议限制。"));
                }
                transfers.insert(
                    key,
                    Transfer::Upload {
                        kind,
                        id,
                        summary_length,
                        length,
                        buffer: Vec::new(),
                        hash: Sha256::new(),
                    },
                )?;
                Outcome::Ready
            }
            Command::Commit { sha256 } => {
                if transfers.committed.contains(&key) {
                    Outcome::Committed
                } else {
                    transfers.current(&key)?;
                    let Some(Active {
                        transfer:
                            Transfer::Upload {
                                kind,
                                id,
                                summary_length,
                                length,
                                mut buffer,
                                hash,
                            },
                        ..
                    }) = transfers.active.remove(&key)
                    else {
                        return Err(WireError::new("invalidRequest", "请求不是写入操作。"));
                    };
                    if length + summary_length != buffer.len()
                        || sha256 != format!("{:x}", hash.finalize())
                    {
                        return Err(WireError::new(
                            "digestMismatch",
                            "传输长度或 SHA-256 不符，未提交。",
                        ));
                    }
                    let summary = String::from_utf8(buffer.split_off(length))
                        .map_err(|_| WireError::new("invalidRequest", "摘要不是有效 UTF-8。"))?;
                    let body = String::from_utf8(buffer)
                        .map_err(|_| WireError::new("invalidRequest", "正文不是有效 UTF-8。"))?;
                    execute(Operation::Save {
                        records: vec![Record {
                            kind,
                            id,
                            body,
                            summary,
                        }],
                    })?;
                    if transfers.committed.len() >= 1024 {
                        transfers.committed.pop_front();
                    }
                    transfers.committed.push_back(key);
                    Outcome::Committed
                }
            }
            Command::Load { .. } | Command::List { .. } => {
                transfers.prepare(key)?;
                let operation = match command {
                    Command::Load { kind, id } => Operation::Load { kind, id },
                    Command::List { kind } => Operation::List { kind },
                    _ => unreachable!(),
                };
                let buffer = match execute(operation)? {
                    Response::Body(body) => body.map(String::into_bytes),
                    Response::Summaries(rows) => Some(encode_summaries(rows)?),
                    _ => return Err(WireError::new("unavailable", "未获得读取回执。")),
                };
                match buffer {
                    None => Outcome::Missing,
                    Some(buffer) => {
                        let length = buffer.len();
                        if length == 0 || length > MAX_BODY {
                            return Err(WireError::new("limit", "读取内容超过协议限制。"));
                        }
                        let sha256 = format!("{:x}", Sha256::digest(&buffer));
                        transfers.insert(key, Transfer::Download { buffer, offset: 0 })?;
                        Outcome::Download { length, sha256 }
                    }
                }
            }
            Command::Delete { kind, id } => {
                transfers.prepare(key)?;
                execute(Operation::Delete { kind, id })?;
                Outcome::Committed
            }
            Command::Cancel => {
                transfers.active.remove(&key);
                if transfers.committed.contains(&key) {
                    Outcome::Committed
                } else {
                    Outcome::Cancelled
                }
            }
        };
        Ok(Reply {
            request_id: frame.request_id,
            result,
        })
    }

    fn upload(&self, frame: Frame, offset: usize, chunk: &[u8]) -> Result<usize, WireError> {
        let key = self.identify(&frame)?;
        let mut transfers = self.lock()?;
        let Transfer::Upload {
            length,
            summary_length,
            buffer,
            hash,
            ..
        } = transfers.current(&key)?
        else {
            return Err(WireError::new("invalidRequest", "不是写入传输。"));
        };
        let boundary = if offset < *length {
            *length
        } else {
            *length + *summary_length
        };
        if offset != buffer.len() || chunk.is_empty() || chunk.len() != CHUNK.min(boundary - offset)
        {
            return Err(WireError::new("sequence", "数据块偏移或长度错误。"));
        }
        buffer
            .try_reserve_exact(if offset == 0 {
                *length + *summary_length
            } else {
                chunk.len()
            })
            .map_err(|_| WireError::new("limit", "内存不足，写入未提交。"))?;
        buffer.extend_from_slice(chunk);
        hash.update(chunk);
        Ok(buffer.len())
    }

    fn read(&self, frame: Frame, expected: usize) -> Result<Vec<u8>, WireError> {
        let key = self.identify(&frame)?;
        let mut transfers = self.lock()?;
        let Transfer::Download { buffer, offset } = transfers.current(&key)? else {
            return Err(WireError::new("invalidRequest", "不是读取传输。"));
        };
        if *offset != expected {
            return Err(WireError::new("sequence", "读取偏移错误。"));
        }
        let end = buffer.len().min(*offset + CHUNK);
        let chunk = buffer[*offset..end].to_vec();
        *offset = end;
        if end == buffer.len() {
            transfers.active.remove(&key);
        }
        Ok(chunk)
    }
}

#[cfg(windows)]
pub mod commands {
    use super::*;
    use crate::{desktop::trusted_service_window, service::LocalService};
    use tauri::{
        ipc::{InvokeBody, Request, Response as Binary},
        AppHandle, Manager, State, WebviewWindow,
    };

    fn authorize(window: &WebviewWindow) -> Result<(), WireError> {
        trusted_service_window(window)
            .map_err(|message| WireError::new("permissionDenied", message))
    }

    #[tauri::command]
    pub async fn repository_handshake(
        window: WebviewWindow,
        protocol: State<'_, Protocol>,
        protocol_version: u32,
    ) -> Result<serde_json::Value, WireError> {
        authorize(&window)?;
        serde_json::to_value(protocol.handshake(protocol_version)?)
            .map_err(|_| WireError::new("unavailable", "握手失败。"))
    }

    #[tauri::command]
    pub async fn repository_command(
        window: WebviewWindow,
        app: AppHandle,
        frame: Frame,
        command: Command,
    ) -> Result<Reply, WireError> {
        authorize(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Protocol>().command(frame, command, |op| {
                app.state::<LocalService>()
                    .with_repository(|repository| repository.execute(op))
            })
        })
        .await
        .map_err(|_| WireError::new("unavailable", "本地命令未完成。"))?
    }

    #[tauri::command]
    pub async fn repository_upload_chunk(
        window: WebviewWindow,
        app: AppHandle,
        request: Request<'_>,
    ) -> Result<usize, WireError> {
        authorize(&window)?;
        let InvokeBody::Raw(chunk) = request.body() else {
            return Err(WireError::new("invalidRequest", "需要二进制数据块。"));
        };
        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| WireError::new("invalidRequest", "缺少传输头。"))
        };
        let frame = Frame {
            protocol_version: header("x-riverlab-version")?
                .parse()
                .map_err(|_| WireError::new("version", "无效协议版本。"))?,
            session_id: header("x-riverlab-session")?.to_owned(),
            request_id: header("x-riverlab-request")?.to_owned(),
        };
        let offset = header("x-riverlab-offset")?
            .parse()
            .map_err(|_| WireError::new("sequence", "无效偏移。"))?;
        if chunk.len() > CHUNK {
            return Err(WireError::new("limit", "数据块超过传输上限。"));
        }
        let bytes = chunk.clone();
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Protocol>().upload(frame, offset, &bytes)
        })
        .await
        .map_err(|_| WireError::new("unavailable", "本地写入未完成。"))?
    }

    #[tauri::command]
    pub async fn repository_read_chunk(
        window: WebviewWindow,
        app: AppHandle,
        frame: Frame,
        offset: usize,
    ) -> Result<Binary, WireError> {
        authorize(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Protocol>().read(frame, offset).map(Binary::new)
        })
        .await
        .map_err(|_| WireError::new("unavailable", "本地读取未完成。"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn frame(protocol: &Protocol, key: Uuid) -> Frame {
        Frame {
            protocol_version: VERSION,
            session_id: protocol.session.clone(),
            request_id: key.to_string(),
        }
    }

    fn metadata(protocol: &Protocol, key: Uuid, command: Command) -> Result<Reply, WireError> {
        protocol.command(frame(protocol, key), command, |_| {
            panic!("metadata must not reach SQLite")
        })
    }

    fn begin(protocol: &Protocol, key: Uuid, length: usize) -> Result<Reply, WireError> {
        metadata(
            protocol,
            key,
            Command::BeginSave {
                kind: Kind::Experiment,
                id: "实验 1".into(),
                summary_length: 2,
                length,
            },
        )
    }

    #[test]
    fn version_session_sequence_digest_and_cancel_gate_commit() {
        let protocol = Protocol::new();
        let key = Uuid::new_v4();
        assert!(protocol.handshake(VERSION + 1).is_err());
        let mut old = frame(&protocol, key);
        old.session_id = Protocol::new().session;
        assert!(protocol.identify(&old).is_err());
        assert!(begin(&protocol, key, MAX_BODY + 1).is_err());
        begin(&protocol, key, 5).unwrap();
        assert!(protocol.upload(frame(&protocol, key), 1, b"abcde").is_err());
        assert!(protocol.upload(frame(&protocol, key), 0, b"abc").is_err());
        protocol.upload(frame(&protocol, key), 0, b"abcde").unwrap();
        protocol.upload(frame(&protocol, key), 5, b"{}").unwrap();
        assert!(metadata(
            &protocol,
            key,
            Command::Commit {
                sha256: "mismatch".into()
            }
        )
        .is_err());
        let key = Uuid::new_v4();
        begin(&protocol, key, 5).unwrap();
        metadata(&protocol, key, Command::Cancel).unwrap();
        assert!(protocol.upload(frame(&protocol, key), 0, b"abcde").is_err());
    }

    #[test]
    fn read_and_write_exchange_raw_chunks_and_commit_once() {
        let protocol = Protocol::new();
        let key = Uuid::new_v4();
        let body = "a".repeat(CHUNK - 1) + "汉 字";
        let data = body.as_bytes();
        let digest = format!("{:x}", Sha256::digest(data));
        begin(&protocol, key, data.len()).unwrap();
        for (i, chunk) in data.chunks(CHUNK).enumerate() {
            let offset = i * CHUNK;
            assert_eq!(
                protocol
                    .upload(frame(&protocol, key), offset, chunk)
                    .unwrap(),
                offset + chunk.len()
            );
        }
        protocol
            .upload(frame(&protocol, key), data.len(), b"{}")
            .unwrap();
        let wire_hash = format!(
            "{:x}",
            Sha256::new()
                .chain_update(data)
                .chain_update(b"{}")
                .finalize()
        );
        let calls = Cell::new(0);
        for _ in 0..2 {
            protocol
                .command(
                    frame(&protocol, key),
                    Command::Commit {
                        sha256: wire_hash.clone(),
                    },
                    |op| {
                        let Operation::Save { records } = op else {
                            panic!("expected save");
                        };
                        assert_eq!(records[0].body, body);
                        calls.set(calls.get() + 1);
                        Ok(Response::Done)
                    },
                )
                .unwrap();
        }
        assert_eq!(calls.get(), 1);
        assert!(matches!(
            metadata(&protocol, key, Command::Cancel).unwrap().result,
            Outcome::Committed
        ));

        let key = Uuid::new_v4();
        let start = protocol
            .command(
                frame(&protocol, key),
                Command::Load {
                    kind: Kind::Experiment,
                    id: "实验 1".into(),
                },
                |_| Ok(Response::Body(Some(body.clone()))),
            )
            .unwrap();
        assert!(
            matches!(start.result, Outcome::Download { length, sha256 } if length == data.len() && sha256 == digest)
        );
        assert!(protocol.read(frame(&protocol, key), 1).is_err());
        assert_eq!(
            protocol.read(frame(&protocol, key), 0).unwrap(),
            data[..CHUNK]
        );
        assert_eq!(
            protocol.read(frame(&protocol, key), CHUNK).unwrap(),
            data[CHUNK..]
        );
        assert!(protocol.read(frame(&protocol, key), data.len()).is_err());
    }

    #[test]
    fn summary_frame_preserves_original_bytes_and_invalid_rows() {
        let frame = encode_summaries(vec!["汉".into(), "{".into()]).unwrap();
        let expected = [2, 0, 0, 0, 3, 0, 0, 0, 0xe6, 0xb1, 0x89, 1, 0, 0, 0, b'{'];
        assert_eq!(frame, expected);
    }

    #[test]
    fn abandoned_uploads_expire_and_do_not_exhaust_transfer_budget() {
        let protocol = Protocol::new();
        let stalled = Uuid::new_v4();
        begin(&protocol, stalled, MAX_BODY).unwrap();
        let second = Uuid::new_v4();
        begin(&protocol, second, MAX_BODY).unwrap();
        assert!(begin(&protocol, Uuid::new_v4(), MAX_BODY).is_err());
        protocol
            .lock()
            .unwrap()
            .active
            .get_mut(&stalled)
            .unwrap()
            .last_activity = Instant::now() - IDLE_TIMEOUT;
        assert!(protocol.upload(frame(&protocol, stalled), 0, &[1]).is_err());
        begin(&protocol, Uuid::new_v4(), CHUNK).unwrap();
    }
}
