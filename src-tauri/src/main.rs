//! Windows desktop host. Embedded pages access the per-user service through Tauri IPC.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(any(windows, test))]
mod acceptance;
#[cfg(any(windows, test))]
mod download;
#[cfg(any(windows, test))]
mod protocol;
#[cfg(any(windows, test))]
mod repository;
#[cfg(any(windows, test))]
mod service;
#[cfg(any(windows, test))]
mod storage;

#[cfg(windows)]
mod desktop {
    use super::{
        acceptance::Acceptance,
        protocol::Protocol,
        service::{private_directory, Health, LocalService},
    };
    use std::{env, error::Error, ffi::OsStr, io, sync::Arc};
    use tauri::{
        ipc::{InvokeBody, Request},
        webview::{NewWindowResponse, PageLoadEvent},
        Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    #[tauri::command]
    async fn verify_sqlite(
        window: WebviewWindow,
    ) -> Result<super::storage::StorageEvidence, String> {
        let url = window.url().map_err(|error| error.to_string())?;
        if window.label() != "main"
            || url.origin().ascii_serialization() != "https://tauri.localhost"
            || url.path() != "/tests/desktop-6a/index.html"
        {
            return Err("仅内置合成技术验证页可运行此验证。".into());
        }
        let parent = window
            .path()
            .app_local_data_dir()
            .map_err(|err| err.to_string())?
            .join("SQLite 验证");
        tauri::async_runtime::spawn_blocking(move || {
            private_directory(&parent).map_err(|err| err.to_string())?;
            super::storage::verify_sqlite(&parent)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    fn profile_name() -> io::Result<String> {
        if env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
            return Err(io::Error::other(
                "启动应用前请取消 WEBVIEW2_USER_DATA_FOLDER，使浏览器数据保持隔离。",
            ));
        }
        match env::var("RIVERLAB_6A_TEST_PROFILE") {
            Err(env::VarError::NotPresent) => Ok("default".to_owned()),
            Ok(name)
                if (1..=64).contains(&name.len())
                    && name.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
                    }) =>
            {
                Ok(format!("test-{name}"))
            }
            _ => Err(io::Error::other("无效的桌面测试配置标识。")),
        }
    }

    struct AcceptanceState(Option<Arc<Acceptance>>);

    pub(crate) fn trusted_service_window(window: &WebviewWindow) -> Result<(), String> {
        let url = window.url().map_err(|err| err.to_string())?;
        let workbench = matches!(url.path(), "/" | "/index.html");
        let isolated_probe = url.path() == "/tests/desktop-6a/index.html"
            && window.state::<AcceptanceState>().0.is_some();
        if window.label() == "main"
            && url.origin().ascii_serialization() == "https://tauri.localhost"
            && (workbench || isolated_probe)
        {
            Ok(())
        } else {
            Err("仅允许内置工作台或隔离验收窗口访问本地服务。".into())
        }
    }

    #[tauri::command]
    async fn local_service_health(window: WebviewWindow) -> Result<Health, String> {
        trusted_service_window(&window)?;
        tauri::async_runtime::spawn_blocking(move || window.state::<LocalService>().health())
            .await
            .map_err(|err| err.to_string())?
    }

    #[tauri::command]
    async fn local_service_integrity(window: WebviewWindow) -> Result<&'static str, String> {
        trusted_service_window(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            window
                .state::<LocalService>()
                .with_repository(|repo| repo.integrity_check())
                .map(|_| "ok")
                .map_err(|err| err.to_string())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    #[tauri::command]
    async fn local_service_backup(window: WebviewWindow) -> Result<std::path::PathBuf, String> {
        trusted_service_window(&window)?;
        tauri::async_runtime::spawn_blocking(move || window.state::<LocalService>().backup())
            .await
            .map_err(|err| err.to_string())?
    }

    #[tauri::command]
    async fn save_report_download(
        window: WebviewWindow,
        state: State<'_, AcceptanceState>,
        request: Request<'_>,
    ) -> Result<super::download::SavedReport, String> {
        let url = window.url().map_err(|error| error.to_string())?;
        if window.label() != "main"
            || url.origin().ascii_serialization() != "https://tauri.localhost"
            || url.path() != "/tests/desktop-6a/index.html"
        {
            return Err("下载合成报告仅允许来自内置技术验证页。".into());
        }
        let InvokeBody::Raw(bytes) = request.body() else {
            return Err("下载报告缺少二进制内容。".into());
        };
        let expected = request
            .headers()
            .get("x-report-sha256")
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or("报告缺少有效的 SHA-256。")?
            .to_owned();
        let directory = match &state.0 {
            Some(session) => session.directory.clone(),
            None => window
                .path()
                .download_dir()
                .map_err(|err| format!("无法获取系统下载目录：{err}"))?,
        };
        let bytes = bytes.clone();
        tauri::async_runtime::spawn_blocking(move || {
            super::download::save_report(&directory, &bytes, &expected)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    #[tauri::command]
    async fn qa_record(
        window: WebviewWindow,
        state: State<'_, AcceptanceState>,
        name: String,
        json: String,
    ) -> Result<(), String> {
        let acceptance = state.0.clone().ok_or("当前窗口未运行原生验收。")?;
        let url = window.url().map_err(|error| error.to_string())?;
        if window.label() != "main"
            || url.origin().ascii_serialization() != "https://tauri.localhost"
            || !matches!(
                url.path(),
                "/" | "/index.html" | "/tests/desktop-6a/index.html"
            )
        {
            return Err("验收回执仅允许来自内置工作台和固定验证页。".into());
        }
        tauri::async_runtime::spawn_blocking(move || acceptance.record(&name, &json))
            .await
            .map_err(|err| err.to_string())?
    }

    fn startup_error(message: &str) -> ! {
        let message: Vec<u16> = message.encode_utf16().chain([0]).collect();
        let title: Vec<u16> = "RiverLab Crypto Lab".encode_utf16().chain([0]).collect();
        // Both UTF-16 strings are NUL-terminated and live until the modal dialog closes.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            )
        };
        std::process::exit(1);
    }

    fn create_window(
        app: &tauri::App,
        profile_name: &str,
        runtime: &str,
    ) -> Result<(), Box<dyn Error>> {
        let acceptance_mode =
            env::var_os("RIVERLAB_6A_NATIVE_VERIFY").as_deref() == Some(OsStr::new("1"));
        if acceptance_mode && !profile_name.starts_with("test-ci-") {
            return Err("原生验收需要独立的 ci-<UUID> 配置。".into());
        }
        let application = app.path().app_local_data_dir()?;
        private_directory(&application)?;
        let root = if profile_name == "default" {
            application.join("Research")
        } else {
            let tests = application.join("TestServices");
            private_directory(&tests)?;
            tests.join(profile_name)
        };
        app.manage(LocalService::start(&root)?);
        app.manage(Protocol::new());
        let profiles = application.join("Profiles");
        private_directory(&profiles)?;
        let profile = profiles.join(profile_name);
        let mut builder = WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
            .data_directory(profile.clone())
            .on_navigation(|url| url.origin().ascii_serialization() == "https://tauri.localhost")
            .on_new_window(|_, _| NewWindowResponse::Deny);
        let acceptance = if acceptance_mode {
            let session = Arc::new(Acceptance::create(&profile, runtime)?);
            let host_evidence = Arc::clone(&session);
            if env::var_os("RIVERLAB_6B_CAPACITY_VERIFY").as_deref() == Some(OsStr::new("1")) {
                builder = builder.initialization_script(
                    "Object.defineProperty(window,'__RIVERLAB_6B_CAPACITY_VERIFY__',{value:true});",
                );
            }
            builder = builder
                .initialization_script(
                    "Object.defineProperty(window,'__RIVERLAB_6A_NATIVE_VERIFY__',{value:true});",
                )
                .on_page_load(move |_, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        let url = payload.url();
                        host_evidence.record_page_load(
                            url.origin().ascii_serialization() == "https://tauri.localhost",
                            url.path(),
                        );
                    }
                });
            Some(session)
        } else {
            private_directory(&profile)?;
            None
        };
        app.manage(AcceptanceState(acceptance));
        builder.build()?;
        Ok(())
    }

    pub fn run() {
        let runtime = tauri::webview_version().unwrap_or_default();
        let major = runtime
            .split('.')
            .next()
            .and_then(|value| value.parse::<u32>().ok());
        if !matches!(major, Some(120..)) {
            startup_error("此应用需要 Microsoft Edge WebView2 Runtime 120 或更高版本。请从微软官方网页下载 Evergreen Standalone Installer，安装后重新启动。\nhttps://developer.microsoft.com/microsoft-edge/webview2/");
        }
        let profile = profile_name().unwrap_or_else(|error| startup_error(&error.to_string()));
        tauri::Builder::default()
            .invoke_handler(tauri::generate_handler![
                verify_sqlite,
                qa_record,
                save_report_download,
                local_service_health,
                local_service_integrity,
                local_service_backup,
                crate::protocol::commands::repository_handshake,
                crate::protocol::commands::repository_command,
                crate::protocol::commands::repository_upload_chunk,
                crate::protocol::commands::repository_read_chunk
            ])
            .setup(move |app| {
                if let Err(error) = create_window(app, &profile, &runtime) {
                    if let Some(service) = app.try_state::<LocalService>() {
                        let _ = service.stop();
                    }
                    startup_error(&format!(
                        "无法打开桌面工作台。请检查应用专用目录的写入权限及磁盘空间。\n{error}"
                    ));
                }
                Ok(())
            })
            .build(tauri::generate_context!())
            .unwrap_or_else(|error| startup_error(&format!("无法启动 Windows 桌面应用。\n{error}")))
            .run(|app, event| {
                if matches!(event, RunEvent::Exit) {
                    if let Some(service) = app.try_state::<LocalService>() {
                        if let Err(error) = service.stop() {
                            eprintln!("无法完成关闭检查点：{error}");
                        }
                    }
                }
            });
    }
}

#[cfg(windows)]
fn main() {
    desktop::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("RiverLab Desktop requires Windows and the Microsoft WebView2 Runtime.");
    std::process::exit(1);
}
