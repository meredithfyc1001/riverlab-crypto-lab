fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest = tauri_build::AppManifest::new().commands(&[
            "local_service_health",
            "local_service_integrity",
            "local_service_backup",
            "repository_handshake",
            "repository_command",
            "repository_upload_chunk",
            "repository_read_chunk",
            "verify_sqlite",
            "qa_record",
            "save_report_download",
        ]);
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
            .expect("failed to prepare the RiverLab Windows application");
    }
}
