use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::backend_manager::BackendManagerHandle;
use crate::state_manager::{StateManagerHandle, WindowBounds};
use crate::window_manager::{
    self, FocusContext, LaunchContext, WindowManagerHandle, WindowRole, WindowSummary,
};

#[tauri::command]
pub fn get_launch_context(
    window: WebviewWindow,
    wm: tauri::State<'_, WindowManagerHandle>,
) -> Option<LaunchContext> {
    let wm = wm.lock().unwrap();
    wm.get_launch_context(window.label())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectArgs {
    pub project_id: String,
    pub project_name: Option<String>,
    pub work_path: Option<String>,
}

#[tauri::command]
pub fn open_project_window(
    app: AppHandle,
    args: OpenProjectArgs,
    wm: tauri::State<'_, WindowManagerHandle>,
    sm: tauri::State<'_, StateManagerHandle>,
    bm: tauri::State<'_, BackendManagerHandle>,
) -> Result<Option<WindowSummary>, String> {
    // Check if project window already exists
    {
        let wm_guard = wm.lock().unwrap();
        for entry in wm_guard.registry.values() {
            if entry.role == WindowRole::Project
                && entry.project_id.as_deref() == Some(&args.project_id)
            {
                // Focus existing window
                if let Some(w) = app.get_webview_window(&entry.label) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                return Ok(Some(
                    wm_guard
                        .build_summaries(&app)
                        .into_iter()
                        .find(|s| s.project_id.as_deref() == Some(&args.project_id))
                        .unwrap(),
                ));
            }
        }
    }

    let backend_url = bm.lock().unwrap().get_app_url();
    let summary = window_manager::create_window(
        &app,
        &wm.inner().clone(),
        &sm.inner().clone(),
        WindowRole::Project,
        &backend_url,
        Some(args.project_id),
        args.project_name,
        None,
        None,
        args.work_path,
    )?;
    Ok(Some(summary))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionArgs {
    pub session_id: String,
    pub session_name: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub work_path: Option<String>,
}

#[tauri::command]
pub fn open_session_window(
    app: AppHandle,
    args: OpenSessionArgs,
    wm: tauri::State<'_, WindowManagerHandle>,
    sm: tauri::State<'_, StateManagerHandle>,
    bm: tauri::State<'_, BackendManagerHandle>,
) -> Result<Option<WindowSummary>, String> {
    // Check if session window already exists
    {
        let wm_guard = wm.lock().unwrap();
        for entry in wm_guard.registry.values() {
            if entry.role == WindowRole::Session
                && entry.session_id.as_deref() == Some(&args.session_id)
            {
                if let Some(w) = app.get_webview_window(&entry.label) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                return Ok(Some(
                    wm_guard
                        .build_summaries(&app)
                        .into_iter()
                        .find(|s| s.session_id.as_deref() == Some(&args.session_id))
                        .unwrap(),
                ));
            }
        }
    }

    let backend_url = bm.lock().unwrap().get_app_url();
    let summary = window_manager::create_window(
        &app,
        &wm.inner().clone(),
        &sm.inner().clone(),
        WindowRole::Session,
        &backend_url,
        args.project_id,
        args.project_name,
        Some(args.session_id),
        args.session_name,
        args.work_path,
    )?;
    Ok(Some(summary))
}

#[tauri::command]
pub fn list_open_windows(
    app: AppHandle,
    wm: tauri::State<'_, WindowManagerHandle>,
) -> Vec<WindowSummary> {
    let wm = wm.lock().unwrap();
    wm.build_summaries(&app)
}

#[tauri::command]
pub fn focus_window(
    app: AppHandle,
    window_id: u32,
    wm: tauri::State<'_, WindowManagerHandle>,
) -> bool {
    let wm = wm.lock().unwrap();
    if let Some(label) = wm.get_label_by_id(window_id) {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            return true;
        }
    }
    false
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub work_path: Option<String>,
    pub owned_session_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn sync_presence(
    window: WebviewWindow,
    payload: PresencePayload,
    app: AppHandle,
    wm: tauri::State<'_, WindowManagerHandle>,
) {
    let mut wm = wm.lock().unwrap();
    if let Some(entry) = wm.get_by_label_mut(window.label()) {
        if let Some(pid) = payload.project_id {
            entry.project_id = Some(pid);
        }
        if let Some(pn) = payload.project_name {
            entry.project_name = Some(pn);
        }
        if let Some(sid) = payload.session_id {
            entry.session_id = Some(sid);
        }
        if let Some(sn) = payload.session_name {
            entry.session_name = Some(sn);
        }
        if let Some(wp) = payload.work_path {
            entry.work_path = Some(wp);
        }
        if let Some(ids) = payload.owned_session_ids {
            entry.owned_session_ids = ids;
        }
    }
    wm.broadcast_registry(&app);
}

#[tauri::command]
pub fn set_focus_context(
    window: WebviewWindow,
    context: FocusContext,
    wm: tauri::State<'_, WindowManagerHandle>,
) {
    let mut wm = wm.lock().unwrap();
    if let Some(entry) = wm.get_by_label_mut(window.label()) {
        entry.focus_context = context;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateContext {
    pub role: Option<String>,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
}

#[tauri::command]
pub fn get_window_state(
    window: WebviewWindow,
    wm: tauri::State<'_, WindowManagerHandle>,
    sm: tauri::State<'_, StateManagerHandle>,
) -> WindowBounds {
    let wm = wm.lock().unwrap();
    let entry = wm.get_by_label(window.label());
    let sm = sm.lock().unwrap();

    if let Some(entry) = entry {
        let role_str = match entry.role {
            WindowRole::Main => "main",
            WindowRole::Project => "project",
            WindowRole::Session => "session",
        };
        let id_ref = entry.project_id.as_deref().or(entry.session_id.as_deref());
        sm.get_window_state(role_str, id_ref)
    } else {
        WindowBounds::default()
    }
}

#[tauri::command]
pub fn save_window_state(
    window: WebviewWindow,
    state: WindowBounds,
    wm: tauri::State<'_, WindowManagerHandle>,
    sm: tauri::State<'_, StateManagerHandle>,
) -> WindowBounds {
    let wm_guard = wm.lock().unwrap();
    let entry = wm_guard.get_by_label(window.label());
    let mut sm = sm.lock().unwrap();

    if let Some(entry) = entry {
        let role_str = match entry.role {
            WindowRole::Main => "main",
            WindowRole::Project => "project",
            WindowRole::Session => "session",
        };
        let id_ref = entry.project_id.as_deref().or(entry.session_id.as_deref());
        sm.save_window_state(role_str, id_ref, state)
    } else {
        sm.save_window_state("main", None, state)
    }
}
