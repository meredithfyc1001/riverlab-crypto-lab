//! The caller chooses the directory. Neither the file name nor a path comes from IPC.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    io::{Seek, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

const REPORT_STEM: &str = "riverlab-6a-synthetic-50000";

#[derive(Debug, Serialize)]
pub struct SavedReport {
    path: PathBuf,
    sha256: String,
}

fn file_error(error: io::Error) -> String {
    match error.raw_os_error() {
        #[cfg(windows)]
        Some(32 | 33) => format!("文件被占用，请关闭占用程序后重试。{error}"),
        _ if error.kind() == io::ErrorKind::PermissionDenied => {
            format!("下载目录权限不足，请检查写入权限后重试。{error}")
        }
        _ => format!("无法保存报告，请检查下载目录和磁盘空间后重试。{error}"),
    }
}

pub fn save_report(directory: &Path, bytes: &[u8], expected: &str) -> Result<SavedReport, String> {
    let mut stage = NamedTempFile::new_in(directory).map_err(file_error)?;
    stage.write_all(bytes).map_err(file_error)?;
    stage.as_file().sync_all().map_err(file_error)?;
    stage.rewind().map_err(file_error)?;
    let mut hash = Sha256::new();
    io::copy(&mut stage, &mut hash).map_err(file_error)?;
    let sha256 = format!("{:x}", hash.finalize());
    if sha256 != expected {
        return Err("落盘报告的 SHA-256 不匹配，请重新下载。".into());
    }

    for index in 0_u32.. {
        let filename = if index == 0 {
            format!("{REPORT_STEM}.json")
        } else {
            format!("{REPORT_STEM} ({index}).json")
        };
        let path = directory.join(filename);
        // Publish the already verified file with a no-replace OS operation. On Windows,
        // a locked or read-only existing entry can yield a sharing/permission error.
        match stage.persist_noclobber(&path) {
            Ok(_) => return Ok(SavedReport { path, sha256 }),
            Err(failure)
                if failure.error.kind() == io::ErrorKind::AlreadyExists
                    || fs::symlink_metadata(&path).is_ok() =>
            {
                stage = failure.file;
            }
            Err(failure) => return Err(file_error(failure.error)),
        }
    }
    Err("下载目录中同名文件过多，无法分配新文件名。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn save_sample(dir: &Path) -> Result<SavedReport, String> {
        let bytes = b"synthetic report";
        save_report(dir, bytes, &format!("{:x}", Sha256::digest(bytes)))
    }

    #[test]
    fn concurrent_repeats_preserve_original_and_verify_each_report() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join(format!("{REPORT_STEM}.json"));
        fs::write(&original, b"user content").unwrap();
        let mut saved = std::thread::scope(|scope| {
            let a = scope.spawn(|| save_sample(dir.path()).unwrap());
            let b = scope.spawn(|| save_sample(dir.path()).unwrap());
            [a.join().unwrap(), b.join().unwrap()]
        });
        saved.sort_by(|a, b| a.path.cmp(&b.path));
        for (i, report) in saved.iter().enumerate() {
            assert_eq!(
                report.path,
                dir.path().join(format!("{REPORT_STEM} ({}).json", i + 1))
            );
            let content = fs::read(&report.path).unwrap();
            assert_eq!(content, b"synthetic report");
            assert_eq!(format!("{:x}", Sha256::digest(content)), report.sha256);
        }
        assert_eq!(fs::read(original).unwrap(), b"user content");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
    }

    #[test]
    fn invalid_digest_publishes_nothing_and_retry_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let error = save_report(dir.path(), b"damaged report", &"0".repeat(64)).unwrap_err();
        assert!(error.contains("SHA-256"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert_eq!(
            save_sample(dir.path()).unwrap().path,
            dir.path().join(format!("{REPORT_STEM}.json"))
        );
    }

    #[test]
    fn unwritable_directory_reports_permission_error_and_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let previous = {
            use std::os::unix::fs::PermissionsExt;
            let previous = fs::metadata(dir.path()).unwrap().permissions();
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();
            previous
        };
        #[cfg(windows)]
        {
            let deny = std::process::Command::new("icacls")
                .arg(dir.path())
                .args(["/deny", "*S-1-1-0:(WD)"])
                .status()
                .unwrap();
            assert!(deny.success());
        }
        let result = save_sample(dir.path());
        #[cfg(unix)]
        fs::set_permissions(dir.path(), previous).unwrap();
        #[cfg(windows)]
        {
            let restore = std::process::Command::new("icacls")
                .arg(dir.path())
                .args(["/remove:d", "*S-1-1-0"])
                .status()
                .unwrap();
            assert!(restore.success());
        }
        assert!(result.unwrap_err().contains("权限不足"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(save_sample(dir.path()).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn exclusive_windows_handle_does_not_block_a_separate_report() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join(format!("{REPORT_STEM}.json"));
        fs::write(&original, b"locked original").unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&original)
            .unwrap();
        let saved = save_sample(dir.path()).unwrap();
        assert_eq!(
            saved.path,
            dir.path().join(format!("{REPORT_STEM} (1).json"))
        );
        drop(locked);
        assert_eq!(fs::read(original).unwrap(), b"locked original");
    }
}
