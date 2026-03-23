# wmux Core Extraction — Design Spec

## Overview

Extract shared logic from the current single-crate `wmux` into a Cargo workspace with three crates: `wmux-core` (shared library), `wmux-cli` (TUI frontend), and `wmux-app` (placeholder for future Tauri GUI). The goal is to cleanly separate state management and PTY logic from rendering and input, enabling multiple frontends to share the same core.

## Motivation

wmux is evolving from a CLI tool into a product with both a TUI and a Tauri-based desktop GUI. The current codebase has state management, PTY handling, socket API, and ratatui rendering interleaved in a single crate — primarily in `app.rs` (22KB). Extracting a clean core library enables the future GUI frontend to reuse all the non-UI logic without pulling in crossterm or ratatui.

## Workspace Structure

```
wmux/
├── Cargo.toml              ← workspace root (members: crates/*)
├── crates/
│   ├── wmux-core/          ← shared library
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs          ← re-exports public types (including vt100::Screen)
│   │       ├── core.rs         ← WmuxCore struct (state management)
│   │       ├── error.rs        ← WmuxError type
│   │       ├── model/
│   │       │   ├── mod.rs
│   │       │   ├── split_tree.rs
│   │       │   ├── workspace.rs
│   │       │   └── surface.rs
│   │       ├── terminal/
│   │       │   ├── mod.rs
│   │       │   ├── pty.rs
│   │       │   └── shell.rs
│   │       └── socket/
│   │           ├── mod.rs
│   │           ├── protocol.rs
│   │           └── commands.rs
│   ├── wmux-cli/           ← TUI frontend
│   │   ├── Cargo.toml      ← [[bin]] name = "wmux"
│   │   └── src/
│   │       ├── main.rs         ← CLI args (clap), which() helper, launches event loop
│   │       ├── event_loop.rs   ← async tokio::select! loop
│   │       ├── input.rs        ← crossterm key/mouse → core operations
│   │       └── tui/
│   │           ├── mod.rs
│   │           ├── render.rs
│   │           ├── surface_view.rs
│   │           ├── tabs.rs
│   │           └── status.rs
│   └── wmux-app/           ← placeholder for Tauri GUI
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
```

## Crate Responsibilities

### `wmux-core`

Shared library with no UI dependencies. Owns:

- **Models**: `SplitNode`, `Workspace`, `Surface`, `SurfaceLayout` — data structures for layout, workspace management, and terminal pane state
- **Terminal**: PTY spawning/reading (`portable-pty`), shell detection, VT100 parsing (`vt100`)
- **Socket**: JSON-RPC protocol types, command dispatch logic
- **State management**: `WmuxCore` struct — the central API that frontends interact with
- **Error type**: `WmuxError` enum for structured errors
- **Re-exports**: `vt100::Screen` re-exported so frontends don't need a direct `vt100` dependency

Dependencies: `portable-pty`, `vt100`, `tokio`, `serde`, `serde_json`, `uuid`

Does NOT depend on: `ratatui`, `crossterm`, or any UI/rendering library.

Note: `socket/server.rs` (named pipe transport) stays in `wmux-cli` — it is transport infrastructure, not core logic. Core provides `commands::dispatch()` which the CLI's server calls.

### `wmux-cli`

Thin TUI frontend. Owns:

- **Rendering**: ratatui-based terminal UI (split panes, tabs, status bar, surface views)
- **Input**: crossterm keyboard/mouse event handling, mapping input events to core operations
- **Event loop**: async `tokio::select!` loop coordinating crossterm input, PTY output/exit channels, socket server, and ratatui rendering at 30fps
- **Socket server**: `server.rs` — named pipe transport, calls into `wmux-core::commands::dispatch()`
- **Drag state**: mouse drag-to-resize tracking (CLI-specific input concern)

Dependencies: `wmux-core`, `ratatui`, `crossterm`, `tokio`, `clap`

### `wmux-app`

Empty placeholder for the future Tauri desktop GUI. Contains only a skeleton `lib.rs`. Will be built in a separate spec/plan cycle after core extraction is complete.

Dependencies: `wmux-core` (only, for now)

## Data Flow Architecture

The core question: how do PTY output and exit notifications flow between core's spawned threads and the frontend's event loop?

### Channel Topology

```
                    ┌─────────────────────────────────────┐
                    │           wmux-core                   │
                    │                                       │
  pty_tx ──────────►│  WmuxCore                             │
  (PTY reader       │    .process_pty_output(id, data)      │
   threads feed     │    .handle_pty_exit(id)               │
   the frontend)    │    .surfaces: HashMap<Uuid, Surface>  │
                    │    .workspaces: Vec<Workspace>        │
                    └─────────────────────────────────────┘
                                    ▲
                                    │ core methods
                    ┌───────────────┴─────────────────────┐
                    │           wmux-cli                    │
                    │                                       │
                    │  Event Loop (tokio::select!)           │
                    │    ├── input_rx  ← crossterm thread    │
                    │    ├── pty_rx    ← PTY reader threads  │
                    │    ├── exit_rx   ← PTY exit threads    │
                    │    ├── socket_rx ← named pipe server   │
                    │    └── render    ← 30fps timer         │
                    └───────────────────────────────────────┘
```

### Design decisions:

1. **The CLI frontend owns the `mpsc` channels** (`pty_tx`/`pty_rx`, `exit_tx`/`exit_rx`). These are event-loop infrastructure.
2. **`WmuxCore` receives channel senders** when spawning PTY processes. Methods like `create_workspace()` and `split_surface()` take `pty_tx` and `exit_tx` as parameters (same pattern as current code).
3. **The frontend drains channels** in its `tokio::select!` loop and calls `core.process_pty_output(id, data)` and `core.handle_pty_exit(id)` to feed data into the core's state.
4. **No `pending_output()` method** — the polling model is replaced by the explicit channel-draining pattern above. This is simpler and matches the current architecture.
5. **`should_quit`** is a method on `WmuxCore` (`pub fn should_quit(&self) -> bool`) that the event loop checks each iteration.
6. **`terminal_size`** is tracked in `WmuxCore` via `pub fn set_terminal_size(&mut self, w: u16, h: u16)` — core needs it for resize operations and socket command responses.

## `WmuxCore` Public API

```rust
use uuid::Uuid;

/// Type aliases for clarity
pub type SurfaceId = Uuid;
pub type WorkspaceId = Uuid;

/// Split direction (Horizontal / Vertical) — matches existing SplitNode::Direction
pub use crate::model::split_tree::SplitDirection;

/// Focus navigation direction — distinct from SplitDirection
pub enum FocusDirection {
    Up, Down, Left, Right,
}

pub struct WmuxCore {
    workspaces: Vec<Workspace>,
    surfaces: HashMap<SurfaceId, Surface>,
    active_workspace: usize,
    focused_surface: Option<SurfaceId>,
    zoom_surface: Option<SurfaceId>,
    shell: String,
    pipe_path: String,
    should_quit: bool,
    terminal_size: (u16, u16),
}

impl WmuxCore {
    // Lifecycle
    pub fn new(shell: String, pipe_path: String) -> Self;
    pub fn should_quit(&self) -> bool;
    pub fn request_quit(&mut self);
    pub fn set_terminal_size(&mut self, w: u16, h: u16);
    pub fn terminal_size(&self) -> (u16, u16);

    // Workspace operations — pty_tx/exit_tx passed in for PTY spawning
    pub fn create_workspace(
        &mut self,
        name: Option<String>,
        pty_tx: &mpsc::UnboundedSender<(SurfaceId, Vec<u8>)>,
        exit_tx: &mpsc::UnboundedSender<SurfaceId>,
        cols: u16,
        rows: u16,
    ) -> Result<WorkspaceId, WmuxError>;
    pub fn switch_workspace(&mut self, index: usize);
    pub fn next_workspace(&mut self);
    pub fn prev_workspace(&mut self);
    pub fn active_workspace(&self) -> Option<&Workspace>;
    pub fn workspace_count(&self) -> usize;
    pub fn tab_info(&self) -> Vec<(String, bool)>;

    // Pane operations
    pub fn split_surface(
        &mut self,
        direction: SplitDirection,
        pty_tx: &mpsc::UnboundedSender<(SurfaceId, Vec<u8>)>,
        exit_tx: &mpsc::UnboundedSender<SurfaceId>,
        cols: u16,
        rows: u16,
    ) -> Result<Option<SurfaceId>, WmuxError>;
    pub fn close_surface(&mut self, id: SurfaceId) -> bool; // returns true if should quit
    pub fn focus_direction(&mut self, dir: FocusDirection);
    pub fn toggle_zoom(&mut self);

    // Surface (PTY) interaction
    pub fn surfaces(&self) -> &HashMap<SurfaceId, Surface>;
    pub fn surfaces_mut(&mut self) -> &mut HashMap<SurfaceId, Surface>;
    pub fn focused_surface(&self) -> Option<SurfaceId>;
    pub fn surface_screen(&self, id: SurfaceId) -> Option<&vt100::Screen>;
    pub fn send_input(&mut self, id: SurfaceId, data: &[u8]) -> Result<(), WmuxError>;

    // PTY data processing — called by frontend when channels drain
    pub fn process_pty_output(&mut self, id: SurfaceId, data: &[u8]);
    pub fn handle_pty_exit(&mut self, id: SurfaceId);

    // Layout queries (for rendering)
    pub fn pane_layouts(&self, width: u16, height: u16) -> Vec<SurfaceLayout>;
    pub fn resize_active_workspace(&mut self);

    // Drag/resize support — core handles the split tree mutation
    pub fn set_ratio_at(&mut self, path: &[bool], ratio: f64);
}
```

Core re-exports `vt100::Screen` and `SurfaceLayout` so frontends can use them without adding direct dependencies.

## Error Type

```rust
#[derive(Debug)]
pub enum WmuxError {
    PtySpawn(String),
    ShellNotFound(String),
    Io(std::io::Error),
    SurfaceNotFound(SurfaceId),
}
```

## Migration Strategy

Incremental extraction — each step produces a working commit with all tests passing.

### Step 1: Convert to Cargo workspace

- Create workspace `Cargo.toml` at root
- Move current `src/` into `crates/wmux-cli/src/`
- Move current `Cargo.toml` dependencies into `crates/wmux-cli/Cargo.toml`
- Add `[[bin]] name = "wmux"` in `crates/wmux-cli/Cargo.toml` to preserve binary name
- Create empty `crates/wmux-core/` and `crates/wmux-app/` skeletons
- Move `tests/` to `crates/wmux-cli/tests/` — tests import from `wmux_cli::` temporarily
- Update import paths, verify `cargo build` and `cargo test` pass

### Step 2: Move pure models and terminal layer to core

Move together because `Surface` depends on `PtyHandle` and `vt100`:

- Move `model/split_tree.rs`, `model/workspace.rs` to `wmux-core` (pure, no deps)
- Move `terminal/pty.rs`, `terminal/shell.rs` to `wmux-core`
- Move `model/surface.rs` to `wmux-core` (depends on `PtyHandle` and `vt100`, which are now in core)
- Dependencies moved to core: `portable-pty`, `vt100`, `uuid`, `serde` (for `SplitDirection` serialization)
- `wmux-cli` depends on `wmux-core` and re-imports the types
- Tests that move: split_tree_test, shell_test

### Step 3: Move socket protocol and commands to core

- Move `socket/protocol.rs` to `wmux-core` (JSON-RPC types)
- Move `socket/commands.rs` to `wmux-core` (dispatch logic)
- `socket/server.rs` stays in `wmux-cli` (named pipe transport)
- Dependencies moved: `serde_json`
- `commands.rs` temporarily takes `&mut App` — will be refactored in Step 5 to take `&mut WmuxCore`
- Tests that move: protocol_test, commands_test

### Step 4: Create WmuxCore and split app.rs

This is the hardest step. Extract state management into `WmuxCore` in core.

- Create `wmux-core/src/core.rs` with the `WmuxCore` struct and public API
- Create `wmux-core/src/error.rs` with `WmuxError`
- Move state fields from `App` into `WmuxCore`: `workspaces`, `surfaces`, `active_workspace`, `focused_surface`, `zoom_surface`, `shell`, `pipe_path`, `should_quit`, `terminal_size`
- Move methods from `App` into `WmuxCore`: `create_workspace`, `split_surface`, `close_surface`, `tab_info`, `active_workspace_ref`, `resize_active_workspace`
- Refactor `commands.rs` to take `&mut WmuxCore` instead of `&mut App`
- What remains in CLI:
  - `DragState` struct (mouse input concern)
  - `event_loop.rs` — the `tokio::select!` loop, now calling `WmuxCore` methods
  - `input.rs` — maps crossterm events to core operations
  - `server.rs` — socket transport, calls `commands::dispatch(&mut core, ...)`

Post-extraction CLI event loop sketch:

```rust
loop {
    tokio::select! {
        Some(ev) = input_rx.recv() => {
            // Map crossterm event → call core methods
            // e.g., core.split_surface(...), core.focus_direction(...)
        }
        Some((id, data)) = pty_rx.recv() => {
            core.process_pty_output(id, data);
        }
        Some(id) = exit_rx.recv() => {
            if core.handle_pty_exit(id) { break; }
        }
        Some(req) = socket_rx.recv() => {
            let resp = commands::dispatch(&mut core, req.request, &pty_tx, &exit_tx);
            let _ = req.response_tx.send(resp);
        }
        _ = render_interval.tick() => {
            render_frame(&mut terminal, &core)?;
        }
    }
    if core.should_quit() { break; }
}
```

### Step 5: Verify

- All 90 existing tests pass (split_tree: 26, input: 36, commands: 22, protocol: 4, shell: 2)
- `cargo build` produces working `wmux.exe` from `wmux-cli`
- Manual testing: splits, tabs, zoom, socket API, mouse drag-resize all work identically
- No behavior changes — pure structural refactor

## Test Distribution

- **`wmux-core`**: split_tree_test (26), commands_test (22), protocol_test (4), shell_test (2) = **54 tests**
- **`wmux-cli`**: input_test (36) = **36 tests**
- Total: **90 tests** (all existing tests accounted for)

Tests in `wmux-core` import from `wmux_core::`. Tests in `wmux-cli` import from `wmux_core::` (for types) and test CLI-specific logic.

## Naming Conventions

To avoid collisions with existing types:

- `SplitDirection` — existing `Direction` enum in `split_tree.rs` (Horizontal/Vertical), renamed for clarity
- `FocusDirection` — new enum in core (Up/Down/Left/Right) for pane navigation
- `SplitNode` — existing type name preserved (no `SplitTree` wrapper)
- `SurfaceLayout` — existing type name preserved (no `PaneRect` rename)
- `SurfaceId` / `WorkspaceId` — type aliases for `Uuid`

## Constraints

- No behavior changes — this is a pure structural refactor
- Binary name stays `wmux.exe` (via `[[bin]] name = "wmux"` in CLI's Cargo.toml)
- CLI args unchanged (`--shell`, `--pipe`)
- All 90 existing tests pass after extraction
- Socket API remains cmux v2 compatible
- `which()` helper stays in `wmux-cli/src/main.rs` (CLI-specific)
