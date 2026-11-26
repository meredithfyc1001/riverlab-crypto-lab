//! Evidence from the bundled UI, scoped to a newly created synthetic test profile.
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

pub struct Acceptance {
    pub directory: PathBuf,
    engine_version: String,
}

impl Acceptance {
    pub fn create(profile: &Path, engine_version: &str) -> io::Result<Self> {
        let id = profile
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let uuid = id
            .strip_prefix("test-ci-")
            .and_then(|value| uuid::Uuid::parse_str(value).ok());
        if !uuid.is_some_and(|value| format!("test-ci-{value}") == id) {
            return Err(io::Error::other("原生验收需要全新的 ci-<UUID> 配置。"));
        }
        // The parent is the fixed application Profiles directory. Never reuse a profile,
        // even after a failed or interrupted run.
        fs::create_dir(profile)?;
        let directory = profile.join("acceptance");
        fs::create_dir(&directory)?;
        Ok(Self {
            directory,
            engine_version: engine_version.to_owned(),
        })
    }

    pub fn record(&self, name: &str, json: &str) -> Result<(), String> {
        if !matches!(
            name,
            "ready" | "worker-ready" | "research-start" | "research-end" | "result" | "error"
        ) {
            return Err("未知的验收阶段。".into());
        }
        if json.len() > 1024 * 1024 {
            return Err("验收结果超过 1 MiB。".into());
        }
        let record: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(json).map_err(|error| error.to_string())?;
        self.publish(name, record)
    }

    #[cfg(windows)]
    pub fn record_page_load(&self, trusted_origin: bool, path: &str) {
        let (name, page) = match (trusted_origin, path) {
            (true, "/" | "/index.html") => ("host-workbench-loaded", "workbench"),
            (true, "/tests/desktop-6a/index.html") => ("host-probe-loaded", "probe"),
            _ => ("host-unexpected-page", "unexpected"),
        };
        // Record the first occurrence of each native event. No browser URL, query
        // string, page content or user-supplied path is included in diagnostics.
        let mut record = serde_json::Map::new();
        record.insert("event".into(), "PageLoadFinished".into());
        record.insert("page".into(), page.into());
        record.insert("trustedOrigin".into(), trusted_origin.into());
        let _ = self.publish(name, record);
    }

    fn publish(
        &self,
        name: &str,
        mut record: serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        record.insert(
            "engineVersion".to_owned(),
            self.engine_version.clone().into(),
        );
        let mut file =
            tempfile::NamedTempFile::new_in(&self.directory).map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut file, &record).map_err(|error| error.to_string())?;
        file.flush()
            .and_then(|_| file.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        file.persist_noclobber(self.directory.join(format!("{name}.json")))
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_fresh_ci_profile_can_publish_evidence() {
        let temp = tempfile::tempdir().unwrap();
        assert!(Acceptance::create(&temp.path().join("default"), "120").is_err());
        let path = temp
            .path()
            .join("test-ci-f48bc40d-54a7-4a04-9b09-19b7ee506353");
        let evidence = Acceptance::create(&path, "120.0.0.0").unwrap();
        assert!(Acceptance::create(&path, "120").is_err());
        assert!(evidence.record("../outside", "{}").is_err());
        assert!(evidence.record("ready", "[]").is_err());
        assert!(evidence
            .record("ready", &"x".repeat(1024 * 1024 + 1))
            .is_err());
        evidence.record("ready", r#"{"step":"workbench"}"#).unwrap();
        assert!(evidence.record("ready", "{}").is_err());
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(evidence.directory.join("ready.json")).unwrap())
                .unwrap();
        assert_eq!(saved["step"], "workbench");
        assert_eq!(saved["engineVersion"], "120.0.0.0");
        assert_eq!(fs::read_dir(evidence.directory).unwrap().count(), 1);
    }
}
