fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest = tauri_build::AppManifest::new().commands(&["verify_sqlite"]);
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
            .expect("failed to prepare the RiverLab Windows application");
    }
}
