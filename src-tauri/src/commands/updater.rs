use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub minimum_supported_version: String,
    pub platform: String,
    pub arch: String,
    pub asset_name: String,
    pub download_url: String,
    pub published_at: String,
}

#[tauri::command]
pub fn get_current_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_latest_manifest(app: AppHandle) -> Option<UpdateManifest> {
    // Try to read update-manifest.json from resources
    let resource_dir = app.path().resource_dir().ok()?;
    let manifest_path = resource_dir.join("update-manifest.json");
    let content = std::fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str(&content).ok()
}
