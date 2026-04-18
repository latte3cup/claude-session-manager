use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub runtime: String,
    pub platform: String,
    pub version: String,
    pub debug_perf: bool,
}

#[tauri::command]
pub fn get_runtime_info(app: AppHandle) -> RuntimeInfo {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };

    RuntimeInfo {
        runtime: "tauri".to_string(),
        platform: platform.to_string(),
        version: app.package_info().version.to_string(),
        debug_perf: cfg!(debug_assertions),
    }
}
