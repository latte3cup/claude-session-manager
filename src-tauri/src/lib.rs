mod backend_manager;
mod commands;
mod menu;
mod state_manager;
mod tray;
mod window_manager;

use backend_manager::{BackendManager, BackendManagerHandle};
use state_manager::{StateManager, StateManagerHandle};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use window_manager::{WindowEntry, WindowManager, WindowManagerHandle, WindowRole};

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Focus existing main window
            if let Some(w) = app.get_webview_window("main").or_else(|| {
                app.webview_windows().into_values().next()
            }) {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::runtime::get_runtime_info,
            commands::window::get_launch_context,
            commands::window::open_project_window,
            commands::window::open_session_window,
            commands::window::list_open_windows,
            commands::window::focus_window,
            commands::window::sync_presence,
            commands::window::set_focus_context,
            commands::window::get_window_state,
            commands::window::save_window_state,
            commands::app::open_folder_dialog,
            commands::app::open_external,
            commands::app::show_notification,
            commands::app::get_desktop_preferences,
            commands::app::update_desktop_preferences,
            commands::app::get_recent_projects,
            commands::app::record_recent_project,
            commands::app::remove_recent_project,
            commands::app::reveal_in_file_explorer,
            commands::app::set_badge_count,
            commands::app::toggle_devtools,
            commands::updater::get_current_version,
            commands::updater::get_latest_manifest,
        ])
        .setup(|app| {
            // 1. Determine paths
            let state_dir = dirs::config_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Remote Code");
            let state_path = state_dir.join("desktop-state.json");

            // 2. Initialize state manager
            let state_manager: StateManagerHandle =
                Arc::new(Mutex::new(StateManager::load(state_path)));
            app.manage(state_manager.clone());

            // 3. Initialize window manager
            let window_manager: WindowManagerHandle =
                Arc::new(Mutex::new(WindowManager::new()));
            app.manage(window_manager.clone());

            // 4. Initialize backend manager
            // In dev mode, cargo tauri dev runs from src-tauri/, so go up one level
            let project_root = {
                let cwd = std::env::current_dir().unwrap_or_default();
                if cfg!(debug_assertions) && cwd.join("..").join("remote_code_server.py").exists() {
                    cwd.join("..").canonicalize().unwrap_or(cwd)
                } else if cwd.join("remote_code_server.py").exists() {
                    cwd
                } else {
                    cwd.join("..").canonicalize().unwrap_or(cwd)
                }
            };
            let is_packaged = !cfg!(debug_assertions);
            let resource_dir = app.path().resource_dir().ok();
            eprintln!("[tauri] project_root = {:?}", project_root);
            eprintln!("[tauri] is_packaged = {}", is_packaged);
            let backend_mgr = BackendManager::new(project_root, is_packaged, resource_dir);
            let backend_handle: BackendManagerHandle = Arc::new(Mutex::new(backend_mgr));
            app.manage(backend_handle.clone());

            // 5. Register main window in window manager
            // The default window from tauri.conf.json has label "main"
            if app.get_webview_window("main").is_some() {
                let entry = WindowEntry {
                    numeric_id: 0,
                    label: "main".to_string(),
                    role: WindowRole::Main,
                    project_id: None,
                    project_name: None,
                    session_id: None,
                    session_name: None,
                    work_path: None,
                    badge_count: 0,
                    owned_session_ids: Vec::new(),
                    focus_context: window_manager::FocusContext::default(),
                    title: "Remote Code".to_string(),
                };
                let mut wm = window_manager.lock().unwrap();
                wm.register(entry);
            }

            // 6. Create tray + menu
            let app_handle = app.handle().clone();
            let _ = tray::create_tray(&app_handle);
            let _ = menu::build_app_menu(&app_handle);

            // 7. Start backend and navigate main window
            let app_handle = app.handle().clone();
            let bm = backend_handle.clone();
            let sm = state_manager.clone();
            let wm = window_manager.clone();

            tauri::async_runtime::spawn(async move {
                // Start Python backend
                let (port, app_url, shutdown) = {
                    let mut mgr = bm.lock().unwrap();
                    eprintln!("[tauri] Starting backend at port {}...", mgr.port());
                    eprintln!("[tauri] app_url = {}", mgr.get_app_url());
                    match mgr.start() {
                        Ok(_) => eprintln!("[tauri] Backend process spawned successfully"),
                        Err(e) => {
                            eprintln!("[tauri] ERROR: Failed to start backend: {}", e);
                            return;
                        }
                    }
                    (mgr.port(), mgr.get_app_url(), mgr.shutdown_notify())
                };

                // Wait for health
                eprintln!("[tauri] Waiting for backend health at port {}...", port);
                if let Err(e) = backend_manager::wait_for_health(port).await {
                    eprintln!("[tauri] ERROR: Backend health check failed: {}", e);
                    return;
                }

                // Start ping loop
                backend_manager::start_ping_loop(port, shutdown);

                // Navigate main window to backend URL
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    if let Ok(url) = app_url.parse() {
                        let _ = main_window.navigate(url);
                        // Show window after navigation
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        let _ = main_window.show();
                    }
                }

                log::info!("Backend ready at {}", app_url);
            });

            // 8. Setup close-to-tray for main window
            let sm_close = state_manager.clone();
            let wm_close = window_manager.clone();
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let prefs = sm_close.lock().unwrap().get_preferences();
                        if prefs.close_behavior == "tray" {
                            api.prevent_close();
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        } else {
                            let mut wm = wm_close.lock().unwrap();
                            wm.unregister("main");
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Stop backend on exit
                let bm: tauri::State<'_, BackendManagerHandle> = app.state();
                bm.lock().unwrap().stop();
            }
        });
}
