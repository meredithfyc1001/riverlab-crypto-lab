use std::{ffi::OsStr, fs, path::PathBuf};
const DOWNLOAD_NAME: &str = "riverlab-6a-synthetic-50000.json";
// Stub the valid Blob URL and host inputs only. The filename comparison,
// exists check and mutation are from 121e2fb8, src-tauri/src/main.rs.
struct Url;
impl Url {
    fn scheme(&self) -> &str {
        "blob"
    }
    fn origin(&self) -> Self {
        Url
    }
    fn ascii_serialization(&self) -> &str {
        "https://tauri.localhost"
    }
}
fn accepted(url: Url, destination: &mut PathBuf, download: &PathBuf) -> bool {
    let expected_report = url.scheme() == "blob"
        && url.origin().ascii_serialization() == "https://tauri.localhost"
        && destination.file_name() == Some(OsStr::new(DOWNLOAD_NAME));
    if !expected_report || download.exists() {
        return false;
    }
    *destination = download.clone();
    true
}
// From the repository root, before or after the fix (expected exit code 101):
// mkdir -p work
// rustc docs/phase-6a-evidence/download-baseline.rs -o work/repro-download
// work/repro-download "$(mktemp -d work/baseline-download.XXXXXX)"
fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).unwrap());
    let profile = dir.join("验收 profile");
    let system = dir.join("下载 Downloads");
    fs::create_dir(&profile).unwrap();
    fs::create_dir(&system).unwrap();
    let target = profile.join(DOWNLOAD_NAME);
    let mut suggestion = system.join(DOWNLOAD_NAME);
    println!(
        "case=empty profile and original filename; accepted={}",
        accepted(Url, &mut suggestion, &target)
    );
    let original = system.join(DOWNLOAD_NAME);
    fs::write(&original, b"existing user content").unwrap();
    let mut renamed = system.join("riverlab-6a-synthetic-50000 (1).json");
    println!(
        "case=system Downloads has original, WebView supplies (1); accepted={}",
        accepted(Url, &mut renamed, &target)
    );
    fs::write(&target, b"existing profile content").unwrap();
    let mut repeated = system.join(DOWNLOAD_NAME);
    println!(
        "case=existing native target and original suggestion; accepted={}",
        accepted(Url, &mut repeated, &target)
    );
    println!(
        "original intact={}",
        fs::read(&original).unwrap() == b"existing user content"
    );
    assert!(
        accepted(Url, &mut repeated, &target),
        "repeat download must save a separate file"
    );
}
