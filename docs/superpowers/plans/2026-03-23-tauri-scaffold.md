# wmux Tauri App — Sub-Project 1: Scaffold + Single Terminal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a Tauri desktop window with one xterm.js terminal pane connected to a real PTY via WmuxCore.

**Architecture:** Tauri 2 app in `crates/wmux-app/`. Rust backend holds `WmuxCore` in shared state (`Arc<Mutex>`), spawns a channel-to-event bridge task. Web frontend uses vendored xterm.js. IPC via Tauri commands (input) and events (PTY output). PTY output is base64-encoded for JSON transport.

**Tech Stack:** Tauri 2, xterm.js 5, wmux-core, tokio, base64, uuid

**Spec:** `docs/superpowers/specs/2026-03-23-tauri-app-design.md` (Sub-Project 1 section)

---

### Task 1: Install Tauri CLI and set up project structure

**Files:**
- Modify: `crates/wmux-app/Cargo.toml`
- Create: `crates/wmux-app/src/main.rs`
- Create: `crates/wmux-app/build.rs`
- Create: `crates/wmux-app/tauri.conf.json`
- Create: `crates/wmux-app/capabilities/default.json`
- Create: `crates/wmux-app/frontend/index.html`

- [ ] **Step 1: Install Tauri CLI**

```bash
cargo install tauri-cli --version "^2"
```

- [ ] **Step 2: Update wmux-app Cargo.toml**

Replace `crates/wmux-app/Cargo.toml` with:

```toml
[package]
name = "wmux-app"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "wmux-app"
path = "src/main.rs"

[dependencies]
wmux-core = { path = "../wmux-core" }
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4", "serde"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 3: Create build.rs**

Create `crates/wmux-app/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 4: Create tauri.conf.json**

Create `crates/wmux-app/tauri.conf.json`:

```json
{
    "productName": "wmux",
  "version": "0.1.0",
  "identifier": "com.wmux.app",
  "build": {
    "frontendDist": "./frontend"
  },
  "app": {
    "windows": [
      {
        "title": "wmux",
        "width": 900,
        "height": 600,
        "minWidth": 400,
        "minHeight": 300
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

- [ ] **Step 5: Create Tauri capabilities**

Create directory `crates/wmux-app/capabilities/` and file `crates/wmux-app/capabilities/default.json`:

```json
{
    "identifier": "default",
  "description": "Default capabilities for wmux",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:event:allow-emit",
    "core:event:allow-listen"
  ]
}
```

- [ ] **Step 6: Remove placeholder lib.rs and create main.rs**

Delete `crates/wmux-app/src/lib.rs` (the placeholder from the workspace setup). The Tauri app is a binary crate, not a library.

```bash
rm crates/wmux-app/src/lib.rs
```

Create `crates/wmux-app/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Create placeholder frontend**

Create `crates/wmux-app/frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>wmux</title>
  <style>
    body { margin: 0; background: #09090b; color: #fafafa; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
  </style>
</head>
<body>
  <h1>wmux</h1>
</body>
</html>
```

- [ ] **Step 8: Verify the Tauri app builds and launches**

```bash
cd crates/wmux-app && cargo tauri dev
```

A window should appear showing "wmux" text on a dark background. Close it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(app): scaffold Tauri 2 project with minimal window"
```

---

### Task 2: Vendor xterm.js and set up terminal frontend

**Files:**
- Create: `crates/wmux-app/frontend/vendor/xterm.js`
- Create: `crates/wmux-app/frontend/vendor/xterm.css`
- Create: `crates/wmux-app/frontend/vendor/xterm-addon-fit.js`
- Create: `crates/wmux-app/frontend/vendor/xterm-addon-webgl.js`
- Create: `crates/wmux-app/frontend/style.css`
- Create: `crates/wmux-app/frontend/main.js`
- Modify: `crates/wmux-app/frontend/index.html`

- [ ] **Step 1: Download xterm.js and addons via npm**

The `lib/` directory in npm packages contains CommonJS modules, NOT UMD bundles. xterm.js v5 (`@xterm/xterm`) does not ship UMD builds. We must use ES modules with `<script type="module">`.

Use npm to download the packages, then extract the ESM files:

```bash
cd crates/wmux-app/frontend
mkdir -p vendor
npm init -y
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl
```

Copy the ESM bundles (these are in `lib/` and use `export` syntax):

```bash
cp node_modules/@xterm/xterm/lib/xterm.mjs vendor/xterm.mjs 2>/dev/null || cp node_modules/@xterm/xterm/lib/xterm.js vendor/xterm.mjs
cp node_modules/@xterm/xterm/css/xterm.css vendor/xterm.css
cp node_modules/@xterm/addon-fit/lib/addon-fit.mjs vendor/xterm-addon-fit.mjs 2>/dev/null || cp node_modules/@xterm/addon-fit/lib/addon-fit.js vendor/xterm-addon-fit.mjs
cp node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs vendor/xterm-addon-webgl.mjs 2>/dev/null || cp node_modules/@xterm/addon-webgl/lib/addon-webgl.js vendor/xterm-addon-webgl.mjs
```

Clean up npm artifacts:
```bash
rm -rf node_modules package.json package-lock.json
```

Verify files contain JavaScript with `export` statements:
```bash
grep -l "export" crates/wmux-app/frontend/vendor/*.mjs
```

**If files use `module.exports` (CJS) instead of `export` (ESM):** The implementing agent should check the package's `package.json` for an `exports` or `module` field pointing to the ESM entry point, and use that path instead. Alternatively, check for `.mjs` files in the package.

- [ ] **Step 2: Create style.css**

Create `crates/wmux-app/frontend/style.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: #09090b; }
#terminal-container {
  width: 100%;
  height: 100%;
  padding: 4px;
}
.xterm { height: 100%; }
```

- [ ] **Step 3: Create main.js**

Create `crates/wmux-app/frontend/main.js` (ES module):

```javascript
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/xterm-addon-fit.mjs';
import { WebglAddon } from './vendor/xterm-addon-webgl.mjs';

let term;
let fitAddon;
let surfaceId = null;

async function init() {
  // Create terminal
  term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    theme: {
      background: '#09090b',
      foreground: '#fafafa',
      cursor: '#a78bfa',
      selectionBackground: 'rgba(167, 139, 250, 0.3)',
      black: '#09090b',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#a78bfa',
      cyan: '#22d3ee',
      white: '#fafafa',
      brightBlack: '#71717a',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff',
    }
  });

  // Load fit addon
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Try WebGL addon (falls back to canvas if unavailable)
  try {
    const webglAddon = new WebglAddon();
    term.loadAddon(webglAddon);
  } catch (e) {
    console.warn('WebGL addon not available, using canvas renderer');
  }

  // Mount terminal
  const container = document.getElementById('terminal-container');
  term.open(container);
  fitAddon.fit();

  // Get the surface ID from backend
  try {
    surfaceId = await window.__TAURI__.core.invoke('get_surface_id');
  } catch (e) {
    term.write('Error: Could not connect to backend: ' + e + '\r\n');
    return;
  }

  // Send initial size to backend
  await sendResize();

  // Handle user input → send to backend
  term.onData((data) => {
    if (surfaceId) {
      window.__TAURI__.core.invoke('send_input', {
        surfaceId: surfaceId,
        data: data,
      });
    }
  });

  // Handle terminal resize
  term.onResize(({ cols, rows }) => {
    if (surfaceId) {
      window.__TAURI__.core.invoke('resize_terminal', {
        surfaceId: surfaceId,
        cols: cols,
        rows: rows,
      });
    }
  });

  // Listen for PTY output from backend
  window.__TAURI__.event.listen('pty-output', (event) => {
    const { surface_id, data } = event.payload;
    if (surface_id === surfaceId) {
      // Decode base64 to binary
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      term.write(bytes);
    }
  });

  // Listen for PTY exit
  window.__TAURI__.event.listen('pty-exit', (event) => {
    const { surface_id } = event.payload;
    if (surface_id === surfaceId) {
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });
}

async function sendResize() {
  if (surfaceId && term) {
    await window.__TAURI__.core.invoke('resize_terminal', {
      surfaceId: surfaceId,
      cols: term.cols,
      rows: term.rows,
    });
  }
}

// Start when DOM is ready (ES modules are deferred by default)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 4: Update index.html to load xterm.js and main.js**

Replace `crates/wmux-app/frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>wmux</title>
  <link rel="stylesheet" href="vendor/xterm.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="terminal-container"></div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Verify frontend loads in Tauri**

```bash
cd crates/wmux-app && cargo tauri dev
```

Should show a dark window. The terminal won't work yet (no backend commands), but there should be no JS console errors about missing files. The xterm.js terminal should render (blank with a blinking cursor). Close the window.

If xterm.js doesn't render, check the browser console in dev tools (right-click → Inspect) for errors about missing vendor files.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): add xterm.js frontend with dark theme"
```

---

### Task 3: Implement Rust backend with WmuxCore integration

**Files:**
- Rewrite: `crates/wmux-app/src/main.rs`

- [ ] **Step 1: Write the complete Tauri backend**

Replace `crates/wmux-app/src/main.rs` with the full implementation:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;
use wmux_core::WmuxCore;
use wmux_core::terminal::shell::detect_shell;

/// Shared application state accessible from Tauri commands
struct AppState {
    core: Mutex<WmuxCore>,
    pty_tx: mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    exit_tx: mpsc::UnboundedSender<Uuid>,
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
        surface.send_bytes(data.as_bytes()).map_err(|e| e.to_string())?;
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
        surface.resize(cols, rows);
    }
    Ok(())
}

// ── App Setup ──

fn main() {
    tauri::Builder::default()
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

            // Store state
            let state = Arc::new(AppState {
                core: Mutex::new(core),
                pty_tx,
                exit_tx,
            });
            app.manage(state.clone());

            // Spawn channel-to-event bridge
            let bridge_handle = app_handle.clone();
            let bridge_state = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::select! {
                        Some((id, data)) = pty_rx.recv() => {
                            let payload = PtyOutputPayload {
                                surface_id: id.to_string(),
                                data: BASE64.encode(&data),
                            };
                            let _ = bridge_handle.emit("pty-output", payload);
                        }
                        Some(id) = exit_rx.recv() => {
                            // Mark surface as exited in core
                            let mut core = bridge_state.core.lock().await;
                            core.handle_pty_exit(id);
                            drop(core);

                            let payload = PtyExitPayload {
                                surface_id: id.to_string(),
                            };
                            let _ = bridge_handle.emit("pty-exit", payload);
                        }
                        else => break,
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_surface_id,
            send_input,
            resize_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd crates/wmux-app && cargo build
```

Fix any compilation errors.

- [ ] **Step 3: Test the full app**

```bash
cd crates/wmux-app && cargo tauri dev
```

Expected behavior:
- Window opens with dark background
- xterm.js terminal appears with a blinking cursor
- Shell prompt appears (PowerShell or cmd depending on system)
- Typing works — keystrokes appear, commands execute
- Output displays correctly (colors, cursor movement)
- Resizing the window resizes the terminal
- Closing the window exits the app

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(app): connect xterm.js to WmuxCore via Tauri IPC"
```

---

### Task 4: Polish and verify

**Files:**
- Possibly modify: `crates/wmux-app/frontend/main.js`
- Possibly modify: `crates/wmux-app/frontend/style.css`
- Possibly modify: `crates/wmux-app/src/main.rs`

- [ ] **Step 1: Test common terminal operations**

Launch `cargo tauri dev` and test:
- Basic commands: `dir`, `echo hello`, `cls`
- Colors: `dir` output should show colored filenames
- Interactive programs: try `python` or `node` REPL if available
- Ctrl+C: should interrupt running commands
- Arrow keys: should work for command history
- Tab completion: should work in PowerShell

- [ ] **Step 2: Fix any issues found**

Common issues to check:
- If input doesn't work: verify `term.onData` sends to backend correctly
- If output is garbled: check base64 encoding/decoding
- If resize doesn't work: check `term.onResize` fires and calls backend
- If colors are wrong: verify xterm.js theme matches spec

- [ ] **Step 3: Build release binary**

```bash
cd crates/wmux-app && cargo tauri build
```

This produces the MSI installer and the standalone exe. Verify the release binary runs:

```bash
./target/release/wmux-app.exe
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(app): polish terminal rendering and build release"
```
