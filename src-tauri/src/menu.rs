use tauri::AppHandle;

pub fn build_app_menu(app: &AppHandle) -> Result<(), String> {
    // No app menu — DevTools is accessible from the settings panel
    let _ = app;
    Ok(())
}
