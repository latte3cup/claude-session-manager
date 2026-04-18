use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::state_manager::{Preferences, RecentProject, StateManagerHandle};

#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app.dialog().file().blocking_pick_folder();
    result.map(|p| p.to_string())
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct NotificationArgs {
    pub title: String,
    pub body: String,
}

#[tauri::command]
pub async fn show_notification(
    app: AppHandle,
    args: NotificationArgs,
) -> bool {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&args.title)
        .body(&args.body)
        .show()
        .is_ok()
}

#[tauri::command]
pub fn get_desktop_preferences(sm: tauri::State<'_, StateManagerHandle>) -> Preferences {
    sm.lock().unwrap().get_preferences()
}

#[tauri::command]
pub fn update_desktop_preferences(
    payload: Preferences,
    sm: tauri::State<'_, StateManagerHandle>,
) -> Preferences {
    sm.lock().unwrap().set_preferences(payload)
}

#[tauri::command]
pub fn get_recent_projects(sm: tauri::State<'_, StateManagerHandle>) -> Vec<RecentProject> {
    sm.lock().unwrap().get_recent_projects()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRecentProjectArgs {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub work_path: String,
}

#[tauri::command]
pub fn record_recent_project(
    payload: RecordRecentProjectArgs,
    sm: tauri::State<'_, StateManagerHandle>,
) -> Vec<RecentProject> {
    sm.lock().unwrap().record_recent_project(
        payload.project_id,
        payload.name,
        payload.work_path,
    )
}

#[tauri::command]
pub fn remove_recent_project(
    project_id: String,
    sm: tauri::State<'_, StateManagerHandle>,
) -> Vec<RecentProject> {
    sm.lock().unwrap().remove_recent_project(&project_id)
}

#[tauri::command]
pub async fn reveal_in_file_explorer(file_path: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &file_path])
            .spawn()
            .is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &file_path])
            .spawn()
            .is_ok()
    }
    #[cfg(target_os = "linux")]
    {
        // Try xdg-open on parent directory
        if let Some(parent) = std::path::Path::new(&file_path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .is_ok()
        } else {
            false
        }
    }
}

#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
pub fn set_badge_count(badge_count: u32) -> u32 {
    // Platform-specific badge (macOS dock badge, Windows overlay)
    // Basic implementation — platform-specific enhancements in later phases
    badge_count
}
