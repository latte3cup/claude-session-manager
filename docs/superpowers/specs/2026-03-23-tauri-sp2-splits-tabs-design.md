# wmux Tauri App — Sub-Project 2: Splits, Tabs, Sidebar

## Overview

Add full terminal multiplexer functionality to the Tauri desktop app: split panes, tabbed workspaces, collapsible sidebar, status bar, and keyboard shortcuts. This builds on sub-project 1's single-terminal foundation.

## UI Layout

```
┌──────────────────────────────────────────────────┐
│  [1:workspace 1] [2:workspace 2] [+]             │  ← Tab bar
├────────┬─────────────────────────────────────────┤
│        │                                         │
│  work- │   Terminal panes (xterm.js)              │
│  space │   ┌─────────────┬──────────────┐        │
│  list  │   │             │              │        │
│        │   │   pane 1    │   pane 2     │        │
│  1:ws1 │   │             │              │        │
│  2:ws2 │   │             ├──────────────┤        │
│        │   │             │   pane 3     │        │
│  [+]   │   └─────────────┴──────────────┘        │
├────────┴─────────────────────────────────────────┤
│ pwsh │ 1:workspace 1 [1/3]                       │  ← Status bar
└──────────────────────────────────────────────────┘
```

### Tab Bar
- Horizontal strip at the top, dark background
- Each tab shows workspace index and name (e.g. "1:workspace 1")
- Active tab highlighted with accent color bottom border
- [+] button to create new workspace
- Click tab to switch workspace

### Sidebar
- Left panel, ~150px wide
- Lists all workspaces with index and name
- Active workspace highlighted
- [+] button at bottom to create workspace
- Collapsible via hamburger icon (☰) in tab bar
- Default: visible

### Terminal Area
- CSS Grid layout driven by `WmuxCore`'s `SurfaceLayout` data
- Each pane is an independent xterm.js `Terminal` instance
- Focused pane has accent-colored border, unfocused panes have dim border
- Split borders are 1px lines between panes

### Status Bar
- Bottom strip, single line
- Shows: shell name, workspace name, pane index

## WmuxCore Changes

Before implementing the IPC commands, add one method to `WmuxCore` in `crates/wmux-core/src/core.rs`:

```rust
/// Set focus to a specific surface by ID (validates it exists in active workspace)
pub fn focus_surface(&mut self, surface_id: Uuid) {
    if self.surfaces.contains_key(&surface_id) {
        self.focused_surface = Some(surface_id);
    }
}
```

Also add a `focus_direction` IPC command instead of having the frontend compute adjacency — the backend already has `WmuxCore::focus_direction(dir)`.

## New IPC Commands

### Frontend → Backend

```
split_pane(direction: "vertical" | "horizontal") → { surface_id: string }
close_pane(surface_id: string) → { should_quit: bool }
focus_pane(surface_id: string) → {}
focus_direction(direction: "up" | "down" | "left" | "right") → {}
create_workspace(name?: string) → { workspace_id: string }
switch_workspace(index: number) → {}
get_layout(width: number, height: number) → { panes: [...], is_zoomed: bool, shell: string }
get_tab_info() → { tabs: [{ name, is_active }], active_index: number }
toggle_zoom() → {}
```

### Backend → Frontend Events

```
layout-changed → {}   (frontend re-queries get_layout + get_tab_info)
focus-changed → { surface_id: string }
```

When the backend modifies state (split, close, workspace switch, etc.), it emits `layout-changed`. The frontend responds by calling `get_layout()` and `get_tab_info()` to rebuild the UI. This keeps the frontend stateless.

## Keybindings

The frontend intercepts Ctrl+A as a prefix key, same as the CLI:

| Keys | Action | IPC Call |
|------|--------|----------|
| Ctrl+A \| | Split vertical | `split_pane("vertical")` |
| Ctrl+A - | Split horizontal | `split_pane("horizontal")` |
| Ctrl+A Arrow | Move focus | `focus_direction("up"/"down"/"left"/"right")` |
| Ctrl+A x | Close pane | `close_pane(focused_id)` |
| Ctrl+A z | Toggle zoom | `toggle_zoom()` |
| Ctrl+A c | New workspace | `create_workspace()` |
| Ctrl+A n | Next workspace | `switch_workspace(current + 1)` |
| Ctrl+A p | Prev workspace | `switch_workspace(current - 1)` |
| Ctrl+A 1-9 | Jump to workspace | `switch_workspace(n - 1)` |
| Ctrl+A q | Quit | window.close() |
| Ctrl+A Ctrl+A | Send literal Ctrl+A | `send_input(focused_id, "\x01")` |

Prefix mode: when Ctrl+A is pressed, the frontend enters prefix mode (does NOT forward to PTY). The next keypress is interpreted as a command. If the key doesn't match any command, prefix mode is exited and the key is discarded.

Use `attachCustomKeyEventHandler` on each xterm.js instance to intercept Ctrl+A before xterm processes it — this prevents the `^A` character from briefly appearing. The prefix mode flag lives in `keybindings.js` as a module-level boolean.

## Pane Management

### Layout Coordinate System

`get_layout(width, height)` takes the terminal area dimensions in **character cells** (computed by the frontend from the container's pixel size and xterm.js's cell dimensions). The backend calls `split_tree.layout(0, 0, width, height)` and returns `SurfaceLayout` values in cell units. The frontend converts cell positions to CSS pixels using `cellWidth` and `cellHeight` from xterm.js's `_core.dimensions`.

For `split_pane`, the backend uses `core.terminal_size` (set via `set_terminal_size`) to determine the initial PTY size. The frontend should call `get_layout` after splitting, then `resize_terminal` for each pane with actual fitted dimensions.

### WebGL Per-Instance

Each xterm.js instance attempts to load the WebGL addon with try/catch. If WebGL context limit is hit (~8-16 contexts), later instances silently fall back to canvas. This is handled automatically.

### Multiple xterm.js Instances
Each pane has its own xterm.js `Terminal` instance with its own `FitAddon`. When the layout changes:

1. Backend emits `layout-changed`
2. Frontend calls `get_layout()` → gets list of pane rects
3. Frontend creates/destroys xterm.js instances to match the pane list
4. Frontend positions pane containers using CSS absolute positioning within the terminal area
5. Frontend calls `fitAddon.fit()` on each terminal, then `resize_terminal()` to tell the backend

Window resize events are debounced (100ms) to avoid flooding the backend with resize calls when multiple panes exist.

### Pane Lifecycle
- **Created**: when `split_pane` or `create_workspace` adds a new surface. Frontend creates a new xterm.js instance, subscribes to `pty-output` events for that surface_id.
- **Destroyed**: when `close_pane` removes a surface. Frontend disposes the xterm.js instance.
- **All output events include `surface_id`** so the frontend routes output to the correct xterm.js instance.

### Workspace Switching and xterm.js Lifetime

When switching workspaces, the frontend **hides** the current workspace's xterm.js instances (CSS `display: none`) and **shows** the new workspace's instances. Instances are kept alive across switches to preserve scrollback and terminal state. xterm.js instances are only created when a new surface is born and only destroyed when a surface is closed.

All `pty-output` events are routed to their xterm.js instance regardless of which workspace is active. This ensures terminals stay up-to-date even when not visible.

### Close Pane — Last Surface Handling

`close_pane` returns `{ should_quit: bool }`. When `should_quit` is true (all workspaces gone), the frontend closes the window via `window.__TAURI__.window.getCurrent().close()`.

### Focus
- Click on a pane → `focus_pane(surface_id)` → backend updates focus → emits `focus-changed`
- Keybinding arrows → `focus_direction(dir)` → backend navigates → emits `focus-changed`
- Focused pane gets keyboard input via `send_input`

### Zoom Mode
- `toggle_zoom()` → backend toggles zoom on focused pane
- When zoomed, `get_layout()` returns a single pane filling the entire area
- Frontend renders only that pane's xterm.js instance full-size
- Toggle again to exit zoom

## Frontend File Structure

```
crates/wmux-app/frontend/
├── index.html          ← updated with new layout structure
├── style.css           ← updated with tab bar, sidebar, status bar, pane styles
├── main.js             ← app initialization, event wiring
├── terminal-manager.js ← manages multiple xterm.js instances (create/destroy/route)
├── keybindings.js      ← Ctrl+A prefix key handler
├── layout.js           ← positions panes from layout data, handles focus clicks
├── sidebar.js          ← sidebar toggle, workspace list rendering
└── vendor/             ← (unchanged from SP1)
```

Each JS file is an ES module imported by `main.js`.

## Backend Changes

### New Tauri Commands in main.rs

```rust
#[tauri::command]
async fn split_pane(state, direction: String) -> Result<SplitResult, String>

#[tauri::command]
async fn close_pane(state, surface_id: String) -> Result<(), String>

#[tauri::command]
async fn focus_pane(state, surface_id: String) -> Result<(), String>

#[tauri::command]
async fn create_workspace(state, name: Option<String>) -> Result<CreateResult, String>

#[tauri::command]
async fn switch_workspace(state, index: usize) -> Result<(), String>

#[tauri::command]
async fn get_layout(state) -> Result<LayoutResult, String>

#[tauri::command]
async fn get_tab_info(state) -> Result<TabInfoResult, String>

#[tauri::command]
async fn toggle_zoom(state) -> Result<(), String>
```

Commands that modify layout emit `layout-changed` after completing. Commands that change focus emit `focus-changed`.

### Serializable Result Types

```rust
#[derive(Serialize)]
struct PaneInfo { surface_id: String, x: u16, y: u16, width: u16, height: u16, is_focused: bool }

#[derive(Serialize)]
struct LayoutResult { panes: Vec<PaneInfo>, is_zoomed: bool, shell: String }

#[derive(Serialize)]
struct TabInfo { name: String, is_active: bool }

#[derive(Serialize)]
struct TabInfoResult { tabs: Vec<TabInfo>, active_index: usize }

#[derive(Serialize)]
struct SplitResult { surface_id: String }

#[derive(Serialize)]
struct CreateResult { workspace_id: String }
```

## Theme

Same dark theme from SP1:
- Background: #09090b
- Borders (unfocused): rgba(255, 255, 255, 0.06)
- Borders (focused): #a78bfa (accent purple)
- Tab bar background: #111113
- Sidebar background: #0d0d0f
- Status bar background: #111113
- Text: #fafafa
- Muted text: #71717a

## What's NOT Included (Sub-Project 3)

- Custom frameless title bar (uses standard OS title bar for now)
- Right-click context menu
- Drag-and-drop tab reordering
- System tray
- MSI installer
- Settings dialog
