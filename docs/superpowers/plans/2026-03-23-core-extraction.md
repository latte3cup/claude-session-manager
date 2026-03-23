# wmux Core Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared logic from the single-crate wmux into a Cargo workspace with `wmux-core` (shared library) and `wmux-cli` (TUI frontend), so a future Tauri GUI can reuse the core.

**Architecture:** Convert to a Cargo workspace. Move models, terminal, and socket logic into `wmux-core`. Extract state management from `app.rs` into a `WmuxCore` struct in core. The CLI becomes a thin event loop + rendering layer calling core APIs. All 90 existing tests pass throughout.

**Tech Stack:** Rust, Cargo workspaces, tokio, portable-pty, vt100, ratatui, crossterm

**Spec:** `docs/superpowers/specs/2026-03-23-core-extraction-design.md`

---

### Task 1: Convert to Cargo workspace

**Files:**
- Create: `Cargo.toml` (workspace root — replaces current)
- Create: `crates/wmux-core/Cargo.toml`
- Create: `crates/wmux-core/src/lib.rs`
- Create: `crates/wmux-app/Cargo.toml`
- Create: `crates/wmux-app/src/lib.rs`
- Create: `crates/wmux-cli/Cargo.toml`
- Move: `src/*` → `crates/wmux-cli/src/`
- Move: `tests/*` → `crates/wmux-cli/tests/`

- [ ] **Step 1: Create workspace directory structure**

```bash
mkdir -p crates/wmux-core/src
mkdir -p crates/wmux-cli/src
mkdir -p crates/wmux-app/src
```

- [ ] **Step 2: Move source and test files to wmux-cli**

```bash
# Move all source files
cp -r src/* crates/wmux-cli/src/
cp -r tests crates/wmux-cli/

# Remove originals (after verifying copy)
rm -rf src tests
```

- [ ] **Step 3: Create workspace root Cargo.toml**

Replace the current `Cargo.toml` with:

```toml
[workspace]
members = ["crates/*"]
resolver = "2"
```

- [ ] **Step 4: Create wmux-cli Cargo.toml**

Create `crates/wmux-cli/Cargo.toml`:

```toml
[package]
name = "wmux-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "wmux"
path = "src/main.rs"

[lib]
name = "wmux"
path = "src/lib.rs"

[dependencies]
ratatui = { version = "0.29", features = ["crossterm"] }
crossterm = "0.28"
tokio = { version = "1", features = ["full", "net"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
portable-pty = "0.8"
vt100 = "0.15"
clap = { version = "4", features = ["derive"] }
```

Note: `[lib] name = "wmux"` preserves the `wmux::` import prefix used by tests. `[[bin]] name = "wmux"` preserves the binary name.

- [ ] **Step 5: Create wmux-core skeleton**

Create `crates/wmux-core/Cargo.toml`:

```toml
[package]
name = "wmux-core"
version = "0.1.0"
edition = "2021"

[dependencies]
```

Create `crates/wmux-core/src/lib.rs`:

```rust
// wmux-core: shared library for wmux frontends
```

- [ ] **Step 6: Create wmux-app skeleton**

Create `crates/wmux-app/Cargo.toml`:

```toml
[package]
name = "wmux-app"
version = "0.1.0"
edition = "2021"

[dependencies]
wmux-core = { path = "../wmux-core" }
```

Create `crates/wmux-app/src/lib.rs`:

```rust
// wmux-app: Tauri GUI frontend (placeholder)
```

- [ ] **Step 7: Verify build and tests**

Run:
```bash
cargo build
cargo test
```

Expected: all 90 tests pass, `wmux.exe` binary is produced.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: convert to Cargo workspace with wmux-cli, wmux-core, wmux-app"
```

---

### Task 2: Move models and terminal layer to wmux-core

**Files:**
- Move: `crates/wmux-cli/src/model/split_tree.rs` → `crates/wmux-core/src/model/split_tree.rs`
- Move: `crates/wmux-cli/src/model/workspace.rs` → `crates/wmux-core/src/model/workspace.rs`
- Move: `crates/wmux-cli/src/model/surface.rs` → `crates/wmux-core/src/model/surface.rs`
- Move: `crates/wmux-cli/src/terminal/pty.rs` → `crates/wmux-core/src/terminal/pty.rs`
- Move: `crates/wmux-cli/src/terminal/shell.rs` → `crates/wmux-core/src/terminal/shell.rs`
- Create: `crates/wmux-core/src/model/mod.rs`
- Create: `crates/wmux-core/src/terminal/mod.rs`
- Modify: `crates/wmux-core/Cargo.toml` (add dependencies)
- Modify: `crates/wmux-core/src/lib.rs` (add modules)
- Modify: `crates/wmux-cli/Cargo.toml` (add wmux-core dependency, remove moved deps)
- Modify: `crates/wmux-cli/src/lib.rs` (re-export from core)
- Move: `crates/wmux-cli/tests/split_tree_test.rs` → `crates/wmux-core/tests/split_tree_test.rs`
- Move: `crates/wmux-cli/tests/shell_test.rs` → `crates/wmux-core/tests/shell_test.rs`

- [ ] **Step 1: Create core module structure**

```bash
mkdir -p crates/wmux-core/src/model
mkdir -p crates/wmux-core/src/terminal
mkdir -p crates/wmux-core/tests
```

- [ ] **Step 2: Move files**

```bash
# Models
cp crates/wmux-cli/src/model/split_tree.rs crates/wmux-core/src/model/split_tree.rs
cp crates/wmux-cli/src/model/workspace.rs crates/wmux-core/src/model/workspace.rs
cp crates/wmux-cli/src/model/surface.rs crates/wmux-core/src/model/surface.rs

# Terminal
cp crates/wmux-cli/src/terminal/pty.rs crates/wmux-core/src/terminal/pty.rs
cp crates/wmux-cli/src/terminal/shell.rs crates/wmux-core/src/terminal/shell.rs

# Tests
cp crates/wmux-cli/tests/split_tree_test.rs crates/wmux-core/tests/split_tree_test.rs
cp crates/wmux-cli/tests/shell_test.rs crates/wmux-core/tests/shell_test.rs

# Remove originals
rm crates/wmux-cli/src/model/split_tree.rs
rm crates/wmux-cli/src/model/workspace.rs
rm crates/wmux-cli/src/model/surface.rs
rm crates/wmux-cli/src/terminal/pty.rs
rm crates/wmux-cli/src/terminal/shell.rs
rm crates/wmux-cli/tests/split_tree_test.rs
rm crates/wmux-cli/tests/shell_test.rs
```

- [ ] **Step 3: Update wmux-core Cargo.toml**

```toml
[package]
name = "wmux-core"
version = "0.1.0"
edition = "2021"

[dependencies]
uuid = { version = "1", features = ["v4", "serde"] }
serde = { version = "1", features = ["derive"] }
portable-pty = "0.8"
vt100 = "0.15"
tokio = { version = "1", features = ["full"] }
```

- [ ] **Step 4: Create core module files**

Create `crates/wmux-core/src/model/mod.rs`:
```rust
pub mod split_tree;
pub mod workspace;
pub mod surface;
```

Create `crates/wmux-core/src/terminal/mod.rs`:
```rust
pub mod pty;
pub mod shell;
```

Update `crates/wmux-core/src/lib.rs`:
```rust
pub mod model;
pub mod terminal;

// Re-export key types for frontend convenience
pub use vt100;
```

- [ ] **Step 5: Fix crate references in moved files**

In `crates/wmux-core/src/model/surface.rs`, change:
```rust
// OLD:
use crate::terminal::pty::PtyHandle;
// This stays the same since surface.rs is now in wmux-core and pty.rs is also in wmux-core
```

In `crates/wmux-core/src/model/workspace.rs`, change:
```rust
// OLD:
use crate::model::split_tree::SplitNode;
// This stays the same — both are in wmux-core now
```

No changes needed — `crate::` references resolve within `wmux-core` since both models and terminal are now in the same crate.

- [ ] **Step 6: Update wmux-cli to depend on wmux-core**

Add to `crates/wmux-cli/Cargo.toml` dependencies:
```toml
wmux-core = { path = "../wmux-core" }
```

- [ ] **Step 7: Update wmux-cli module files to re-export from core**

Replace `crates/wmux-cli/src/model/mod.rs` with:
```rust
pub use wmux_core::model::split_tree;
pub use wmux_core::model::workspace;
pub use wmux_core::model::surface;
```

Replace `crates/wmux-cli/src/terminal/mod.rs` with:
```rust
pub use wmux_core::terminal::pty;
pub use wmux_core::terminal::shell;
```

This preserves the `crate::model::*` and `crate::terminal::*` import paths used throughout `app.rs`, `commands.rs`, `input.rs`, and rendering code — no other files need changes.

- [ ] **Step 8: Update moved test imports**

In `crates/wmux-core/tests/split_tree_test.rs`, change:
```rust
// OLD:
use wmux::model::split_tree::{SplitNode, Direction};
// NEW:
use wmux_core::model::split_tree::{SplitNode, Direction};
```

In `crates/wmux-core/tests/shell_test.rs`, change:
```rust
// OLD:
use wmux::terminal::shell::detect_shell;
// NEW:
use wmux_core::terminal::shell::detect_shell;
```

- [ ] **Step 9: Verify build and tests**

```bash
cargo build
cargo test
```

Expected: all 90 tests pass. 28 tests run in `wmux-core` (26 split_tree + 2 shell), 62 tests run in `wmux-cli`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move models and terminal layer to wmux-core"
```

---

### Task 3: Move socket protocol to wmux-core

**Files:**
- Move: `crates/wmux-cli/src/socket/protocol.rs` → `crates/wmux-core/src/socket/protocol.rs`
- Create: `crates/wmux-core/src/socket/mod.rs`
- Modify: `crates/wmux-core/Cargo.toml` (add serde_json)
- Modify: `crates/wmux-core/src/lib.rs` (add socket module)
- Modify: `crates/wmux-cli/src/socket/mod.rs` (re-export protocol from core, keep server + commands)
- Move: `crates/wmux-cli/tests/protocol_test.rs` → `crates/wmux-core/tests/protocol_test.rs`

Note: `commands.rs` depends on `App` which stays in CLI for now. We only move `protocol.rs` in this step. `commands.rs` moves in Task 4 after `WmuxCore` is created.

- [ ] **Step 1: Create socket module in core**

```bash
mkdir -p crates/wmux-core/src/socket
```

- [ ] **Step 2: Move protocol.rs and its test**

```bash
cp crates/wmux-cli/src/socket/protocol.rs crates/wmux-core/src/socket/protocol.rs
cp crates/wmux-cli/tests/protocol_test.rs crates/wmux-core/tests/protocol_test.rs
rm crates/wmux-cli/src/socket/protocol.rs
rm crates/wmux-cli/tests/protocol_test.rs
```

- [ ] **Step 3: Update wmux-core**

Add `serde_json` to `crates/wmux-core/Cargo.toml` dependencies:
```toml
serde_json = "1"
```

Create `crates/wmux-core/src/socket/mod.rs`:
```rust
pub mod protocol;
```

Update `crates/wmux-core/src/lib.rs`:
```rust
pub mod model;
pub mod terminal;
pub mod socket;

pub use vt100;
```

- [ ] **Step 4: Update wmux-cli socket module to re-export protocol**

Update `crates/wmux-cli/src/socket/mod.rs` to:
```rust
pub use wmux_core::socket::protocol;
pub mod server;
pub mod commands;
```

- [ ] **Step 5: Update moved test imports**

In `crates/wmux-core/tests/protocol_test.rs`, change:
```rust
// OLD:
use wmux::socket::protocol::{Request, Response};
// NEW:
use wmux_core::socket::protocol::{Request, Response};
```

- [ ] **Step 6: Verify build and tests**

```bash
cargo build
cargo test
```

Expected: all 90 tests pass. 32 tests in `wmux-core` (26 split_tree + 2 shell + 4 protocol), 58 tests in `wmux-cli`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move socket protocol to wmux-core"
```

---

### Task 4: Create WmuxCore struct and split app.rs

This is the hardest task. Extract state management from `App` into `WmuxCore` in core, refactor `commands.rs` to use `WmuxCore`, move it to core, and restructure the CLI.

**Files:**
- Create: `crates/wmux-core/src/core.rs`
- Create: `crates/wmux-core/src/error.rs`
- Move: `crates/wmux-cli/src/socket/commands.rs` → `crates/wmux-core/src/socket/commands.rs`
- Modify: `crates/wmux-core/src/lib.rs`
- Modify: `crates/wmux-core/src/socket/mod.rs`
- Rewrite: `crates/wmux-cli/src/app.rs` → `crates/wmux-cli/src/event_loop.rs`
- Modify: `crates/wmux-cli/src/lib.rs`
- Modify: `crates/wmux-cli/src/main.rs`
- Modify: `crates/wmux-cli/src/socket/mod.rs`
- Move: `crates/wmux-cli/tests/commands_test.rs` → `crates/wmux-core/tests/commands_test.rs`

- [ ] **Step 1: Create error type**

Create `crates/wmux-core/src/error.rs`:

```rust
use std::fmt;
use uuid::Uuid;

#[derive(Debug)]
pub enum WmuxError {
    PtySpawn(String),
    ShellNotFound(String),
    Io(std::io::Error),
    SurfaceNotFound(Uuid),
}

impl fmt::Display for WmuxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WmuxError::PtySpawn(msg) => write!(f, "Failed to spawn PTY: {}", msg),
            WmuxError::ShellNotFound(shell) => write!(f, "Shell not found: {}", shell),
            WmuxError::Io(e) => write!(f, "IO error: {}", e),
            WmuxError::SurfaceNotFound(id) => write!(f, "Surface not found: {}", id),
        }
    }
}

impl std::error::Error for WmuxError {}

impl From<std::io::Error> for WmuxError {
    fn from(e: std::io::Error) -> Self {
        WmuxError::Io(e)
    }
}

impl From<Box<dyn std::error::Error>> for WmuxError {
    fn from(e: Box<dyn std::error::Error>) -> Self {
        WmuxError::PtySpawn(e.to_string())
    }
}
```

- [ ] **Step 2: Create WmuxCore struct**

Create `crates/wmux-core/src/core.rs`:

```rust
use std::collections::HashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::error::WmuxError;
use crate::model::split_tree::{Direction, SplitNode, SurfaceLayout};
use crate::model::surface::Surface;
use crate::model::workspace::Workspace;
use crate::terminal::pty::{spawn_pty, start_pty_reader};

pub type SurfaceId = Uuid;
pub type WorkspaceId = Uuid;

/// Focus navigation direction — distinct from split_tree::Direction (Horizontal/Vertical)
pub enum FocusDirection {
    Up,
    Down,
    Left,
    Right,
}

pub struct WmuxCore {
    pub workspaces: Vec<Workspace>,
    pub surfaces: HashMap<SurfaceId, Surface>,
    pub active_workspace: usize,
    pub focused_surface: Option<SurfaceId>,
    pub zoom_surface: Option<SurfaceId>,
    pub shell: String,
    pub pipe_path: String,
    pub should_quit: bool,
    pub terminal_size: (u16, u16),
}

impl WmuxCore {
    pub fn new(shell: String, pipe_path: String) -> Self {
        Self {
            workspaces: Vec::new(),
            surfaces: HashMap::new(),
            active_workspace: 0,
            focused_surface: None,
            zoom_surface: None,
            shell,
            pipe_path,
            should_quit: false,
            terminal_size: (80, 24),
        }
    }

    pub fn create_workspace(
        &mut self,
        name: Option<String>,
        pty_tx: &mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
        exit_tx: &mpsc::UnboundedSender<Uuid>,
        cols: u16,
        rows: u16,
    ) -> Result<WorkspaceId, WmuxError> {
        let surface_id = Uuid::new_v4();
        let pty = spawn_pty(&self.shell, cols, rows, None)?;
        start_pty_reader(surface_id, pty.master.as_ref(), pty_tx.clone(), exit_tx.clone())?;

        let surface = Surface::new(surface_id, self.shell.clone(), cols, rows, pty);
        self.surfaces.insert(surface_id, surface);

        let ws_name = name.unwrap_or_else(|| format!("workspace {}", self.workspaces.len() + 1));
        let workspace = Workspace::new(ws_name, surface_id);
        let ws_id = workspace.id;
        self.workspaces.push(workspace);
        self.active_workspace = self.workspaces.len() - 1;
        self.focused_surface = Some(surface_id);

        Ok(ws_id)
    }

    pub fn split_surface(
        &mut self,
        direction: Direction,
        pty_tx: &mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
        exit_tx: &mpsc::UnboundedSender<Uuid>,
        cols: u16,
        rows: u16,
    ) -> Result<Option<SurfaceId>, WmuxError> {
        let focused = match self.focused_surface {
            Some(id) => id,
            None => return Ok(None),
        };

        let new_id = Uuid::new_v4();
        let pty = spawn_pty(&self.shell, cols, rows, None)?;
        start_pty_reader(new_id, pty.master.as_ref(), pty_tx.clone(), exit_tx.clone())?;

        let surface = Surface::new(new_id, self.shell.clone(), cols, rows, pty);
        self.surfaces.insert(new_id, surface);

        if let Some(ws) = self.workspaces.get_mut(self.active_workspace) {
            ws.split_tree.split_at(focused, new_id, direction);
        }

        self.focused_surface = Some(new_id);
        Ok(Some(new_id))
    }

    pub fn close_surface(&mut self, surface_id: Uuid) -> bool {
        self.surfaces.remove(&surface_id);

        if let Some(ws) = self.workspaces.get_mut(self.active_workspace) {
            if ws.split_tree.surface_ids().len() == 1
                && ws.split_tree.surface_ids()[0] == surface_id
            {
                self.workspaces.remove(self.active_workspace);
                if self.workspaces.is_empty() {
                    return true;
                }
                self.active_workspace = self.active_workspace.min(self.workspaces.len() - 1);
                self.focused_surface = Some(
                    self.workspaces[self.active_workspace].split_tree.first_surface(),
                );
            } else {
                ws.split_tree.remove(surface_id);
                self.focused_surface = Some(ws.split_tree.first_surface());
            }
        }

        false
    }

    pub fn tab_info(&self) -> Vec<(String, bool)> {
        self.workspaces
            .iter()
            .enumerate()
            .map(|(i, ws)| (ws.name.clone(), i == self.active_workspace))
            .collect()
    }

    pub fn active_workspace_ref(&self) -> Option<&Workspace> {
        self.workspaces.get(self.active_workspace)
    }

    pub fn resize_active_workspace(&mut self) {
        let (w, h) = self.terminal_size;
        if let Some(ws) = self.workspaces.get(self.active_workspace) {
            let layouts = ws.split_tree.layout(0, 0, w, h);
            for layout in &layouts {
                if let Some(surface) = self.surfaces.get_mut(&layout.surface_id) {
                    surface.resize(layout.width.saturating_sub(2), layout.height.saturating_sub(2));
                }
            }
        }
    }

    pub fn process_pty_output(&mut self, surface_id: Uuid, data: &[u8]) {
        if let Some(surface) = self.surfaces.get_mut(&surface_id) {
            surface.process_output(data);
        }
    }

    pub fn handle_pty_exit(&mut self, surface_id: Uuid) {
        if let Some(surface) = self.surfaces.get_mut(&surface_id) {
            let code = surface.pty.as_mut()
                .and_then(|pty| pty.child.try_wait().ok().flatten())
                .map(|status| status.exit_code() as i32)
                .unwrap_or(0);
            surface.mark_exited(code);
        }
    }

    // --- Encapsulated API methods (so frontends don't reimplement logic) ---

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn request_quit(&mut self) {
        self.should_quit = true;
    }

    pub fn set_terminal_size(&mut self, w: u16, h: u16) {
        self.terminal_size = (w, h);
    }

    pub fn next_workspace(&mut self) {
        if !self.workspaces.is_empty() {
            self.active_workspace = (self.active_workspace + 1) % self.workspaces.len();
            self.focused_surface = Some(
                self.workspaces[self.active_workspace].split_tree.first_surface(),
            );
            self.resize_active_workspace();
        }
    }

    pub fn prev_workspace(&mut self) {
        if !self.workspaces.is_empty() {
            self.active_workspace = if self.active_workspace == 0 {
                self.workspaces.len() - 1
            } else {
                self.active_workspace - 1
            };
            self.focused_surface = Some(
                self.workspaces[self.active_workspace].split_tree.first_surface(),
            );
            self.resize_active_workspace();
        }
    }

    pub fn switch_workspace(&mut self, index: usize) {
        if index < self.workspaces.len() {
            self.active_workspace = index;
            self.focused_surface = Some(
                self.workspaces[self.active_workspace].split_tree.first_surface(),
            );
            self.resize_active_workspace();
        }
    }

    pub fn focus_direction(&mut self, dir: FocusDirection) {
        if let (Some(focused), Some(ws)) = (self.focused_surface, self.active_workspace_ref()) {
            let ids = ws.split_tree.surface_ids();
            if let Some(pos) = ids.iter().position(|id| *id == focused) {
                match dir {
                    FocusDirection::Right | FocusDirection::Down => {
                        if pos + 1 < ids.len() {
                            self.focused_surface = Some(ids[pos + 1]);
                        }
                    }
                    FocusDirection::Left | FocusDirection::Up => {
                        if pos > 0 {
                            self.focused_surface = Some(ids[pos - 1]);
                        }
                    }
                }
            }
        }
    }

    pub fn toggle_zoom(&mut self) {
        if self.zoom_surface.is_some() {
            self.zoom_surface = None;
        } else {
            self.zoom_surface = self.focused_surface;
        }
    }

    pub fn set_ratio_at(&mut self, path: &[bool], ratio: f64) {
        if let Some(ws) = self.workspaces.get_mut(self.active_workspace) {
            ws.split_tree.set_ratio_at(path, ratio);
        }
    }
}
```

- [ ] **Step 3: Update wmux-core lib.rs**

```rust
pub mod model;
pub mod terminal;
pub mod socket;
pub mod core;
pub mod error;

pub use vt100;

// Re-export key types
pub use crate::core::{WmuxCore, SurfaceId, WorkspaceId, FocusDirection};
pub use crate::error::WmuxError;
```

- [ ] **Step 4: Move and refactor commands.rs**

Copy `crates/wmux-cli/src/socket/commands.rs` to `crates/wmux-core/src/socket/commands.rs`.

Refactor it to use `WmuxCore` instead of `App`. Replace:

```rust
// OLD:
use crate::app::App;
use crate::model::split_tree::Direction;
use crate::socket::protocol::{Request, Response};

pub fn dispatch(
    app: &mut App,
    req: &Request,
    pty_tx: &mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    exit_tx: &mpsc::UnboundedSender<Uuid>,
) -> Response {
```

With:

```rust
// NEW:
use crate::core::WmuxCore;
use crate::model::split_tree::Direction;
use crate::socket::protocol::{Request, Response};

pub fn dispatch(
    core: &mut WmuxCore,
    req: &Request,
    pty_tx: &mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    exit_tx: &mpsc::UnboundedSender<Uuid>,
) -> Response {
```

Then replace every `app.` with `core.` throughout the function body. The method signatures are identical between `App` and `WmuxCore`, so this is a mechanical find-and-replace.

Remove the old file:
```bash
rm crates/wmux-cli/src/socket/commands.rs
```

Update `crates/wmux-core/src/socket/mod.rs`:
```rust
pub mod protocol;
pub mod commands;
```

Update `crates/wmux-cli/src/socket/mod.rs`:
```rust
pub use wmux_core::socket::protocol;
pub use wmux_core::socket::commands;
pub mod server;
```

- [ ] **Step 5: Move and update commands_test.rs**

Copy `crates/wmux-cli/tests/commands_test.rs` to `crates/wmux-core/tests/commands_test.rs`.

The test needs significant refactoring because it currently creates an `App` and calls `dispatch(&mut app, ...)`. It needs to create a `WmuxCore` instead.

Replace imports:
```rust
// OLD:
use wmux::app::App;
use wmux::socket::commands::dispatch;
use wmux::socket::protocol::Request;

// NEW:
use wmux_core::WmuxCore;
use wmux_core::socket::commands::dispatch;
use wmux_core::socket::protocol::Request;
```

Replace the test helper that creates an App. The current test likely has a helper like:
```rust
// OLD:
fn make_app() -> App {
    App::new("cmd.exe".into(), r"\\.\pipe\wmux-test".into())
}

// NEW:
fn make_core() -> WmuxCore {
    WmuxCore::new("cmd.exe".into(), r"\\.\pipe\wmux-test".into())
}
```

Replace all `app` variables with `core` in every test function that uses them.

Remove old test:
```bash
rm crates/wmux-cli/tests/commands_test.rs
```

- [ ] **Step 6: Rewrite app.rs as event_loop.rs**

Rename `crates/wmux-cli/src/app.rs` to `crates/wmux-cli/src/event_loop.rs`.

Remove the `App` struct, `DragState` struct, and all `impl App` methods (they're now in `WmuxCore`). Remove the `SocketRequest` struct.

Keep and refactor:
- `DragState` struct (stays in CLI — mouse input concern)
- `SocketRequest` struct (stays in CLI — transport concern)
- `cleanup_terminal()` function
- `run()` function — refactored to use `WmuxCore`
- `handle_action()` function — refactored to use `WmuxCore`

The `run()` function changes from creating an `App` to creating a `WmuxCore`:

```rust
use wmux_core::{WmuxCore, WmuxError};
use wmux_core::model::split_tree::Direction;
use wmux_core::terminal::shell::detect_shell;
// ... other imports stay

pub struct DragState {
    pub border_path: Vec<bool>,
    pub direction: Direction,
    pub region_x: u16,
    pub region_y: u16,
    pub region_w: u16,
    pub region_h: u16,
}

pub struct SocketRequest {
    pub request: wmux_core::socket::protocol::Request,
    pub response_tx: tokio::sync::oneshot::Sender<wmux_core::socket::protocol::Response>,
}

pub async fn run(
    cli_shell: Option<String>,
    pipe_path: String,
    socket_rx: mpsc::UnboundedReceiver<SocketRequest>,
    _socket_cmd_tx: mpsc::UnboundedSender<SocketRequest>,
) -> Result<(), Box<dyn std::error::Error>> {
    // ... terminal setup same as before ...

    let shell = detect_shell(cli_shell);
    let mut core = WmuxCore::new(shell, pipe_path);
    let mut input_handler = InputHandler::new();

    let (pty_tx, mut pty_rx) = mpsc::unbounded_channel::<(Uuid, Vec<u8>)>();
    let (exit_tx, mut exit_rx) = mpsc::unbounded_channel::<Uuid>();

    let size = terminal.size()?;
    let content_height = size.height.saturating_sub(2);
    core.set_terminal_size(size.width, content_height);
    if let Err(e) = core.create_workspace(None, &pty_tx, &exit_tx, size.width, content_height) {
        cleanup_terminal();
        return Err(format!("Failed to start shell: {}. Use --shell to specify a different shell.", e).into());
    }

    // ... input thread same as before ...

    loop {
        tokio::select! {
            Some(ev) = input_rx.recv() => {
                // Same as before but use `core` instead of `app`
                match ev {
                    Event::Key(key) if key.kind == KeyEventKind::Press => {
                        let action = input_handler.handle_key(key);
                        handle_action(&mut core, action, &pty_tx, &exit_tx, &terminal)?;
                        if core.should_quit() { break; }
                    }
                    Event::Resize(w, h) => {
                        let content_h = h.saturating_sub(2);
                        core.set_terminal_size(w, content_h);
                        core.resize_active_workspace();
                    }
                    Event::Mouse(mouse) => {
                        // Same mouse handling, using `core` instead of `app`
                        // DragState stays local to this module
                    }
                    _ => {}
                }
            }

            Some((surface_id, data)) = pty_rx.recv() => {
                core.process_pty_output(surface_id, &data);
            }

            Some(surface_id) = exit_rx.recv() => {
                core.handle_pty_exit(surface_id);
            }

            Some(req) = socket_rx.recv() => {
                let response = wmux_core::socket::commands::dispatch(
                    &mut core, &req.request, &pty_tx, &exit_tx
                );
                let _ = req.response_tx.send(response);
            }

            _ = render_interval.tick() => {
                // Same rendering, using `core.surfaces`, `core.tab_info()`, etc.
            }
        }
    }

    cleanup_terminal();
    Ok(())
}
```

The `handle_action()` function uses `WmuxCore`'s encapsulated methods instead of direct field access:

```rust
fn handle_action(
    core: &mut WmuxCore,
    action: Action,
    pty_tx: &mpsc::UnboundedSender<(Uuid, Vec<u8>)>,
    exit_tx: &mpsc::UnboundedSender<Uuid>,
    terminal: &Terminal<CrosstermBackend<io::Stdout>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let size = terminal.size()?;
    let content_h = size.height.saturating_sub(2);

    match action {
        Action::ForwardToSurface(key) => {
            if let Some(id) = core.focused_surface {
                if let Some(surface) = core.surfaces.get_mut(&id) {
                    if let Some(bytes) = key_event_to_bytes(&key) {
                        let _ = surface.send_bytes(&bytes);
                    }
                }
            }
        }
        Action::NewWorkspace => {
            core.create_workspace(None, pty_tx, exit_tx, size.width, content_h)?;
        }
        Action::NextWorkspace => core.next_workspace(),
        Action::PrevWorkspace => core.prev_workspace(),
        Action::SelectWorkspace(idx) => core.switch_workspace(idx),
        Action::SplitVertical => {
            core.split_surface(Direction::Vertical, pty_tx, exit_tx, size.width / 2, content_h)?;
        }
        Action::SplitHorizontal => {
            core.split_surface(Direction::Horizontal, pty_tx, exit_tx, size.width, content_h / 2)?;
        }
        Action::FocusRight => core.focus_direction(FocusDirection::Right),
        Action::FocusDown => core.focus_direction(FocusDirection::Down),
        Action::FocusLeft => core.focus_direction(FocusDirection::Left),
        Action::FocusUp => core.focus_direction(FocusDirection::Up),
        Action::CloseSurface => {
            if let Some(id) = core.focused_surface {
                if core.close_surface(id) {
                    core.request_quit();
                }
            }
        }
        Action::ToggleZoom => core.toggle_zoom(),
        Action::Quit => core.request_quit(),
        Action::None => {}
    }
    Ok(())
}
```

The full mouse handling block is a mechanical `app` → `core` rename. `DragState` is created/used locally with `drag_state` as a local variable in `run()` instead of a field on `App`.

Note: `drag_state` needs to become a local variable in `run()` since it's no longer on the `App` struct:
```rust
let mut drag_state: Option<DragState> = None;
```

All references to `app.drag_state` become `drag_state`.

- [ ] **Step 7: Update BOTH wmux-cli lib.rs AND main.rs module declarations**

The current crate has parallel `mod` declarations in both files. Both must be updated.

Update `crates/wmux-cli/src/lib.rs`:
```rust
pub mod event_loop;
pub mod input;
pub mod model;
pub mod socket;
pub mod terminal;
pub mod tui;
```

(Changed `pub mod app;` to `pub mod event_loop;`)

- [ ] **Step 8: Update wmux-cli main.rs**

In `crates/wmux-cli/src/main.rs`, change:
```rust
// OLD:
if let Err(e) = app::run(args.shell, args.pipe, socket_rx, socket_tx).await {
// NEW:
if let Err(e) = event_loop::run(args.shell, args.pipe, socket_rx, socket_tx).await {
```

And update the module import:
```rust
// OLD:
mod app;
// NEW:
mod event_loop;
```

Also update the `SocketRequest` import:
```rust
// OLD:
use crate::app::SocketRequest;
// (in main.rs the channel type)
let (socket_tx, socket_rx) = mpsc::unbounded_channel::<app::SocketRequest>();
// NEW:
let (socket_tx, socket_rx) = mpsc::unbounded_channel::<event_loop::SocketRequest>();
```

And in `server.rs`:
```rust
// OLD:
use crate::app::SocketRequest;
// NEW:
use crate::event_loop::SocketRequest;
```

- [ ] **Step 9: Update render.rs imports**

In `crates/wmux-cli/src/tui/render.rs`, the `RenderContext` struct uses types from core. Update imports:
```rust
// These should now resolve through the re-exports in wmux-cli's model module
// No changes needed if re-exports are set up correctly from Step 7 of Task 2
```

Verify that `crate::model::split_tree::SurfaceLayout` and `crate::model::surface::Surface` resolve through the re-exports.

- [ ] **Step 10: Verify build and tests**

```bash
cargo build
cargo test
```

Expected: all 90 tests pass. `wmux-core` runs 54 tests (26 split_tree + 22 commands + 4 protocol + 2 shell). `wmux-cli` runs 36 tests (input).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: extract WmuxCore struct, move commands to core, rewrite app.rs as event_loop"
```

---

### Task 5: Final verification and cleanup

**Files:**
- Modify: various (cleanup only)

- [ ] **Step 1: Run full test suite**

```bash
cargo test -- --nocapture 2>&1
```

Verify all 90 tests pass with no warnings.

- [ ] **Step 2: Build release binary**

```bash
cargo build --release
```

Verify the binary is produced at `target/release/wmux.exe`.

- [ ] **Step 3: Verify binary runs**

```bash
./target/release/wmux.exe --help
```

Should show the same help output as before (shell, pipe flags, keybinding reference).

- [ ] **Step 4: Remove any dead code or unused dependencies**

Check each crate's `Cargo.toml` for dependencies that are no longer needed:
- `wmux-cli` should no longer directly depend on `portable-pty` or `vt100` (they come through `wmux-core`)
- `wmux-cli` may still need `uuid` for the channel types in event_loop

Remove unnecessary re-exports in `wmux-cli/src/model/mod.rs` and `wmux-cli/src/terminal/mod.rs` if nothing in CLI directly references `crate::model::*` anymore (check if `app.rs` → `event_loop.rs` now uses `wmux_core::` directly).

- [ ] **Step 5: Remove empty model/terminal directories from CLI if fully re-exported**

If `crates/wmux-cli/src/model/` and `crates/wmux-cli/src/terminal/` only contain `mod.rs` with re-exports, and no CLI code uses `crate::model::*` or `crate::terminal::*` paths anymore, remove these directories and the module declarations from `lib.rs`. Update any remaining CLI code to import from `wmux_core::` directly.

This is optional and depends on whether the re-exports are still needed. If `event_loop.rs` and `render.rs` import from `wmux_core::` directly, the re-export modules are dead code.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "refactor: cleanup unused dependencies and re-exports after core extraction"
```
