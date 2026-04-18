use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Emitter,
};

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    let show = MenuItemBuilder::new("Show Window")
        .id("tray-show")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::new("Quit")
        .id("tray-quit")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()
        .map_err(|e| e.to_string())?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("Remote Code Desktop")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(w) = app.get_webview_window("main").or_else(|| {
                    app.webview_windows().into_values().next()
                }) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main").or_else(|| {
                    app.webview_windows().into_values().next()
                }) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
