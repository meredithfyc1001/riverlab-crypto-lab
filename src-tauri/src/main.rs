//! Windows-only feasibility shell. The research application is embedded at build time.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(any(windows, test))]
mod storage;

#[cfg(windows)]
mod desktop {
    use std::{env, error::Error, fs, io};
    use tauri::{webview::NewWindowResponse, Manager, WebviewWindowBuilder};
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    #[tauri::command]
    async fn verify_sqlite(
        app: tauri::AppHandle,
    ) -> Result<super::storage::StorageEvidence, String> {
        let parent = app
            .path()
            .app_local_data_dir()
            .map_err(|err| err.to_string())?
            .join("SQLite 验证");
        tauri::async_runtime::spawn_blocking(move || {
            fs::create_dir_all(&parent).map_err(|err| err.to_string())?;
            super::storage::verify_sqlite(&parent)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    fn profile_name() -> io::Result<String> {
        if env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
            return Err(io::Error::other(
                "启动原型前请取消 WEBVIEW2_USER_DATA_FOLDER，使浏览器数据保持隔离。",
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
            _ => Err(io::Error::other("无效的 6A 测试配置标识。")),
        }
    }

    fn startup_error(message: &str) -> ! {
        let message: Vec<u16> = message.encode_utf16().chain([0]).collect();
        let title: Vec<u16> = "RiverLab Crypto Lab · 6A"
            .encode_utf16()
            .chain([0])
            .collect();
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

    fn create_window(app: &tauri::App, profile_name: &str) -> Result<(), Box<dyn Error>> {
        let profile = app
            .path()
            .app_local_data_dir()?
            .join("Profiles")
            .join(profile_name);
        fs::create_dir_all(&profile)?;
        WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
            .data_directory(profile)
            .on_navigation(|url| url.origin().ascii_serialization() == "https://tauri.localhost")
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .build()?;
        Ok(())
    }

    pub fn run() {
        let runtime = tauri::webview_version().unwrap_or_default();
        let major = runtime
            .split('.')
            .next()
            .and_then(|value| value.parse::<u32>().ok());
        if !matches!(major, Some(120..)) {
            startup_error("此原型需要 Microsoft Edge WebView2 Runtime 120 或更高版本。请从微软官方网页下载 Evergreen Standalone Installer，安装后重新启动。\nhttps://developer.microsoft.com/microsoft-edge/webview2/");
        }
        let profile = profile_name().unwrap_or_else(|error| startup_error(&error.to_string()));
        tauri::Builder::default()
            .invoke_handler(tauri::generate_handler![verify_sqlite])
            .setup(move |app| {
                if let Err(error) = create_window(app, &profile) {
                    startup_error(&format!(
                        "无法打开桌面工作台。请检查应用专用目录的写入权限及磁盘空间。\n{error}"
                    ));
                }
                Ok(())
            })
            .run(tauri::generate_context!())
            .unwrap_or_else(|error| {
                startup_error(&format!("无法启动 Windows 桌面原型。\n{error}"))
            });
    }
}

#[cfg(windows)]
fn main() {
    desktop::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("RiverLab Phase 6A requires Windows and the Microsoft WebView2 Runtime.");
    std::process::exit(1);
}
