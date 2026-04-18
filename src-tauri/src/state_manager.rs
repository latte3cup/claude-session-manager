use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX_RECENT_PROJECTS: usize = 10;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    pub preferences: Preferences,
    pub main_window: WindowBounds,
    #[serde(default)]
    pub project_windows: HashMap<String, WindowBounds>,
    #[serde(default)]
    pub session_windows: HashMap<String, WindowBounds>,
    #[serde(default)]
    pub recent_projects: Vec<RecentProject>,
    #[serde(default)]
    pub relaunch_snapshot: Vec<RelaunchEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub close_behavior: String,
    pub launch_at_login: bool,
    #[serde(default)]
    pub tray_hint_shown: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowBounds {
    pub width: i32,
    pub height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub work_path: String,
    pub last_opened_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelaunchEntry {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_path: Option<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_behavior: "tray".to_string(),
            launch_at_login: false,
            tray_hint_shown: false,
        }
    }
}

impl Default for WindowBounds {
    fn default() -> Self {
        Self {
            width: 1440,
            height: 960,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            preferences: Preferences::default(),
            main_window: WindowBounds::default(),
            project_windows: HashMap::new(),
            session_windows: HashMap::new(),
            recent_projects: Vec::new(),
            relaunch_snapshot: Vec::new(),
        }
    }
}

pub struct StateManager {
    state: DesktopState,
    file_path: PathBuf,
}

pub type StateManagerHandle = Arc<Mutex<StateManager>>;

impl StateManager {
    pub fn load(file_path: PathBuf) -> Self {
        let state = if file_path.exists() {
            match fs::read_to_string(&file_path) {
                Ok(content) => {
                    serde_json::from_str::<DesktopState>(&content).unwrap_or_default()
                }
                Err(_) => DesktopState::default(),
            }
        } else {
            // Try legacy window-state.json
            let legacy_path = file_path
                .parent()
                .unwrap_or(Path::new("."))
                .join("window-state.json");
            if legacy_path.exists() {
                if let Ok(content) = fs::read_to_string(&legacy_path) {
                    if let Ok(bounds) = serde_json::from_str::<WindowBounds>(&content) {
                        let mut state = DesktopState::default();
                        state.main_window = bounds;
                        state
                    } else {
                        DesktopState::default()
                    }
                } else {
                    DesktopState::default()
                }
            } else {
                DesktopState::default()
            }
        };

        Self { state, file_path }
    }

    fn save(&self) {
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.state) {
            let _ = fs::write(&self.file_path, json);
        }
    }

    pub fn get_preferences(&self) -> Preferences {
        self.state.preferences.clone()
    }

    pub fn set_preferences(&mut self, partial: Preferences) -> Preferences {
        self.state.preferences = partial;
        self.save();
        self.state.preferences.clone()
    }

    pub fn get_window_state(&self, role: &str, id: Option<&str>) -> WindowBounds {
        match role {
            "project" => id
                .and_then(|id| self.state.project_windows.get(id))
                .cloned()
                .unwrap_or_default(),
            "session" => id
                .and_then(|id| self.state.session_windows.get(id))
                .cloned()
                .unwrap_or_default(),
            _ => self.state.main_window.clone(),
        }
    }

    pub fn save_window_state(
        &mut self,
        role: &str,
        id: Option<&str>,
        bounds: WindowBounds,
    ) -> WindowBounds {
        match role {
            "project" => {
                if let Some(id) = id {
                    self.state
                        .project_windows
                        .insert(id.to_string(), bounds.clone());
                }
            }
            "session" => {
                if let Some(id) = id {
                    self.state
                        .session_windows
                        .insert(id.to_string(), bounds.clone());
                }
            }
            _ => {
                self.state.main_window = bounds.clone();
            }
        }
        self.save();
        bounds
    }

    pub fn get_recent_projects(&self) -> Vec<RecentProject> {
        self.state.recent_projects.clone()
    }

    pub fn record_recent_project(
        &mut self,
        project_id: String,
        name: String,
        work_path: String,
    ) -> Vec<RecentProject> {
        let now = chrono::Utc::now().to_rfc3339();
        let new_entry = RecentProject {
            project_id: project_id.clone(),
            name,
            work_path,
            last_opened_at: now,
        };

        // Check if top is already the same
        if let Some(top) = self.state.recent_projects.first() {
            if top.project_id == new_entry.project_id
                && top.name == new_entry.name
                && top.work_path == new_entry.work_path
            {
                return self.state.recent_projects.clone();
            }
        }

        self.state
            .recent_projects
            .retain(|p| p.project_id != project_id);
        self.state.recent_projects.insert(0, new_entry);
        self.state.recent_projects.truncate(MAX_RECENT_PROJECTS);
        self.save();
        self.state.recent_projects.clone()
    }

    pub fn remove_recent_project(&mut self, project_id: &str) -> Vec<RecentProject> {
        let before = self.state.recent_projects.len();
        self.state
            .recent_projects
            .retain(|p| p.project_id != project_id);
        if self.state.recent_projects.len() != before {
            self.save();
        }
        self.state.recent_projects.clone()
    }

    pub fn get_relaunch_snapshot(&self) -> Vec<RelaunchEntry> {
        self.state.relaunch_snapshot.clone()
    }

    pub fn set_relaunch_snapshot(&mut self, snapshot: Vec<RelaunchEntry>) {
        self.state.relaunch_snapshot = snapshot;
        self.save();
    }
}
