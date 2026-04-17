use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    title TEXT NOT NULL DEFAULT '',
    working_dir TEXT,
    cli_type TEXT NOT NULL DEFAULT 'terminal',
    auto_command TEXT NOT NULL DEFAULT '',
    font_size INTEGER NOT NULL DEFAULT 12,
    post_macro TEXT NOT NULL DEFAULT '[]',
    post_macro_enabled INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    name TEXT NOT NULL,
    split_tree_json TEXT NOT NULL,
    session_mapping TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub struct Database {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: Option<i64>,
    pub project_id: Option<i64>,
    pub title: String,
    pub working_dir: Option<String>,
    pub cli_type: String,
    pub auto_command: String,
    pub font_size: i32,
    pub post_macro: String,
    pub post_macro_enabled: bool,
    pub position: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: Option<i64>,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutRow {
    pub id: Option<i64>,
    pub project_id: Option<i64>,
    pub name: String,
    pub split_tree_json: String,
    pub session_mapping: String,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // --- Settings ---

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    // --- Sessions ---

    pub fn save_session(&self, session: &SessionRow) -> Result<i64> {
        if let Some(id) = session.id {
            self.conn.execute(
                "UPDATE sessions SET title=?1, working_dir=?2, cli_type=?3, auto_command=?4, font_size=?5, post_macro=?6, post_macro_enabled=?7, position=?8, updated_at=datetime('now') WHERE id=?9",
                params![
                    session.title,
                    session.working_dir,
                    session.cli_type,
                    session.auto_command,
                    session.font_size,
                    session.post_macro,
                    session.post_macro_enabled as i32,
                    session.position,
                    id,
                ],
            )?;
            Ok(id)
        } else {
            self.conn.execute(
                "INSERT INTO sessions (project_id, title, working_dir, cli_type, auto_command, font_size, post_macro, post_macro_enabled, position) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    session.project_id,
                    session.title,
                    session.working_dir,
                    session.cli_type,
                    session.auto_command,
                    session.font_size,
                    session.post_macro,
                    session.post_macro_enabled as i32,
                    session.position,
                ],
            )?;
            Ok(self.conn.last_insert_rowid())
        }
    }

    pub fn get_session(&self, position: i32) -> Result<Option<SessionRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, title, working_dir, cli_type, auto_command, font_size, post_macro, post_macro_enabled, position FROM sessions WHERE position = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query(params![position])?;
        if let Some(row) = rows.next()? {
            Ok(Some(SessionRow {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                title: row.get(2)?,
                working_dir: row.get(3)?,
                cli_type: row.get(4)?,
                auto_command: row.get(5)?,
                font_size: row.get(6)?,
                post_macro: row.get(7)?,
                post_macro_enabled: row.get::<_, i32>(8)? != 0,
                position: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_sessions(&self) -> Result<Vec<SessionRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, title, working_dir, cli_type, auto_command, font_size, post_macro, post_macro_enabled, position FROM sessions ORDER BY position",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SessionRow {
                id: Some(row.get(0)?),
                project_id: row.get(1)?,
                title: row.get(2)?,
                working_dir: row.get(3)?,
                cli_type: row.get(4)?,
                auto_command: row.get(5)?,
                font_size: row.get(6)?,
                post_macro: row.get(7)?,
                post_macro_enabled: row.get::<_, i32>(8)? != 0,
                position: row.get(9)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_session(&self, position: i32) -> Result<()> {
        self.conn.execute(
            "DELETE FROM sessions WHERE position = ?1",
            params![position],
        )?;
        Ok(())
    }

    // --- Migration ---

    pub fn needs_migration(&self) -> bool {
        self.get_setting("migrated_from_json")
            .ok()
            .flatten()
            .is_none()
    }

    pub fn migrate_from_json(&self, workspace_root: &str) -> Result<()> {
        // Migrate app-settings.json
        let settings_path = format!("{}\\app-settings.json", workspace_root);
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(obj) = json.as_object() {
                    for (k, v) in obj {
                        let val = match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        let _ = self.set_setting(k, &val);
                    }
                }
            }
        }

        // Migrate session*.meta.json
        for i in 0..4 {
            let folder = format!("session{}", i + 1);
            let meta_path = format!("{}\\{}\\session.meta.json", workspace_root, folder);
            if let Ok(content) = std::fs::read_to_string(&meta_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    let session = SessionRow {
                        id: None,
                        project_id: None,
                        title: json
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&folder)
                            .to_string(),
                        working_dir: json
                            .get("folderPath")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        cli_type: "terminal".to_string(),
                        auto_command: json
                            .get("autoCommand")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        font_size: json.get("fontSize").and_then(|v| v.as_i64()).unwrap_or(12)
                            as i32,
                        post_macro: json
                            .get("postMacro")
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "[]".to_string()),
                        post_macro_enabled: json
                            .get("postMacroEnabled")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true),
                        position: i,
                    };
                    let _ = self.save_session(&session);
                }
            }
        }

        self.set_setting("migrated_from_json", "1")?;
        eprintln!("[db] migration from JSON completed");
        Ok(())
    }

    // --- Projects ---

    pub fn upsert_project(&self, name: &str, path: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO projects (name, path) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET name = ?1",
            params![name, path],
        )?;
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM projects WHERE path = ?1")?;
        let id: i64 = stmt.query_row(params![path], |row| row.get(0))?;
        Ok(id)
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, path FROM projects ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectRow {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                path: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_project(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM layouts WHERE project_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM sessions WHERE project_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    // --- Layouts ---

    pub fn save_layout(&self, layout: &LayoutRow) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO layouts (project_id, name, split_tree_json, session_mapping) VALUES (?1, ?2, ?3, ?4)",
            params![layout.project_id, layout.name, layout.split_tree_json, layout.session_mapping],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_layouts(&self, project_id: Option<i64>) -> Result<Vec<LayoutRow>> {
        let mut stmt = if project_id.is_some() {
            self.conn.prepare(
                "SELECT id, project_id, name, split_tree_json, session_mapping FROM layouts WHERE project_id = ?1 ORDER BY name",
            )?
        } else {
            self.conn.prepare(
                "SELECT id, project_id, name, split_tree_json, session_mapping FROM layouts ORDER BY name",
            )?
        };
        let rows = if let Some(pid) = project_id {
            stmt.query_map(params![pid], |row| {
                Ok(LayoutRow {
                    id: Some(row.get(0)?),
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    split_tree_json: row.get(3)?,
                    session_mapping: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?
        } else {
            stmt.query_map([], |row| {
                Ok(LayoutRow {
                    id: Some(row.get(0)?),
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    split_tree_json: row.get(3)?,
                    session_mapping: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?
        };
        Ok(rows)
    }

    pub fn delete_layout(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM layouts WHERE id = ?1", params![id])?;
        Ok(())
    }
}
