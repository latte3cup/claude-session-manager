use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle,
};

pub fn build_app_menu(app: &AppHandle) -> Result<(), String> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::new("New Project Window")
                .id("menu-new-project")
                .accelerator("CmdOrCtrl+N")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .quit()
        .build()
        .map_err(|e| e.to_string())?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
        .map_err(|e| e.to_string())?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::new("Reload")
                .id("menu-reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::new("Toggle DevTools")
                .id("menu-devtools")
                .accelerator("F12")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .build()
        .map_err(|e| e.to_string())?;

    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}
