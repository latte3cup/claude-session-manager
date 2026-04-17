#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::{broadcast, mpsc, Mutex};
use uuid::Uuid;
use wmux_core::terminal::shell::detect_shell;
use wmux_core::WmuxCore;

mod remote;

/// Shared application state accessible from Tauri commands
///
/// `pty_tx` and `exit_tx` are held here to keep the channel senders alive;
/// dropping them would close the channels and terminate the PTY reader loops.
#[allow(dead_code)]
pub struct AppState {
    pub core: Mutex<WmuxCore>,
    pub pty_tx: mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    pub exit_tx: mpsc::UnboundedSender<Uuid>,
    pub pty_broadcast: broadcast::Sender<(Uuid, Vec<u8>)>,
    pub exit_broadcast: broadcast::Sender<Uuid>,
    pub auth_token: String,
}

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    surface_id: String,
    data: String, // base64-encoded
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    surface_id: String,
}

#[derive(Clone, Serialize)]
struct PaneInfo {
    surface_id: String,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    is_focused: bool,
}

#[derive(Clone, Serialize)]
struct LayoutResult {
    panes: Vec<PaneInfo>,
    surface_ids: Vec<String>,
    is_zoomed: bool,
    shell: String,
}

#[derive(Clone, Serialize)]
struct SplitResult {
    surface_id: String,
}

#[derive(Clone, Serialize)]
struct CloseResult {
    should_quit: bool,
}

#[derive(Clone, Serialize)]
struct FocusChangedPayload {
    surface_id: String,
}

// ── Tauri Commands ──

#[tauri::command]
async fn get_surface_id(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    let core = state.core.lock().await;
    core.focused_surface
        .map(|id| id.to_string())
        .ok_or_else(|| "No focused surface".to_string())
}

#[tauri::command]
async fn send_input(
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
    data: String,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    if let Some(surface) = core.surfaces.get_mut(&id) {
        surface
            .send_bytes(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    if let Some(surface) = core.surfaces.get_mut(&id) {
        if cols >= 2 && rows >= 2 {
            surface.resize(cols, rows);
        }
    }
    Ok(())
}

#[tauri::command]
async fn split_pane(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    direction: String,
) -> Result<SplitResult, String> {
    let mut core = state.core.lock().await;
    let dir = match direction.as_str() {
        "horizontal" => wmux_core::model::split_tree::Direction::Horizontal,
        _ => wmux_core::model::split_tree::Direction::Vertical,
    };
    let (cols, rows) = core.terminal_size;
    let result = core
        .split_surface(dir, &state.pty_tx, &state.exit_tx, cols / 2, rows / 2)
        .map_err(|e| e.to_string())?;
    match result {
        Some(id) => {
            let _ = app_handle.emit("layout-changed", ());
            let _ = app_handle.emit(
                "focus-changed",
                FocusChangedPayload {
                    surface_id: id.to_string(),
                },
            );
            Ok(SplitResult {
                surface_id: id.to_string(),
            })
        }
        None => Err("No focused surface to split".to_string()),
    }
}

#[tauri::command]
async fn set_split_ratio(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    path: Vec<bool>,
    ratio: f64,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.set_ratio_at(&path, ratio);
    let _ = app_handle.emit("layout-changed", ());
    Ok(())
}

#[tauri::command]
async fn close_pane(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
) -> Result<CloseResult, String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    let should_quit = core.close_surface(id);
    let _ = app_handle.emit("layout-changed", ());
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit(
            "focus-changed",
            FocusChangedPayload {
                surface_id: focused.to_string(),
            },
        );
    }
    Ok(CloseResult { should_quit })
}

#[tauri::command]
async fn focus_pane(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    core.focus_surface(id);
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit(
            "focus-changed",
            FocusChangedPayload {
                surface_id: focused.to_string(),
            },
        );
    }
    Ok(())
}

#[tauri::command]
async fn focus_direction(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    direction: String,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let dir = match direction.as_str() {
        "up" => wmux_core::FocusDirection::Up,
        "down" => wmux_core::FocusDirection::Down,
        "left" => wmux_core::FocusDirection::Left,
        "right" => wmux_core::FocusDirection::Right,
        _ => return Err(format!("Invalid direction: {}", direction)),
    };
    core.focus_direction(dir);
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit(
            "focus-changed",
            FocusChangedPayload {
                surface_id: focused.to_string(),
            },
        );
    }
    Ok(())
}

#[tauri::command]
async fn get_layout(
    state: tauri::State<'_, Arc<AppState>>,
    width: u16,
    height: u16,
) -> Result<LayoutResult, String> {
    let mut core = state.core.lock().await;

    // Update terminal_size so new splits use correct dimensions
    core.set_terminal_size(width, height);

    let panes = if let Some(zoom_id) = core.zoom_surface {
        // Zoomed: single pane fills entire area
        vec![PaneInfo {
            surface_id: zoom_id.to_string(),
            x: 0,
            y: 0,
            width,
            height,
            is_focused: true,
        }]
    } else if let Some(ws) = core.active_workspace_ref() {
        ws.split_tree
            .layout(0, 0, width, height)
            .iter()
            .map(|l| PaneInfo {
                surface_id: l.surface_id.to_string(),
                x: l.x,
                y: l.y,
                width: l.width,
                height: l.height,
                is_focused: core.focused_surface == Some(l.surface_id),
            })
            .collect()
    } else {
        vec![]
    };

    let shell_name = core
        .shell
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(&core.shell)
        .to_string();
    let surface_ids = core.surfaces.keys().map(|id| id.to_string()).collect();

    Ok(LayoutResult {
        panes,
        surface_ids,
        is_zoomed: core.zoom_surface.is_some(),
        shell: shell_name,
    })
}

// ── PTY Controls ──

#[tauri::command]
async fn kill_pty(
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    core.kill_pty(id);
    Ok(())
}

#[tauri::command]
async fn restart_pty(
    state: tauri::State<'_, Arc<AppState>>,
    surface_id: String,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    core.restart_pty(id, &state.pty_tx, &state.exit_tx)
        .map_err(|e| e.to_string())
}

// ── Clipboard ──

#[tauri::command]
async fn get_clipboard_files() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use clipboard_win::{formats, get_clipboard};
        let result: Result<Vec<String>, _> = get_clipboard(formats::FileList);
        match result {
            Ok(files) if !files.is_empty() => Ok(files),
            _ => Ok(vec![]),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

// ── Window Controls ──

#[tauri::command]
async fn window_start_drag(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    win.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn window_minimize(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    win.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
async fn window_maximize(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    if win.is_maximized().unwrap_or(false) {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn window_fullscreen(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    let is_full = win.is_fullscreen().unwrap_or(false);
    if !is_full {
        // maximize 상태면 먼저 해제해야 fullscreen 크기가 올바르게 적용됨
        if win.is_maximized().unwrap_or(false) {
            win.unmaximize().map_err(|e| e.to_string())?;
        }
    }
    win.set_fullscreen(!is_full).map_err(|e| e.to_string())
}

#[tauri::command]
async fn window_devtools(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    if win.is_devtools_open() {
        win.close_devtools();
    } else {
        win.open_devtools();
    }
    Ok(())
}

#[tauri::command]
async fn window_close(app_handle: tauri::AppHandle) -> Result<(), String> {
    let win = app_handle.get_webview_window("main").ok_or("No window")?;
    win.close().map_err(|e| e.to_string())
}

// ── Remote Info ──

#[derive(Clone, Serialize)]
struct RemoteInfo {
    pin: String,
    port: u16,
    lan_ip: String,
    tailscale_ip: Option<String>,
}

#[tauri::command]
async fn get_remote_info(state: tauri::State<'_, Arc<AppState>>) -> Result<RemoteInfo, String> {
    let mut lan_ip = String::from("127.0.0.1");
    let mut tailscale_ip = None;

    if let Ok(output) = std::process::Command::new("ipconfig").output() {
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IPv4") {
                    if let Some(ip) = line.split(':').next_back().map(|s| s.trim().to_string()) {
                        if ip.starts_with("100.") {
                            tailscale_ip = Some(ip);
                        } else if ip.starts_with("192.168.")
                            || ip.starts_with("10.")
                            || ip.starts_with("172.")
                        {
                            lan_ip = ip;
                        }
                    }
                }
            }
        }
    }

    Ok(RemoteInfo {
        pin: state.auth_token.clone(),
        port: 9784,
        lan_ip,
        tailscale_ip,
    })
}

// ── Config ──

#[tauri::command]
async fn get_workspace_root() -> Result<String, String> {
    // 1. config.json 파일
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    let config_path = format!("{}\\.claude-session-manager\\config.json", home);
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(root) = json.get("workspaceRoot").and_then(|v| v.as_str()) {
                return Ok(root.to_string());
            }
        }
    }
    // 2. 환경변수
    if let Ok(val) = std::env::var("CLAUDE_SESSION_WORKSPACE") {
        return Ok(val);
    }
    // 3. 기본값
    Ok(format!("{}\\Claude Workspace", home))
}

#[tauri::command]
async fn get_config_path() -> Result<String, String> {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    Ok(format!("{}\\.claude-session-manager\\config.json", home))
}

#[tauri::command]
async fn save_config(content: String) -> Result<(), String> {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
    let dir = format!("{}\\.claude-session-manager", home);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = format!("{}\\config.json", dir);
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

// ── File Access ──

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

// ── App Setup ──

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Create PTY channels
            let (pty_tx, mut pty_rx) = mpsc::unbounded_channel::<(Uuid, Vec<u8>)>();
            let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<Uuid>();

            // Detect shell and create core
            let shell = detect_shell(None);
            let mut core = WmuxCore::new(shell, String::new());

            // Create initial workspace with default size (frontend will resize)
            if let Err(e) = core.create_workspace(None, &pty_tx, &exit_tx, 80, 24) {
                eprintln!("Failed to create initial workspace: {}", e);
            }

            // Broadcast channels for remote clients
            let (pty_bcast_tx, _) = broadcast::channel::<(Uuid, Vec<u8>)>(256);
            let (exit_bcast_tx, _) = broadcast::channel::<Uuid>(64);

            // Read PIN from config or generate random
            let auth_token = {
                let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
                let config_path = format!("{}\\.claude-session-manager\\config.json", home);
                std::fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                    .and_then(|j| {
                        j.get("remotePin")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .unwrap_or_else(|| format!("{:06}", rand::random::<u32>() % 1_000_000))
            };
            eprintln!("[remote] PIN: {}", auth_token);

            // Store state
            let state = Arc::new(AppState {
                core: Mutex::new(core),
                pty_tx,
                exit_tx,
                pty_broadcast: pty_bcast_tx,
                exit_broadcast: exit_bcast_tx,
                auth_token,
            });
            app.manage(state.clone());

            // Spawn channel-to-event bridge (fan-out to Tauri + broadcast)
            let bridge_state = state.clone();
            let pty_bcast = state.pty_broadcast.clone();
            let exit_bcast = state.exit_broadcast.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::select! {
                        Some((id, data)) = pty_rx.recv() => {
                            // Feed into vt100 parser + output_history
                            {
                                let mut core = bridge_state.core.lock().await;
                                core.process_pty_output(id, &data);
                            }
                            // Fan-out to broadcast (for WebSocket clients)
                            let _ = pty_bcast.send((id, data.clone()));
                            // Tauri emit (for desktop UI)
                            let payload = PtyOutputPayload {
                                surface_id: id.to_string(),
                                data: BASE64.encode(&data),
                            };
                            let _ = app_handle.emit("pty-output", payload);
                        }
                        Some(id) = exit_rx.recv() => {
                            // Mark surface as exited in core
                            let mut core = bridge_state.core.lock().await;
                            core.handle_pty_exit(id);
                            drop(core);
                            // Fan-out to broadcast
                            let _ = exit_bcast.send(id);
                            // Tauri emit
                            let payload = PtyExitPayload {
                                surface_id: id.to_string(),
                            };
                            let _ = app_handle.emit("pty-exit", payload);
                        }
                        else => break,
                    }
                }
            });

            // Update window title with remote info
            let pin = state.auth_token.clone();
            let title_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait for window to be ready
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                let mut lan_ip = String::from("127.0.0.1");
                if let Ok(output) = std::process::Command::new("ipconfig").output() {
                    {
                        let text = String::from_utf8_lossy(&output.stdout);
                        for line in text.lines() {
                            if line.contains("IPv4") {
                                if let Some(ip) =
                                    line.split(':').next_back().map(|s| s.trim().to_string())
                                {
                                    if ip.starts_with("192.168.")
                                        || ip.starts_with("10.")
                                        || ip.starts_with("172.")
                                    {
                                        lan_ip = ip;
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(win) = title_handle.get_webview_window("main") {
                    let _ = win.set_title(&format!(
                        "Claude Session Manager — {}:9784 PIN:{}",
                        lan_ip, pin
                    ));
                }
            });

            // Start remote WebSocket/HTTP server
            let remote_state = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = remote::start_remote_server(remote_state, 9784).await {
                    eprintln!("[remote] server error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_surface_id,
            get_clipboard_files,
            send_input,
            resize_terminal,
            kill_pty,
            restart_pty,
            split_pane,
            set_split_ratio,
            close_pane,
            focus_pane,
            focus_direction,
            get_layout,
            get_workspace_root,
            get_config_path,
            save_config,
            read_file,
            write_file,
            window_start_drag,
            window_minimize,
            window_maximize,
            window_fullscreen,
            window_devtools,
            window_close,
            get_remote_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
