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
    let stage = NamedTempFile::new_in(directory).map_err(file_error)?;
    save_staged_report(stage, directory, expected, |file| file.write_all(bytes))
}

fn save_staged_report(
    mut stage: NamedTempFile,
    directory: &Path,
    expected: &str,
    write_report: impl FnOnce(&mut fs::File) -> io::Result<()>,
) -> Result<SavedReport, String> {
    write_report(stage.as_file_mut()).map_err(file_error)?;
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
            Err(failure) => {
                // Close our own handle before the temporary path attempts cleanup on Windows.
                drop(failure.file.into_temp_path());
                return Err(file_error(failure.error));
            }
        }
    }
    Err("下载目录中同名文件过多，无法分配新文件名。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = include_bytes!("../../tests/fixtures/desktop-download-synthetic.json");
    const SAMPLE_SHA: &str = "66488534115389a00ba3d4955ccae5a8c9d74eb06704f018098a8d943ed6451f";

    fn save_sample(dir: &Path) -> Result<SavedReport, String> {
        save_report(dir, SAMPLE, SAMPLE_SHA)
    }

    fn verify_retry_preserves_original(dir: &Path, original: &Path, original_bytes: &[u8]) {
        assert_eq!(fs::read(original).unwrap(), original_bytes);
        assert_eq!(fs::read_dir(dir).unwrap().count(), 1);
        let retry = save_sample(dir).unwrap();
        assert_eq!(retry.path, dir.join(format!("{REPORT_STEM} (1).json")));
        let bytes = fs::read(&retry.path).unwrap();
        assert_eq!(bytes, SAMPLE);
        assert_eq!(retry.sha256, SAMPLE_SHA);
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), SAMPLE_SHA);
        assert_eq!(fs::read(original).unwrap(), original_bytes);
        assert_eq!(fs::read_dir(dir).unwrap().count(), 2);
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
            assert_eq!(content, SAMPLE);
            assert_eq!(report.sha256, SAMPLE_SHA);
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
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("downloads");
        fs::create_dir(&dir).unwrap();
        let original = dir.join(format!("{REPORT_STEM}.json"));
        let original_bytes = b"synthetic pre-existing download";
        fs::write(&original, original_bytes).unwrap();
        #[cfg(unix)]
        let result = {
            use std::os::unix::fs::PermissionsExt;
            let previous = fs::metadata(&dir).unwrap().permissions();
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
            let result = save_sample(&dir);
            fs::set_permissions(&dir, previous).unwrap();
            result
        };
        #[cfg(windows)]
        let result = {
            let deny = std::process::Command::new("icacls")
                .arg(&dir)
                .args(["/deny", "*S-1-1-0:(WD)"])
                .status()
                .unwrap();
            assert!(deny.success());
            let result = save_sample(&dir);
            let restore = std::process::Command::new("icacls")
                .arg(&dir)
                .args(["/remove:d", "*S-1-1-0"])
                .status()
                .unwrap();
            assert!(restore.success());
            result
        };
        let error = result.unwrap_err();
        assert!(error.starts_with("下载目录权限不足"), "{error}");
        #[cfg(windows)]
        assert!(error.contains("os error 5"), "{error}");
        verify_retry_preserves_original(&dir, &original, original_bytes);
    }

    #[test]
    fn unavailable_directory_reports_save_error_and_retries_after_restoration() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("downloads");
        fs::create_dir(&directory).unwrap();
        let original = directory.join(format!("{REPORT_STEM}.json"));
        let original_bytes = b"synthetic pre-existing download";
        fs::write(&original, original_bytes).unwrap();
        let aside = root.path().join("disconnected");
        fs::rename(&directory, &aside).unwrap();
        let error = save_sample(&directory).unwrap_err();
        assert!(error.starts_with("无法保存报告"), "{error}");
        assert!(!directory.exists());
        fs::rename(aside, &directory).unwrap();
        verify_retry_preserves_original(&directory, &original, original_bytes);
    }

    #[test]
    fn disk_full_after_a_partial_write_publishes_nothing_and_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join(format!("{REPORT_STEM}.json"));
        let original_bytes = b"synthetic pre-existing download";
        fs::write(&original, original_bytes).unwrap();
        let stage = NamedTempFile::new_in(dir.path()).unwrap();
        let stage_path = stage.path().to_owned();

        // Store a real prefix, then inject a disk-full error without filling the disk.
        let error = save_staged_report(stage, dir.path(), SAMPLE_SHA, |file| {
            file.write_all(&SAMPLE[..17])?;
            assert_eq!(file.metadata()?.len(), 17);
            #[cfg(windows)]
            let disk_full = io::Error::from_raw_os_error(112); // ERROR_DISK_FULL
            #[cfg(not(windows))]
            let disk_full = io::Error::from_raw_os_error(28); // ENOSPC
            Err(disk_full)
        })
        .unwrap_err();
        assert!(error.starts_with("无法保存报告"), "{error}");
        #[cfg(windows)]
        assert!(error.contains("os error 112"), "{error}");
        assert!(!stage_path.exists());
        verify_retry_preserves_original(dir.path(), &original, original_bytes);
    }

    #[cfg(windows)]
    #[test]
    fn exclusive_stage_reports_real_sharing_violation_and_retry_publishes_verified_bytes() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join(format!("{REPORT_STEM}.json"));
        let original_bytes = b"synthetic pre-existing download";
        fs::write(&original, original_bytes).unwrap();

        // Only this test creates the verified staging file without FILE_SHARE_DELETE.
        // Windows denies the production no-replace rename until this handle is closed.
        let stage = tempfile::Builder::new()
            .make_in(dir.path(), |path| {
                fs::OpenOptions::new()
                    .create_new(true)
                    .read(true)
                    .write(true)
                    .share_mode(0)
                    .open(path)
            })
            .unwrap();
        let stage_path = stage.path().to_owned();
        let error =
            save_staged_report(stage, dir.path(), SAMPLE_SHA, |file| file.write_all(SAMPLE))
                .unwrap_err();
        assert!(error.starts_with("文件被占用"), "{error}");
        assert!(error.contains("os error 32"), "{error}");
        assert!(
            !stage_path.exists(),
            "private staging file leaked after failure"
        );
        verify_retry_preserves_original(dir.path(), &original, original_bytes);
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
