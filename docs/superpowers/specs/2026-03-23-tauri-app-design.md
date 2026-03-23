# wmux Tauri Desktop App — Design Spec

## Overview

Build a Tauri-based desktop terminal emulator for wmux. The app uses the `wmux-core` crate for PTY and state management, with a web frontend powered by xterm.js for terminal rendering. The goal is a minimal, fast, polished desktop product.

This spec covers the full vision. Implementation is broken into 3 sub-projects, each with its own plan:

1. **Tauri scaffold + single terminal** — window with one xterm.js pane connected to PTY
2. **Splits + tabs + sidebar** — full multiplexer UI
3. **Polish** — custom title bar, right-click menu, drag-and-drop tabs, system tray, installer

## Architecture

```
wmux-app.exe (Tauri)
├── Rust backend
│   ├── WmuxCore (from wmux-core crate)
│   ├── Tauri commands (IPC bridge)
│   └── System tray integration
└── Web frontend (HTML/CSS/JS)
    ├── xterm.js (terminal rendering)
    ├── Split pane layout (CSS Grid)
    ├── Tab bar in custom title bar
    ├── Collapsible sidebar (workspaces)
    └── Right-click context menu
```

**Data flow:** Frontend ↔ Backend via Tauri IPC. Backend owns `WmuxCore` and all PTY state. PTY output flows as binary events from backend → frontend → xterm.js. User keystrokes flow from xterm.js → frontend → backend → PTY.

The frontend is stateless — it renders what the backend tells it to. All state lives in `WmuxCore`.

## UI Layout

Custom frameless window with three regions:

```
┌──────────────────────────────────────────────────┐
│ [≡] wmux    [1:code] [2:tests] [+]    [─][□][✕] │  ← Custom title bar with tabs
├────────┬─────────────────────────────────────────┤
│        │                                         │
│  work- │   Terminal panes (xterm.js)              │
│  space │   ┌─────────────┬──────────────┐        │
│  list  │   │             │              │        │
│        │   │   pane 1    │   pane 2     │        │
│  1:cod │   │             │              │        │
│  2:tes │   │             ├──────────────┤        │
│        │   │             │   pane 3     │        │
│  [+]   │   └─────────────┴──────────────┘        │
├────────┴─────────────────────────────────────────┤
│ pwsh │ \\.\pipe\wmux │ 1:code [1/3]              │  ← Status bar
└──────────────────────────────────────────────────┘
```

- **Title bar**: draggable, app icon + name on left, tabs in center (drag to reorder), window controls on right
- **Sidebar**: collapsible (toggle with hamburger icon), shows workspace list, click to switch, [+] to create
- **Terminal area**: CSS Grid layout driven by wmux-core's split tree. Each pane is an xterm.js instance.
- **Status bar**: current shell, pipe path, workspace/pane info

## IPC Bridge

### Frontend → Backend (Tauri commands)

- `create_workspace(name?)` → workspace ID
- `switch_workspace(index)`
- `split_pane(direction)` → surface ID
- `close_pane(surface_id)`
- `focus_pane(surface_id)`
- `send_input(surface_id, data: Vec<u8>)` — keystrokes from xterm.js
- `resize_pane(surface_id, cols, rows)` — when pane dimensions change
- `toggle_zoom()`
- `get_layout()` → pane rects + focused state
- `get_tab_info()` → workspace names + active state
- `reorder_tabs(from_index, to_index)`

### Backend → Frontend (Tauri events)

- `pty-output(surface_id, data: Vec<u8>)` — PTY output bytes, frontend feeds to xterm.js
- `pty-exit(surface_id)` — shell exited
- `layout-changed()` — split tree changed, frontend should re-query layout
- `focus-changed(surface_id)` — active pane changed

## Right-Click Context Menu

On terminal area: Copy, Paste, separator, Split Vertical, Split Horizontal, separator, Close Pane

## System Tray

- Tray icon shows when app is running
- Left-click → restore/focus window
- Right-click menu: "Show wmux", "New Workspace", separator, "Quit"
- Close button (✕) minimizes to tray instead of quitting
- Ctrl+A q (or quit from menu) actually exits

## Theme

Dark theme matching the website:
- Background: #09090b
- Text: #fafafa
- Accent: #a78bfa (purple)
- Borders: rgba(255, 255, 255, 0.06)
- Font: system monospace (Cascadia Code / Consolas on Windows)

## Packaging

- MSI installer via Tauri's WiX bundler
- Installs to `Program Files\wmux`
- Start Menu shortcut
- Registered in Add/Remove Programs
- Binary name: `wmux-app.exe` (coexists with CLI's `wmux.exe`)

## Tech Stack

- **Tauri 2** — desktop app framework (Rust + WebView2)
- **xterm.js** — terminal emulator for the web
- **xterm-addon-fit** — auto-resize terminal to container
- **xterm-addon-webgl** — GPU-accelerated rendering
- **wmux-core** — shared PTY/state library
- **HTML/CSS/JS** — no frontend framework (vanilla JS, keeping it minimal)

## Sub-Project 1 Scope: Tauri Scaffold + Single Terminal

The first deliverable. Get a Tauri window with one xterm.js terminal connected to a PTY.

**What's included:**
- Tauri project setup in `crates/wmux-app/`
- Rust backend with WmuxCore, creating one workspace/surface
- Two Tauri commands: `send_input` and `resize_pane`
- PTY output event emitting to frontend
- Web frontend: single xterm.js instance, full window, dark theme
- xterm-addon-fit for auto-resizing
- xterm-addon-webgl for GPU rendering
- Basic window with standard title bar (custom title bar comes in sub-project 3)

**What's NOT included (later sub-projects):**
- Split panes, tabs, sidebar, status bar
- Custom title bar, right-click menu, drag-and-drop
- System tray, installer
- Keybindings (Ctrl+A prefix)

**Success criteria:** Launch `wmux-app.exe`, see a working terminal (PowerShell/cmd), type commands, see output. Resize the window and the terminal adapts.

## Sub-Project 1 Technical Design

### State Management

`WmuxCore` is stored in Tauri's managed state via `Arc<tokio::sync::Mutex<WmuxCore>>`. Tauri commands acquire the lock, call core methods, and release. Since terminal input/output is high-frequency but short-duration, the async mutex avoids blocking the event loop.

The PTY channel senders (`pty_tx`, `exit_tx`) are also stored in managed state so Tauri commands that spawn PTYs (create_workspace, split_pane) can pass them to `WmuxCore`.

```rust
struct AppState {
    core: tokio::sync::Mutex<WmuxCore>,
    pty_tx: mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    exit_tx: mpsc::UnboundedSender<Uuid>,
}
```

### Channel-to-Event Bridge

At startup, the backend spawns a tokio task that drains `pty_rx` and `exit_rx` channels and emits Tauri events:

```rust
// Spawned once at app startup
tokio::spawn(async move {
    loop {
        tokio::select! {
            Some((id, data)) = pty_rx.recv() => {
                // Encode as base64 and emit to frontend
                app_handle.emit("pty-output", PtyOutputPayload { surface_id: id, data: base64(data) });
            }
            Some(id) = exit_rx.recv() => {
                // Lock core, mark surface exited
                let mut core = state.core.lock().await;
                core.handle_pty_exit(id);
                app_handle.emit("pty-exit", PtyExitPayload { surface_id: id });
            }
        }
    }
});
```

Note: `surface.process_output(data)` is NOT called in the Tauri backend — xterm.js handles terminal emulation on the frontend. The vt100 parser in `Surface` is unused in this context (acceptable overhead from the shared struct; no CPU cost if not called).

### Binary Encoding for PTY Output

PTY output bytes are **base64-encoded** before being sent as Tauri events (JSON-serialized). The frontend decodes base64 back to `Uint8Array` and writes to xterm.js.

```
Backend: Vec<u8> → base64::encode → JSON string → Tauri event
Frontend: JSON string → atob/base64 decode → Uint8Array → xterm.write()
```

For user input (keystrokes), the frontend sends UTF-8 strings via Tauri `invoke`, which are converted to bytes on the Rust side. This is lower frequency so no encoding concern.

### Tauri Command Signatures (Sub-Project 1)

Only two commands needed for the MVP:

```rust
#[tauri::command]
async fn send_input(
    state: tauri::State<'_, AppState>,
    surface_id: String,  // UUID as string (JS doesn't have UUID type)
    data: String,        // UTF-8 input from xterm.js
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    if let Some(surface) = core.surfaces.get_mut(&id) {
        surface.send_bytes(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    state: tauri::State<'_, AppState>,
    surface_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    let id = Uuid::parse_str(&surface_id).map_err(|e| e.to_string())?;
    if let Some(surface) = core.surfaces.get_mut(&id) {
        surface.resize(cols, rows);
    }
    Ok(())
}

#[tauri::command]
async fn get_surface_id(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let core = state.core.lock().await;
    core.focused_surface
        .map(|id| id.to_string())
        .ok_or_else(|| "No focused surface".into())
}
```

Error handling: all Tauri commands return `Result<T, String>`. Internal errors are converted to strings via `.map_err(|e| e.to_string())`. A proper serializable error type is deferred to sub-project 2.

### Project Structure

Standard Tauri 2 layout within the existing workspace:

```
crates/wmux-app/
├── Cargo.toml          ← Rust backend (tauri dependency)
├── tauri.conf.json     ← Tauri configuration
├── build.rs            ← Tauri build script
├── src/
│   ├── main.rs         ← Tauri app entry point, setup, commands
│   └── lib.rs          ← (existing placeholder, becomes module exports)
├── frontend/
│   ├── index.html      ← Single HTML file
│   ├── style.css       ← Dark theme styles
│   ├── main.js         ← App logic, xterm.js setup, IPC
│   └── vendor/
│       ├── xterm.js          ← Vendored (no npm/CDN)
│       ├── xterm.css
│       ├── xterm-addon-fit.js
│       └── xterm-addon-webgl.js
```

Frontend assets are vendored (no npm, no build step). Tauri's `distDir` points to `frontend/`. xterm.js + addons are downloaded and committed to `frontend/vendor/`.

### Initialization Sequence

1. Create `mpsc` channels for PTY output and exit
2. Detect shell via `wmux_core::terminal::shell::detect_shell(None)`
3. Create `WmuxCore::new(shell, String::new())` — empty pipe_path (no named pipe server in GUI mode)
4. Create initial workspace via `core.create_workspace(None, &pty_tx, &exit_tx, 80, 24)` — default size, will be resized by frontend
5. Store `AppState` in Tauri managed state
6. Spawn channel-to-event bridge task
7. Build and show Tauri window
8. Frontend loads, creates xterm.js, calls `get_surface_id()`, starts listening for `pty-output` events
9. Frontend calls `resize_terminal()` with actual terminal dimensions from xterm-addon-fit

### Window Close Behavior (Sub-Project 1)

In sub-project 1 (no system tray), closing the window kills all PTY processes and exits the app. System tray minimize-on-close comes in sub-project 3.

### WebGL Fallback

xterm-addon-webgl is loaded with a try/catch. If WebGL initialization fails, xterm.js falls back to its default canvas renderer automatically. No explicit fallback code needed.
