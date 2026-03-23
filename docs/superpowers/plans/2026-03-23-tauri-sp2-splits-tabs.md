# wmux Tauri App SP2: Splits, Tabs, Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add split panes, tabbed workspaces, collapsible sidebar, status bar, and Ctrl+A keybindings to the Tauri desktop app.

**Architecture:** Backend adds new Tauri commands that wrap WmuxCore methods, emitting `layout-changed` events. Frontend is rebuilt with modular JS files: terminal-manager (multi xterm.js), keybindings (Ctrl+A prefix), layout (pane positioning), sidebar (workspace list). Frontend is stateless — it re-queries layout on every change event.

**Tech Stack:** Tauri 2, xterm.js 5, wmux-core, tokio, base64

**Spec:** `docs/superpowers/specs/2026-03-23-tauri-sp2-splits-tabs-design.md`

---

### Task 1: Add focus_surface to WmuxCore + new backend Tauri commands

**Files:**
- Modify: `crates/wmux-core/src/core.rs`
- Modify: `crates/wmux-app/src/main.rs`

- [ ] **Step 1: Add focus_surface method to WmuxCore**

In `crates/wmux-core/src/core.rs`, add this method to `impl WmuxCore`:

```rust
/// Set focus to a specific surface by ID (validates it exists)
pub fn focus_surface(&mut self, surface_id: Uuid) {
    if self.surfaces.contains_key(&surface_id) {
        self.focused_surface = Some(surface_id);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test
```

All 90 tests should still pass.

- [ ] **Step 3: Add serializable result types to main.rs**

Add these structs to `crates/wmux-app/src/main.rs` (after the existing payload structs):

```rust
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
    is_zoomed: bool,
    shell: String,
}

#[derive(Clone, Serialize)]
struct TabInfo {
    name: String,
    is_active: bool,
}

#[derive(Clone, Serialize)]
struct TabInfoResult {
    tabs: Vec<TabInfo>,
    active_index: usize,
}

#[derive(Clone, Serialize)]
struct SplitResult {
    surface_id: String,
}

#[derive(Clone, Serialize)]
struct CreateResult {
    workspace_id: String,
}

#[derive(Clone, Serialize)]
struct CloseResult {
    should_quit: bool,
}

#[derive(Clone, Serialize)]
struct FocusChangedPayload {
    surface_id: String,
}
```

- [ ] **Step 4: Add new Tauri commands**

Add these commands to `crates/wmux-app/src/main.rs`. Each command that modifies layout emits `layout-changed`. Focus changes emit `focus-changed`.

```rust
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
    let result = core.split_surface(dir, &state.pty_tx, &state.exit_tx, cols / 2, rows / 2)
        .map_err(|e| e.to_string())?;
    match result {
        Some(id) => {
            let _ = app_handle.emit("layout-changed", ());
            let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: id.to_string() });
            Ok(SplitResult { surface_id: id.to_string() })
        }
        None => Err("No focused surface to split".to_string()),
    }
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
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
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
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
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
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
    }
    Ok(())
}

#[tauri::command]
async fn create_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    name: Option<String>,
) -> Result<CreateResult, String> {
    let mut core = state.core.lock().await;
    let (cols, rows) = core.terminal_size;
    let ws_id = core.create_workspace(name, &state.pty_tx, &state.exit_tx, cols, rows)
        .map_err(|e| e.to_string())?;
    let _ = app_handle.emit("layout-changed", ());
    Ok(CreateResult { workspace_id: ws_id.to_string() })
}

#[tauri::command]
async fn switch_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    index: usize,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.switch_workspace(index);
    let _ = app_handle.emit("layout-changed", ());
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
    }
    Ok(())
}

#[tauri::command]
async fn next_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.next_workspace();
    let _ = app_handle.emit("layout-changed", ());
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
    }
    Ok(())
}

#[tauri::command]
async fn prev_workspace(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.prev_workspace();
    let _ = app_handle.emit("layout-changed", ());
    if let Some(focused) = core.focused_surface {
        let _ = app_handle.emit("focus-changed", FocusChangedPayload { surface_id: focused.to_string() });
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
            x: 0, y: 0, width, height,
            is_focused: true,
        }]
    } else if let Some(ws) = core.active_workspace_ref() {
        ws.split_tree.layout(0, 0, width, height)
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

    let shell_name = core.shell.rsplit(['\\', '/']).next().unwrap_or(&core.shell).to_string();

    Ok(LayoutResult {
        panes,
        is_zoomed: core.zoom_surface.is_some(),
        shell: shell_name,
    })
}

#[tauri::command]
async fn get_tab_info(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<TabInfoResult, String> {
    let core = state.core.lock().await;
    let tabs: Vec<TabInfo> = core.tab_info()
        .into_iter()
        .map(|(name, is_active)| TabInfo { name, is_active })
        .collect();
    let active_index = core.active_workspace;
    Ok(TabInfoResult { tabs, active_index })
}

#[tauri::command]
async fn toggle_zoom(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.toggle_zoom();
    let _ = app_handle.emit("layout-changed", ());
    Ok(())
}
```

- [ ] **Step 5: Register all commands in invoke_handler**

Update the `invoke_handler` in main.rs:

```rust
.invoke_handler(tauri::generate_handler![
    get_surface_id,
    send_input,
    resize_terminal,
    split_pane,
    close_pane,
    focus_pane,
    focus_direction,
    create_workspace,
    switch_workspace,
    next_workspace,
    prev_workspace,
    get_layout,
    get_tab_info,
    toggle_zoom,
])
```

- [ ] **Step 6: Verify build**

```bash
cargo build
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(app): add split, workspace, layout, and zoom Tauri commands"
```

---

### Task 2: Rewrite frontend HTML/CSS for multi-pane layout

**Files:**
- Rewrite: `crates/wmux-app/frontend/index.html`
- Rewrite: `crates/wmux-app/frontend/style.css`

- [ ] **Step 1: Update index.html with full layout structure**

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
  <!-- Tab Bar -->
  <div id="tab-bar">
    <button id="sidebar-toggle" title="Toggle sidebar">&#9776;</button>
    <div id="tabs"></div>
    <button id="new-tab" title="New workspace">+</button>
  </div>

  <div id="main-area">
    <!-- Sidebar -->
    <div id="sidebar">
      <div id="workspace-list"></div>
      <button id="sidebar-new-ws" title="New workspace">+ New Workspace</button>
    </div>

    <!-- Terminal Pane Area -->
    <div id="pane-area"></div>
  </div>

  <!-- Status Bar -->
  <div id="status-bar">
    <span id="status-shell"></span>
    <span id="status-workspace"></span>
    <span id="status-pane"></span>
  </div>

  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write complete style.css**

Replace `crates/wmux-app/frontend/style.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: #09090b; color: #fafafa; font-family: -apple-system, 'Segoe UI', sans-serif; }

/* Layout */
body { display: flex; flex-direction: column; }
#tab-bar { height: 36px; flex-shrink: 0; }
#main-area { flex: 1; display: flex; overflow: hidden; }
#status-bar { height: 24px; flex-shrink: 0; }

/* Tab Bar */
#tab-bar {
  background: #111113;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  -webkit-app-region: drag;
}
#tab-bar button, .tab {
  -webkit-app-region: no-drag;
}
#sidebar-toggle {
  background: none;
  border: none;
  color: #71717a;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
#sidebar-toggle:hover { color: #fafafa; background: rgba(255,255,255,0.06); }
#tabs {
  display: flex;
  flex: 1;
  gap: 0;
  overflow-x: auto;
  padding: 0 4px;
}
.tab {
  padding: 6px 16px;
  font-size: 12px;
  color: #71717a;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  transition: color 0.15s;
}
.tab:hover { color: #fafafa; }
.tab.active { color: #fafafa; border-bottom-color: #a78bfa; }
#new-tab {
  background: none;
  border: none;
  color: #71717a;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
#new-tab:hover { color: #fafafa; background: rgba(255,255,255,0.06); }

/* Sidebar */
#sidebar {
  width: 160px;
  flex-shrink: 0;
  background: #0d0d0f;
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
#sidebar.hidden { display: none; }
#workspace-list { flex: 1; padding: 8px 0; }
.ws-item {
  padding: 6px 16px;
  font-size: 12px;
  color: #71717a;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.ws-item:hover { color: #fafafa; background: rgba(255,255,255,0.04); }
.ws-item.active { color: #fafafa; background: rgba(167,139,250,0.1); border-left: 2px solid #a78bfa; }
#sidebar-new-ws {
  background: none;
  border: none;
  border-top: 1px solid rgba(255,255,255,0.06);
  color: #71717a;
  font-size: 12px;
  padding: 8px 16px;
  cursor: pointer;
  text-align: left;
}
#sidebar-new-ws:hover { color: #fafafa; background: rgba(255,255,255,0.04); }

/* Pane Area */
#pane-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.pane {
  position: absolute;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.06);
}
.pane.focused { border-color: #a78bfa; }
.pane .xterm { width: 100%; height: 100%; }

/* Status Bar */
#status-bar {
  background: #111113;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  font-size: 11px;
  color: #71717a;
}
```

- [ ] **Step 3: Verify build**

```bash
cd crates/wmux-app && cargo build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(app): add tab bar, sidebar, status bar, and pane area layout"
```

---

### Task 3: Create terminal-manager.js

**Files:**
- Create: `crates/wmux-app/frontend/terminal-manager.js`

- [ ] **Step 1: Create terminal-manager.js**

This module manages multiple xterm.js instances — creating, destroying, and routing output.

Create `crates/wmux-app/frontend/terminal-manager.js`:

```javascript
import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { WebglAddon } from './vendor/addon-webgl.mjs';

const THEME = {
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
};

// Map of surfaceId → { term, fitAddon, container, onDataDispose }
const terminals = new Map();

// The currently focused surface ID
let focusedId = null;

// Callback set by main.js for input forwarding
let onInputCallback = null;

export function setOnInput(callback) {
  onInputCallback = callback;
}

export function createTerminal(surfaceId) {
  if (terminals.has(surfaceId)) return terminals.get(surfaceId);

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    theme: THEME,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  try {
    const webglAddon = new WebglAddon();
    term.loadAddon(webglAddon);
  } catch (e) {
    // WebGL not available or context limit hit — canvas fallback
  }

  const container = document.createElement('div');
  container.className = 'pane';
  container.dataset.surfaceId = surfaceId;
  document.getElementById('pane-area').appendChild(container);

  term.open(container);

  // Forward input to backend
  const onDataDispose = term.onData((data) => {
    if (surfaceId === focusedId && onInputCallback) {
      onInputCallback(surfaceId, data);
    }
  });

  // Click to focus
  container.addEventListener('mousedown', () => {
    if (onInputCallback) {
      window.__TAURI__.core.invoke('focus_pane', { surfaceId });
    }
  });

  const entry = { term, fitAddon, container, onDataDispose };
  terminals.set(surfaceId, entry);
  return entry;
}

export function destroyTerminal(surfaceId) {
  const entry = terminals.get(surfaceId);
  if (!entry) return;
  entry.onDataDispose.dispose();
  entry.term.dispose();
  entry.container.remove();
  terminals.delete(surfaceId);
}

export function writeOutput(surfaceId, data) {
  const entry = terminals.get(surfaceId);
  if (entry) {
    entry.term.write(data);
  }
}

export function setFocused(surfaceId) {
  focusedId = surfaceId;
  for (const [id, entry] of terminals) {
    entry.container.classList.toggle('focused', id === surfaceId);
    if (id === surfaceId) {
      entry.term.focus();
    }
  }
}

export function getFocusedId() {
  return focusedId;
}

export function getTerminal(surfaceId) {
  return terminals.get(surfaceId);
}

export function getAllSurfaceIds() {
  return new Set(terminals.keys());
}

// Position panes based on layout data and fit them.
// totalWidthCells/totalHeightCells are the cell dimensions passed to get_layout.
export function applyLayout(panes, totalWidthCells, totalHeightCells) {
  const newIds = new Set(panes.map(p => p.surface_id));

  // Hide terminals not in this layout (workspace switch — keep alive for scrollback)
  for (const [id, entry] of terminals) {
    if (!newIds.has(id)) {
      entry.container.style.display = 'none';
    }
  }

  // Create new terminals and position all visible ones
  for (const pane of panes) {
    let entry = terminals.get(pane.surface_id);
    if (!entry) {
      entry = createTerminal(pane.surface_id);
    }

    // Convert cell coordinates to percentages of the pane area
    const left = (pane.x / totalWidthCells) * 100;
    const top = (pane.y / totalHeightCells) * 100;
    const width = (pane.width / totalWidthCells) * 100;
    const height = (pane.height / totalHeightCells) * 100;

    entry.container.style.left = `${left}%`;
    entry.container.style.top = `${top}%`;
    entry.container.style.width = `${width}%`;
    entry.container.style.height = `${height}%`;
    entry.container.style.display = '';

    if (pane.is_focused) {
      setFocused(pane.surface_id);
    }
  }

  // Fit all terminals after positioning (need a frame for CSS to settle)
  requestAnimationFrame(() => {
    for (const pane of panes) {
      const entry = terminals.get(pane.surface_id);
      if (entry) {
        entry.fitAddon.fit();
      }
    }
  });
}

// Hide all terminals (used when switching workspaces — terminals for other workspaces stay alive)
export function hideAll() {
  for (const [, entry] of terminals) {
    entry.container.style.display = 'none';
  }
}

// Get xterm.js cell dimensions (for converting pixel area to cell counts)
export function getCellDimensions() {
  // Use the first terminal's dimensions as reference
  for (const [, entry] of terminals) {
    const dims = entry.term._core._renderService?.dimensions;
    if (dims) {
      return { cellWidth: dims.css.cell.width, cellHeight: dims.css.cell.height };
    }
  }
  // Fallback
  return { cellWidth: 8, cellHeight: 16 };
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(app): add terminal-manager.js for multi-instance xterm.js"
```

---

### Task 4: Create keybindings.js, layout.js, sidebar.js

**Files:**
- Create: `crates/wmux-app/frontend/keybindings.js`
- Create: `crates/wmux-app/frontend/layout.js`
- Create: `crates/wmux-app/frontend/sidebar.js`

- [ ] **Step 1: Create keybindings.js**

Create `crates/wmux-app/frontend/keybindings.js`:

```javascript
const { invoke } = window.__TAURI__.core;

let prefixMode = false;

// Attach to an xterm.js terminal instance
export function attachKeybindings(term, getFocusedSurfaceId) {
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;

    // Ctrl+A pressed — enter prefix mode
    if (!prefixMode && event.ctrlKey && event.key === 'a') {
      prefixMode = true;
      return false; // suppress
    }

    if (prefixMode) {
      prefixMode = false;

      // Ctrl+A Ctrl+A → send literal Ctrl+A
      if (event.ctrlKey && event.key === 'a') {
        const surfaceId = getFocusedSurfaceId();
        if (surfaceId) invoke('send_input', { surfaceId, data: '\x01' });
        return false;
      }

      switch (event.key) {
        case '|':
        case '\\':
          invoke('split_pane', { direction: 'vertical' });
          return false;
        case '-':
          invoke('split_pane', { direction: 'horizontal' });
          return false;
        case 'x':
          const id = getFocusedSurfaceId();
          if (id) {
            invoke('close_pane', { surfaceId: id }).then(result => {
              if (result && result.should_quit) {
                window.__TAURI__.window.getCurrent().close();
              }
            });
          }
          return false;
        case 'z':
          invoke('toggle_zoom');
          return false;
        case 'c':
          invoke('create_workspace', { name: null });
          return false;
        case 'n':
          invoke('switch_workspace', { index: -1 }); // handled specially below
          return false;
        case 'p':
          invoke('switch_workspace', { index: -2 }); // handled specially below
          return false;
        case 'q':
          window.__TAURI__.window.getCurrent().close();
          return false;
        case 'ArrowUp':
          invoke('focus_direction', { direction: 'up' });
          return false;
        case 'ArrowDown':
          invoke('focus_direction', { direction: 'down' });
          return false;
        case 'ArrowLeft':
          invoke('focus_direction', { direction: 'left' });
          return false;
        case 'ArrowRight':
          invoke('focus_direction', { direction: 'right' });
          return false;
        default:
          // Check for workspace number (1-9)
          if (event.key >= '1' && event.key <= '9') {
            invoke('switch_workspace', { index: parseInt(event.key) - 1 });
            return false;
          }
          // Unknown prefix command — discard
          return false;
      }
    }

    // Not in prefix mode — let xterm handle normally
    return true;
  });
}

// For n/p workspace switching, we need the current index.
// Override the switch_workspace to handle -1 (next) and -2 (prev) specially.
// Actually, we should use the backend's next/prev methods instead.
// Let's fix the keybindings to call the right backend commands.
```

Wait — the backend has `next_workspace` and `prev_workspace` on WmuxCore but they're not exposed as Tauri commands. Let me add them. Actually, the spec says `switch_workspace(index)` handles n/p by the frontend calculating current+1. But it's cleaner to add `next_workspace` and `prev_workspace` commands.

Let me revise — update keybindings.js to use proper invocations:

```javascript
const { invoke } = window.__TAURI__.core;

let prefixMode = false;

export function attachKeybindings(term, getFocusedSurfaceId, getCurrentTabIndex) {
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;

    if (!prefixMode && event.ctrlKey && event.key === 'a') {
      prefixMode = true;
      return false;
    }

    if (prefixMode) {
      prefixMode = false;

      if (event.ctrlKey && event.key === 'a') {
        const surfaceId = getFocusedSurfaceId();
        if (surfaceId) invoke('send_input', { surfaceId, data: '\x01' });
        return false;
      }

      const surfaceId = getFocusedSurfaceId();

      switch (event.key) {
        case '|':
        case '\\':
          invoke('split_pane', { direction: 'vertical' });
          break;
        case '-':
          invoke('split_pane', { direction: 'horizontal' });
          break;
        case 'x':
          if (surfaceId) {
            invoke('close_pane', { surfaceId }).then(r => {
              if (r?.should_quit) window.__TAURI__.window.getCurrentWindow().close();
            });
          }
          break;
        case 'z':
          invoke('toggle_zoom');
          break;
        case 'c':
          invoke('create_workspace', { name: null });
          break;
        case 'n':
          invoke('next_workspace');
          break;
        case 'p':
          invoke('prev_workspace');
          break;
        case 'q':
          window.__TAURI__.window.getCurrentWindow().close();
          break;
        case 'ArrowUp':
          invoke('focus_direction', { direction: 'up' });
          break;
        case 'ArrowDown':
          invoke('focus_direction', { direction: 'down' });
          break;
        case 'ArrowLeft':
          invoke('focus_direction', { direction: 'left' });
          break;
        case 'ArrowRight':
          invoke('focus_direction', { direction: 'right' });
          break;
        default:
          if (event.key >= '1' && event.key <= '9') {
            invoke('switch_workspace', { index: parseInt(event.key) - 1 });
          }
          break;
      }
      return false;
    }

    return true;
  });
}
```

- [ ] **Step 2: Create layout.js**

Create `crates/wmux-app/frontend/layout.js`:

```javascript
import * as tm from './terminal-manager.js';

const { invoke } = window.__TAURI__.core;

let resizeTimeout = null;

export async function refreshLayout() {
  const paneArea = document.getElementById('pane-area');
  const rect = paneArea.getBoundingClientRect();

  // Get cell dimensions to convert pixels to cells
  const { cellWidth, cellHeight } = tm.getCellDimensions();
  const widthCells = Math.floor(rect.width / cellWidth) || 80;
  const heightCells = Math.floor(rect.height / cellHeight) || 24;

  const layout = await invoke('get_layout', { width: widthCells, height: heightCells });

  tm.applyLayout(layout.panes, widthCells, heightCells);

  // Resize PTYs to match fitted terminal dimensions
  for (const pane of layout.panes) {
    const entry = tm.getTerminal(pane.surface_id);
    if (entry) {
      invoke('resize_terminal', {
        surfaceId: pane.surface_id,
        cols: entry.term.cols,
        rows: entry.term.rows,
      });
    }
  }

  // Update status bar
  const tabInfo = await invoke('get_tab_info');
  const statusShell = document.getElementById('status-shell');
  const statusWorkspace = document.getElementById('status-workspace');
  const statusPane = document.getElementById('status-pane');

  statusShell.textContent = layout.shell;
  if (tabInfo.tabs[tabInfo.active_index]) {
    statusWorkspace.textContent = tabInfo.tabs[tabInfo.active_index].name;
  }
  const paneIdx = layout.panes.findIndex(p => p.is_focused);
  statusPane.textContent = `pane ${paneIdx + 1}/${layout.panes.length}`;
}

export function setupResizeHandler() {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => refreshLayout(), 100);
  });
}
```

- [ ] **Step 3: Create sidebar.js**

Create `crates/wmux-app/frontend/sidebar.js`:

```javascript
const { invoke } = window.__TAURI__.core;

let sidebarVisible = true;

export function setupSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const newWsBtn = document.getElementById('sidebar-new-ws');
  const newTabBtn = document.getElementById('new-tab');

  toggle.addEventListener('click', () => {
    sidebarVisible = !sidebarVisible;
    sidebar.classList.toggle('hidden', !sidebarVisible);
  });

  newWsBtn.addEventListener('click', () => {
    invoke('create_workspace', { name: null });
  });

  newTabBtn.addEventListener('click', () => {
    invoke('create_workspace', { name: null });
  });
}

export async function refreshTabs() {
  const result = await invoke('get_tab_info');
  const tabsEl = document.getElementById('tabs');
  const wsList = document.getElementById('workspace-list');

  // Render tabs
  tabsEl.innerHTML = '';
  result.tabs.forEach((tab, idx) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.is_active ? ' active' : '');
    el.textContent = `${idx + 1}:${tab.name}`;
    el.addEventListener('click', () => invoke('switch_workspace', { index: idx }));
    tabsEl.appendChild(el);
  });

  // Render sidebar workspace list
  wsList.innerHTML = '';
  result.tabs.forEach((tab, idx) => {
    const el = document.createElement('div');
    el.className = 'ws-item' + (tab.is_active ? ' active' : '');
    el.textContent = `${idx + 1}: ${tab.name}`;
    el.addEventListener('click', () => invoke('switch_workspace', { index: idx }));
    wsList.appendChild(el);
  });

  return result;
}

export function getActiveIndex() {
  // Read from DOM
  const active = document.querySelector('.tab.active');
  if (!active) return 0;
  const tabs = [...document.querySelectorAll('.tab')];
  return tabs.indexOf(active);
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(app): add keybindings, layout, and sidebar modules"
```

---

### Task 5: Rewrite main.js and wire everything together

**Files:**
- Rewrite: `crates/wmux-app/frontend/main.js`

- [ ] **Step 1: Add keybinding hook to terminal-manager.js**

Add to `crates/wmux-app/frontend/terminal-manager.js`, near the top:

```javascript
let onNewTerminalCallback = null;

export function setOnNewTerminal(callback) {
  onNewTerminalCallback = callback;
}
```

Then in the `createTerminal` function, after `term.open(container)`, add:

```javascript
  if (onNewTerminalCallback) {
    onNewTerminalCallback(surfaceId, term);
  }
```

- [ ] **Step 2: Rewrite main.js**

Replace `crates/wmux-app/frontend/main.js`:

```javascript
import * as tm from './terminal-manager.js';
import { attachKeybindings } from './keybindings.js';
import { refreshLayout, setupResizeHandler } from './layout.js';
import { setupSidebar, refreshTabs, getActiveIndex } from './sidebar.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

async function init() {
  // Forward terminal input to backend
  tm.setOnInput((surfaceId, data) => {
    invoke('send_input', { surfaceId, data });
  });

  // Attach keybindings when new terminals are created
  tm.setOnNewTerminal((surfaceId, term) => {
    attachKeybindings(term, () => tm.getFocusedId(), getActiveIndex);
  });

  // Set up sidebar buttons
  setupSidebar();

  // Set up window resize debouncing
  setupResizeHandler();

  // PTY output → route to correct terminal
  listen('pty-output', (event) => {
    const { surface_id, data } = event.payload;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    tm.writeOutput(surface_id, bytes);
  });

  // PTY exit
  listen('pty-exit', (event) => {
    const { surface_id } = event.payload;
    tm.writeOutput(surface_id, new TextEncoder().encode('\r\n\x1b[90m[Process exited]\x1b[0m\r\n'));
  });

  // Layout/focus changes → refresh UI
  listen('layout-changed', async () => {
    await refreshTabs();
    await refreshLayout();
  });

  listen('focus-changed', (event) => {
    tm.setFocused(event.payload.surface_id);
  });

  // Initial load
  await refreshTabs();
  await refreshLayout();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 3: Verify build**

```bash
cd crates/wmux-app && cargo build
```

- [ ] **Step 4: Test with cargo tauri dev**

```bash
cd crates/wmux-app && cargo tauri dev
```

Test:
- Terminal appears with shell prompt
- Ctrl+A | → splits vertically (two panes)
- Ctrl+A - → splits horizontally
- Ctrl+A Arrow → moves focus between panes
- Ctrl+A c → creates new workspace (new tab appears)
- Click tabs → switches workspaces
- Ctrl+A x → closes pane
- Sidebar shows workspaces, click to switch
- Status bar shows shell and workspace info
- Window resize → all panes resize
- Ctrl+A z → zoom/unzoom focused pane
- Ctrl+A q → quits

- [ ] **Step 5: Fix any issues found**

Common issues:
- If panes don't position correctly: check the percentage calculation in `applyLayout`
- If keybindings don't fire: check `attachCustomKeyEventHandler` is registered
- If new panes show blank: ensure `pty-output` listener is active before the terminal is created
- If workspace switch doesn't work: ensure `switch_workspace` wraps around properly

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): wire up splits, tabs, sidebar, keybindings — full multiplexer UI"
```
