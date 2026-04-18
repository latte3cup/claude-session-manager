use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state_manager::{StateManagerHandle, WindowBounds};

static ID_COUNTER: AtomicU32 = AtomicU32::new(1);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowRole {
    Main,
    Project,
    Session,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusContext {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_type: Option<String>,
}

impl Default for FocusContext {
    fn default() -> Self {
        Self {
            kind: "panel".to_string(),
            session_type: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct WindowEntry {
    pub numeric_id: u32,
    pub label: String,
    pub role: WindowRole,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub work_path: Option<String>,
    pub badge_count: u32,
    pub owned_session_ids: Vec<String>,
    pub focus_context: FocusContext,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSummary {
    pub window_id: u32,
    pub role: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub work_path: Option<String>,
    pub title: String,
    pub hidden: bool,
    pub focused: bool,
    pub badge_count: u32,
    pub owned_session_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchContext {
    pub window_id: u32,
    pub role: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub work_path: Option<String>,
}

pub struct WindowManager {
    pub registry: HashMap<String, WindowEntry>,
    pub id_to_label: HashMap<u32, String>,
}

pub type WindowManagerHandle = Arc<Mutex<WindowManager>>;

impl WindowManager {
    pub fn new() -> Self {
        Self {
            registry: HashMap::new(),
            id_to_label: HashMap::new(),
        }
    }

    pub fn register(&mut self, entry: WindowEntry) {
        self.id_to_label
            .insert(entry.numeric_id, entry.label.clone());
        self.registry.insert(entry.label.clone(), entry);
    }

    pub fn unregister(&mut self, label: &str) {
        if let Some(entry) = self.registry.remove(label) {
            self.id_to_label.remove(&entry.numeric_id);
        }
    }

    pub fn get_by_label(&self, label: &str) -> Option<&WindowEntry> {
        self.registry.get(label)
    }

    pub fn get_by_id(&self, id: u32) -> Option<&WindowEntry> {
        self.id_to_label
            .get(&id)
            .and_then(|label| self.registry.get(label))
    }

    pub fn get_label_by_id(&self, id: u32) -> Option<&String> {
        self.id_to_label.get(&id)
    }

    pub fn get_by_label_mut(&mut self, label: &str) -> Option<&mut WindowEntry> {
        self.registry.get_mut(label)
    }

    pub fn get_main_label(&self) -> Option<&str> {
        self.registry
            .iter()
            .find(|(_, e)| e.role == WindowRole::Main)
            .map(|(label, _)| label.as_str())
    }

    pub fn build_summaries(&self, app: &AppHandle) -> Vec<WindowSummary> {
        let mut summaries: Vec<WindowSummary> = self
            .registry
            .values()
            .map(|entry| {
                let window = app.get_webview_window(&entry.label);
                let hidden = window
                    .as_ref()
                    .map(|w| !w.is_visible().unwrap_or(true))
                    .unwrap_or(true);
                let focused = window
                    .as_ref()
                    .map(|w| w.is_focused().unwrap_or(false))
                    .unwrap_or(false);

                let role_str = match entry.role {
                    WindowRole::Main => "main",
                    WindowRole::Project => "project",
                    WindowRole::Session => "session",
                };

                WindowSummary {
                    window_id: entry.numeric_id,
                    role: role_str.to_string(),
                    project_id: entry.project_id.clone(),
                    project_name: entry.project_name.clone(),
                    session_id: entry.session_id.clone(),
                    session_name: entry.session_name.clone(),
                    work_path: entry.work_path.clone(),
                    title: entry.title.clone(),
                    hidden,
                    focused,
                    badge_count: entry.badge_count,
                    owned_session_ids: entry.owned_session_ids.clone(),
                }
            })
            .collect();

        // Sort: main first, then project, then session
        summaries.sort_by_key(|s| match s.role.as_str() {
            "main" => 0,
            "project" => 1,
            "session" => 2,
            _ => 3,
        });

        summaries
    }

    pub fn broadcast_registry(&self, app: &AppHandle) {
        let summaries = self.build_summaries(app);
        let _ = app.emit("window:registry-updated", &summaries);
    }

    pub fn get_launch_context(&self, label: &str) -> Option<LaunchContext> {
        self.get_by_label(label).map(|entry| LaunchContext {
            window_id: entry.numeric_id,
            role: match entry.role {
                WindowRole::Main => "main".to_string(),
                WindowRole::Project => "project".to_string(),
                WindowRole::Session => "session".to_string(),
            },
            project_id: entry.project_id.clone(),
            project_name: entry.project_name.clone(),
            session_id: entry.session_id.clone(),
            session_name: entry.session_name.clone(),
            work_path: entry.work_path.clone(),
        })
    }
}

pub fn create_window(
    app: &AppHandle,
    wm: &WindowManagerHandle,
    sm: &StateManagerHandle,
    role: WindowRole,
    backend_url: &str,
    project_id: Option<String>,
    project_name: Option<String>,
    session_id: Option<String>,
    session_name: Option<String>,
    work_path: Option<String>,
) -> Result<WindowSummary, String> {
    let numeric_id = ID_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("win-{}", numeric_id);

    let title = compute_title(&role, project_name.as_deref(), session_name.as_deref());

    // Get saved bounds
    let bounds = {
        let sm = sm.lock().unwrap();
        let role_str = match role {
            WindowRole::Main => "main",
            WindowRole::Project => "project",
            WindowRole::Session => "session",
        };
        let id_ref = project_id
            .as_deref()
            .or(session_id.as_deref());
        sm.get_window_state(role_str, id_ref)
    };

    let url = WebviewUrl::External(
        backend_url
            .parse()
            .map_err(|e| format!("Invalid URL: {}", e))?,
    );

    let mut builder = WebviewWindowBuilder::new(app, &label, url)
        .title(&title)
        .inner_size(bounds.width as f64, bounds.height as f64)
        .visible(false);

    if let (Some(x), Some(y)) = (bounds.x, bounds.y) {
        builder = builder.position(x as f64, y as f64);
    }

    let window = builder.build().map_err(|e| format!("Failed to create window: {}", e))?;

    if bounds.maximized {
        let _ = window.maximize();
    }

    let entry = WindowEntry {
        numeric_id,
        label: label.clone(),
        role: role.clone(),
        project_id: project_id.clone(),
        project_name: project_name.clone(),
        session_id: session_id.clone(),
        session_name: session_name.clone(),
        work_path: work_path.clone(),
        badge_count: 0,
        owned_session_ids: Vec::new(),
        focus_context: FocusContext::default(),
        title: title.clone(),
    };

    let summary = {
        let mut wm = wm.lock().unwrap();
        wm.register(entry);
        let summaries = wm.build_summaries(app);
        summaries
            .into_iter()
            .find(|s| s.window_id == numeric_id)
            .unwrap()
    };

    // Setup window event handlers
    let wm_clone = wm.clone();
    let sm_clone = sm.clone();
    let window_clone = window.clone();
    let role_clone = role.clone();
    let pid = project_id.clone();
    let sid = session_id.clone();

    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if role_clone == WindowRole::Main {
                    let prefs = sm_clone.lock().unwrap().get_preferences();
                    if prefs.close_behavior == "tray" {
                        api.prevent_close();
                        let _ = window_clone.hide();
                        return;
                    }
                }
                // Unregister on close
                let app_handle = window_clone.app_handle();
                let mut wm = wm_clone.lock().unwrap();
                wm.unregister(window_clone.label());
                wm.broadcast_registry(app_handle);
            }
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                let role_str = match role_clone {
                    WindowRole::Main => "main",
                    WindowRole::Project => "project",
                    WindowRole::Session => "session",
                };
                if let Ok(size) = window_clone.inner_size() {
                    if let Ok(pos) = window_clone.outer_position() {
                        let bounds = WindowBounds {
                            width: size.width as i32,
                            height: size.height as i32,
                            x: Some(pos.x),
                            y: Some(pos.y),
                            maximized: window_clone.is_maximized().unwrap_or(false),
                        };
                        let id_ref = pid.as_deref().or(sid.as_deref());
                        sm_clone
                            .lock()
                            .unwrap()
                            .save_window_state(role_str, id_ref, bounds);
                    }
                }
            }
            tauri::WindowEvent::Focused(_) => {
                let app_handle = window_clone.app_handle();
                let wm = wm_clone.lock().unwrap();
                wm.broadcast_registry(app_handle);
            }
            _ => {}
        }
    });

    // Show window after a brief delay to let content load
    let window_clone = window.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let _ = window_clone.show();
    });

    // Broadcast updated registry
    {
        let wm = wm.lock().unwrap();
        wm.broadcast_registry(app);
    }

    Ok(summary)
}

fn compute_title(
    role: &WindowRole,
    project_name: Option<&str>,
    session_name: Option<&str>,
) -> String {
    match role {
        WindowRole::Main => "Remote Code".to_string(),
        WindowRole::Project => {
            if let Some(name) = project_name {
                format!("{} - Remote Code", name)
            } else {
                "Project - Remote Code".to_string()
            }
        }
        WindowRole::Session => {
            if let Some(name) = session_name {
                format!("{} - Remote Code", name)
            } else {
                "Session - Remote Code".to_string()
            }
        }
    }
}
