//! The application owns one service and one writer for each isolated data root.
use crate::repository::{RepoError, Repository, SCHEMA_VERSION};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const DATABASE: &str = "research.sqlite3";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    protocol_version: u32,
    service_version: &'static str,
    schema_version: u32,
    status: &'static str,
    data_directory: PathBuf,
    available_bytes: u64,
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(unix)]
    {
        metadata.file_type().is_symlink()
    }
}

// Each caller passes one fixed child of a trusted, existing parent. Never follow
// directory links (including Windows junctions) out of the service's namespace.
pub fn private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let meta = fs::symlink_metadata(path)?;
            if is_link(&meta) || !meta.is_dir() {
                return Err(io::Error::other(format!(
                    "拒绝重定向或非目录路径：{}",
                    path.display()
                )));
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn validate_file(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if is_link(&metadata) || !metadata.is_file() {
        return Err(io::Error::other(format!(
            "拒绝链接或特殊文件：{}",
            path.display()
        )));
    }
    #[cfg(unix)]
    let links = {
        use std::os::unix::fs::MetadataExt;
        metadata.nlink()
    };
    #[cfg(windows)]
    let links = {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let file = File::open(path)?;
        let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
        // The OS receives a live handle and writes one complete structure on success.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        unsafe { info.assume_init() }.nNumberOfLinks as u64
    };
    if links != 1 {
        return Err(io::Error::other(format!(
            "拒绝多重硬链接：{}",
            path.display()
        )));
    }
    Ok(())
}

fn write_probe(directory: &Path) -> io::Result<()> {
    let mut probe = tempfile::NamedTempFile::new_in(directory)?;
    probe.write_all(b"riverlab")?;
    probe.as_file().sync_all()?;
    probe.close()
}

#[cfg(windows)]
fn available_bytes(directory: &Path) -> io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let name: Vec<u16> = directory.as_os_str().encode_wide().chain([0]).collect();
    let mut available = 0;
    // A NUL-terminated UTF-16 folder and a writable u64 live through this call.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            name.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(available)
    }
}

#[cfg(unix)]
fn available_bytes(directory: &Path) -> io::Result<u64> {
    let stat = rustix::fs::statvfs(directory)?;
    Ok(stat.f_bavail.saturating_mul(stat.f_frsize))
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

struct Running {
    repository: Repository,
    log: File,
    // Keep the same file and inode across restarts. The OS releases the lock on exit.
    lock: File,
}

pub struct LocalService {
    root: PathBuf,
    running: Mutex<Option<Running>>,
}

impl LocalService {
    pub fn start(root: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        private_directory(root)?;
        let lock_path = root.join("service.lock");
        validate_file(&lock_path)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err("本地服务已在此数据目录运行。".into())
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
        }

        for directory in ["database", "logs", "backups"] {
            let child = root.join(directory);
            private_directory(&child)?;
            write_probe(&child)?;
        }
        if available_bytes(root)? == 0 {
            return Err("用户数据目录磁盘空间不足。".into());
        }
        let database = root.join("database");
        for suffix in ["", "-wal", "-shm", "-journal"] {
            validate_file(&database.join(format!("{DATABASE}{suffix}")))?;
        }
        let log_path = root.join("logs").join("service.log");
        validate_file(&log_path)?;
        let mut log = OpenOptions::new()
            .append(true)
            .create(true)
            .open(log_path)?;
        // Unix systems may put the entire OS temp/profile area behind an alias
        // (e.g. macOS /var). Canonicalize the already-checked parent for NOFOLLOW.
        #[cfg(unix)]
        let database = fs::canonicalize(database)?;
        let repository = Repository::open(&database.join(DATABASE))?;
        writeln!(log, "{} start {}", timestamp(), env!("CARGO_PKG_VERSION"))?;
        Ok(Self {
            root: root.to_owned(),
            running: Mutex::new(Some(Running {
                repository,
                log,
                lock,
            })),
        })
    }

    pub fn with_repository<T>(
        &self,
        f: impl FnOnce(&mut Repository) -> Result<T, RepoError>,
    ) -> Result<T, RepoError> {
        let mut guard = self
            .running
            .lock()
            .map_err(|_| RepoError::new("unavailable", "本地服务异常，请关闭并重新启动。"))?;
        let state = guard
            .as_mut()
            .ok_or_else(|| RepoError::new("unavailable", "本地服务已关闭。"))?;
        f(&mut state.repository)
    }

    pub fn health(&self) -> Result<Health, String> {
        self.with_repository(|repo| repo.health_check())
            .map_err(|err| err.to_string())?;
        for directory in ["database", "logs", "backups"] {
            let child = self.root.join(directory);
            let result = fs::symlink_metadata(&child).and_then(|meta| {
                if !meta.is_dir() || is_link(&meta) {
                    return Err(io::Error::other("目录类型或权限已变化。"));
                }
                write_probe(&child)
            });
            result.map_err(|err| format!("目录读写检查失败：{}：{err}", child.display()))?;
        }
        Ok(Health {
            protocol_version: 1,
            service_version: env!("CARGO_PKG_VERSION"),
            schema_version: SCHEMA_VERSION,
            status: "running",
            data_directory: self.root.clone(),
            available_bytes: available_bytes(&self.root).map_err(|err| err.to_string())?,
        })
    }

    pub fn backup(&self) -> Result<PathBuf, String> {
        let directory = self.root.join("backups");
        private_directory(&directory).map_err(|err| err.to_string())?;
        // Close the staging handle so SQLite and Windows can open and rename it.
        let temporary = tempfile::NamedTempFile::new_in(&directory)
            .map_err(|err| err.to_string())?
            .into_temp_path();
        self.with_repository(|repo| repo.backup(&temporary))
            .map_err(|err| err.to_string())?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&temporary)
            .map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
        drop(file);
        let name = directory.join(format!(
            "research-{}-{}.sqlite3",
            timestamp(),
            uuid::Uuid::new_v4()
        ));
        temporary
            .persist_noclobber(&name)
            .map_err(|err| err.to_string())?;
        Ok(name)
    }

    // Wait for in-flight transactions, retire the connection and finally unlock.
    // The WAL remains available to SQLite on the next start if checkpoint fails.
    pub fn stop(&self) -> Result<(), RepoError> {
        let mut guard = self
            .running
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(mut state) = guard.take() {
            let checkpoint = state.repository.checkpoint();
            let outcome = if checkpoint.is_ok() {
                "stop"
            } else {
                "checkpoint-error"
            };
            let _ = writeln!(state.log, "{} {}", timestamp(), outcome);
            drop(state.repository);
            drop(state.log);
            // An in-progress fork can briefly share the open file description.
            // Explicitly unlock after the connection closes so immediate restart works.
            let unlock = state
                .lock
                .unlock()
                .map_err(|err| RepoError::new("io", err.to_string()));
            checkpoint?;
            unlock?;
        }
        Ok(())
    }
}

impl Drop for LocalService {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::{Kind, Operation, Record, Response};

    fn folder() -> tempfile::TempDir {
        tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
    }

    #[test]
    fn normal_close_is_idempotent_and_upgraded_executable_reuses_only_user_data() {
        let temp = folder();
        let root = temp.path().join("用户 研究");
        let install = temp.path().join("独立 安装");
        fs::create_dir(&install).unwrap();
        let executable = install.join("app-version-marker");
        fs::write(&executable, b"version 1").unwrap();
        let first = LocalService::start(&root).unwrap();
        assert_eq!(first.health().unwrap().data_directory, root);
        assert!(first.health().unwrap().available_bytes > 0);
        assert!(LocalService::start(&root)
            .err()
            .unwrap()
            .to_string()
            .contains("已在"));
        let body = r#"{"id":"合成","value":"123.000000000000001"}"#;
        first
            .with_repository(|db| {
                db.execute(Operation::Save {
                    records: vec![Record {
                        kind: Kind::Dataset,
                        id: "合成".into(),
                        body: body.into(),
                        summary: r#"{"id":"合成"}"#.into(),
                    }],
                })
            })
            .unwrap();
        let backup = first.backup().unwrap();
        assert_eq!(backup.parent(), Some(root.join("backups").as_path()));
        first.stop().unwrap();
        first.stop().unwrap();
        assert!(first.health().is_err());

        fs::write(&executable, b"version 2").unwrap();
        let upgraded = LocalService::start(&root).unwrap();
        assert_eq!(
            upgraded
                .with_repository(|db| db.execute(Operation::Load {
                    kind: Kind::Dataset,
                    id: "合成".into()
                }))
                .unwrap(),
            Response::Body(Some(body.into()))
        );
        assert!(backup.exists());
        assert_eq!(fs::read_dir(&install).unwrap().count(), 1);
        upgraded.stop().unwrap();
        assert_eq!(
            fs::read_to_string(root.join("logs/service.log"))
                .unwrap()
                .lines()
                .count(),
            4
        );
    }

    #[test]
    fn os_releases_service_lock_after_abnormal_exit() {
        const KEY: &str = "RIVERLAB_TEST_CHILD_SERVICE_LOCK_ROOT";
        if let Some(root) = std::env::var_os(KEY) {
            let _service = LocalService::start(Path::new(&root)).unwrap();
            std::process::exit(54);
        }
        let temp = folder();
        let root = temp.path().join("崩溃 重启");
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "service::tests::os_releases_service_lock_after_abnormal_exit",
            ])
            .env(KEY, &root)
            .status()
            .unwrap();
        assert_eq!(child.code(), Some(54));
        LocalService::start(&root)
            .unwrap()
            .with_repository(|repo| repo.integrity_check())
            .unwrap();
    }

    #[test]
    fn permission_denied_fails_startup_and_preserves_existing_database() {
        let temp = folder();
        let root = temp.path().join("ACL 拒写");
        LocalService::start(&root).unwrap().stop().unwrap();
        let database = root.join("database");
        let original = fs::read(database.join(DATABASE)).unwrap();
        #[cfg(unix)]
        let error = {
            use std::os::unix::fs::PermissionsExt;
            let before = fs::metadata(&database).unwrap().permissions();
            fs::set_permissions(&database, fs::Permissions::from_mode(0o500)).unwrap();
            let failure = LocalService::start(&root).err();
            fs::set_permissions(&database, before).unwrap();
            failure
        };
        #[cfg(windows)]
        let error = {
            use std::process::Command;
            assert!(Command::new("icacls")
                .arg(&database)
                .args(["/deny", "*S-1-1-0:(WD)"])
                .status()
                .unwrap()
                .success());
            let failure = LocalService::start(&root).err();
            assert!(Command::new("icacls")
                .arg(&database)
                .args(["/remove:d", "*S-1-1-0"])
                .status()
                .unwrap()
                .success());
            failure
        };
        assert_eq!(
            error.unwrap().downcast::<io::Error>().unwrap().kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(fs::read(database.join(DATABASE)).unwrap(), original);
        LocalService::start(&root).unwrap().stop().unwrap();
    }

    #[test]
    fn refuses_hard_link_to_existing_external_file() {
        let temp = folder();
        let root = temp.path().join("service");
        private_directory(&root).unwrap();
        private_directory(&root.join("database")).unwrap();
        let outside = temp.path().join("original");
        fs::write(&outside, b"keep original").unwrap();
        fs::hard_link(&outside, root.join("database").join(DATABASE)).unwrap();
        assert!(LocalService::start(&root)
            .err()
            .unwrap()
            .to_string()
            .contains("硬链接"));
        assert_eq!(fs::read(&outside).unwrap(), b"keep original");
    }

    #[test]
    fn refuses_redirected_data_directory() {
        let temp = folder();
        let root = temp.path().join("service");
        private_directory(&root).unwrap();
        let outside = temp.path().join("outside");
        private_directory(&outside).unwrap();
        let link = root.join("database");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .status()
            .unwrap()
            .success());
        assert!(LocalService::start(&root).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }
}
