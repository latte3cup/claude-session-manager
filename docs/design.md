# wmux — Windows Terminal Multiplexer MVP

## Overview

wmux is a minimal terminal multiplexer for Windows, inspired by cmux. It runs as a single Rust binary with a TUI interface (like tmux), supports split panes and tabbed workspaces, and exposes a JSON-RPC socket API so AI coding agents can orchestrate terminal sessions programmatically.

## Goals

- Provide a tabbed, split-pane terminal experience on Windows
- Expose a socket API compatible with cmux's v2 JSON-RPC format (subset)
- Ship as a single `.exe` with zero runtime dependencies
- Support any Windows shell (PowerShell, cmd, WSL bash) with auto-detection

## Non-Goals (MVP)

- No browser panel
- No session persistence / detach-reattach (no daemon)
- No notification system
- No remote/SSH support
- No GUI window — TUI only

## Architecture

Single-process monolith running on Tokio async runtime.

```
wmux.exe
├── TUI Layer (ratatui + crossterm)
│   ├── Tab bar (workspace list)
│   ├── Split pane renderer (binary tree layout)
│   └── Status bar (context info)
├── Socket Server (Tokio, Windows named pipe)
│   ├── \\.\pipe\wmux (default)
│   ├── Newline-delimited cmux-compatible JSON-RPC
│   └── Command dispatcher
├── Shell Manager (Windows ConPTY via portable-pty)
│   ├── Shell detection (COMSPEC / fallback)
│   ├── PTY spawn per surface
│   └── Async read/write/resize
├── Terminal Emulation (alacritty_terminal)
│   ├── VT/ANSI escape sequence parsing
│   ├── Cell grid per surface (scrollback + visible)
│   └── Grid → ratatui widget rendering
└── App State (shared, Arc<Mutex>)
    ├── Workspaces[]
    ├── Split trees (binary tree, leaves = surfaces)
    ├── Surfaces[] (stable UUIDs)
    └── Focus tracking
```

### Event Loop

The main loop uses `tokio::select!` to multiplex three event sources:

```
loop {
    tokio::select! {
        // 1. Keyboard/mouse input from crossterm
        event = input_rx.recv() => {
            // If prefix mode: dispatch to keybinding handler
            // Else: forward raw input to focused surface's PTY
        }

        // 2. PTY output from any surface
        (surface_id, data) = pty_rx.recv() => {
            // Feed bytes into that surface's alacritty_terminal::Term
            // Mark surface dirty for next render
        }

        // 3. Socket command from named pipe
        request = socket_rx.recv() => {
            // Parse JSON-RPC, dispatch command, send response
        }

        // 4. Render tick (30fps)
        _ = render_interval.tick() => {
            // Re-render only dirty surfaces to ratatui frame
        }
    }
}
```

- Crossterm input runs on a dedicated OS thread (crossterm is blocking), sends events via `tokio::sync::mpsc` channel.
- Each surface's PTY read loop runs as a Tokio task, forwarding output bytes via a shared channel.
- Socket server accepts connections as Tokio tasks, sends parsed commands via channel.
- Rendering happens on the main thread at 30fps, only redrawing dirty surfaces.

### Terminal Emulation

Each surface owns an `alacritty_terminal::Term` instance. This handles:
- Parsing VT100/ANSI/xterm escape sequences from PTY output
- Maintaining a cell grid (character + style per cell)
- Scrollback buffer (1000 lines default)
- Cursor position and state

The rendering path: PTY bytes → `alacritty_terminal::Term` → extract visible cell grid → convert to ratatui `Cell` widgets → draw to frame.

### Resize Propagation

When the terminal window resizes or a split is created/destroyed:
1. Crossterm delivers a `Resize(cols, rows)` event
2. The split tree recalculates each leaf's (cols, rows) based on ratios
3. Each surface whose size changed calls `portable_pty::MasterPty::resize()`
4. Each surface's `alacritty_terminal::Term` is resized to match
5. The shell/program in the PTY receives the new size and reflows

## Data Model

### Workspace
- `id`: UUID (stable handle)
- `name`: String (user-settable, defaults to shell CWD)
- `split_tree`: Binary tree of splits
- `created_at`: Timestamp

### SplitNode (binary tree)
- Variant A — `Leaf { surface_id: UUID }`
- Variant B — `Split { direction: Horizontal|Vertical, ratio: f64, left: Box<SplitNode>, right: Box<SplitNode> }`

### Surface
- `id`: UUID (stable handle)
- `pty`: `portable_pty::MasterPty` handle (read/write streams)
- `term`: `alacritty_terminal::Term` (VT parser + cell grid + scrollback)
- `shell`: String (path to shell executable)
- `size`: (cols, rows)
- `dirty`: bool (needs re-render)
- `exited`: Option<ExitStatus> (None while running, Some after shell exits)

## TUI Layout

```
┌──────────────────────────────────────────────────┐
│ [1: ~\project] [2: ~\api] [3: ~\tests]    wmux  │  Tab bar
├────────────────────────┬─────────────────────────┤
│                        │                         │
│  PS C:\project> _      │  PS C:\project\api> _   │
│                        │                         │
│   Surface 1 (focused)  │   Surface 2             │  Split panes
│                        │                         │
├────────────────────────┴─────────────────────────┤
│ ws:1 surface:1 │ powershell │ \\.\pipe\wmux      │  Status bar
└──────────────────────────────────────────────────┘
```

## Keybindings

Prefix key: `Ctrl+A` (configurable later).

| Key | Action |
|-----|--------|
| `Ctrl+A, c` | New workspace |
| `Ctrl+A, n` | Next workspace |
| `Ctrl+A, p` | Previous workspace |
| `Ctrl+A, 1-9` | Select workspace by index |
| `Ctrl+A, \|` | Vertical split |
| `Ctrl+A, -` | Horizontal split |
| `Ctrl+A, Arrow` | Move focus between splits |
| `Ctrl+A, x` | Close current surface |
| `Ctrl+A, q` | Quit wmux |
| `Ctrl+A, z` | Toggle zoom (fullscreen current surface) |
| `Ctrl+A, Ctrl+A` | Send literal Ctrl+A to shell |

## Socket API

### Transport

- Windows named pipe: `\\.\pipe\wmux` (default)
- Environment override: `WMUX_PIPE_PATH`
- Newline-delimited cmux-compatible JSON-RPC (not standard JSON-RPC 2.0 — uses `ok`/`result`/`error` envelope, same as cmux v2)

### Message Format

Request:
```json
{"id": "abc123", "method": "workspace.list", "params": {}}
```

Response (success):
```json
{"id": "abc123", "ok": true, "result": {"workspaces": [...]}}
```

Response (error):
```json
{"id": "abc123", "ok": false, "error": {"code": "not_found", "message": "Workspace not found"}}
```

### MVP Commands

Note: cmux's `window.*` namespace is omitted. wmux runs inside an existing terminal window (TUI), so there is no window management. The `workspace` is the top-level organizational unit.


#### System
- `system.ping` → `{"pong": true}`
- `system.capabilities` → `{"commands": ["system.ping", ...], "version": "0.1.0"}`

#### Workspaces
- `workspace.list` → `{"workspaces": [{"id": "uuid", "name": "...", "index": 0}]}`
- `workspace.create` `{name?, command?, working_directory?}` → `{"id": "uuid"}`
- `workspace.select` `{id}` → `{}`
- `workspace.current` → `{"id": "uuid", "name": "...", "index": 0}`
- `workspace.close` `{id}` → `{}`

#### Surfaces
- `surface.list` `{workspace_id?}` → `{"surfaces": [{"id": "uuid", "focused": bool}]}`
- `surface.split` `{surface_id?, direction: "horizontal"|"vertical"}` → `{"id": "uuid"}`
- `surface.focus` `{id}` → `{}`
- `surface.close` `{id}` → `{}`
- `surface.send_text` `{id, text}` → `{}`
- `surface.send_key` `{id, key}` → `{}` — `key` is a named key string: `"Enter"`, `"Tab"`, `"Escape"`, `"Ctrl+C"`, `"Up"`, `"Down"`, `"Left"`, `"Right"`, `"F1"`-`"F12"`. Modifier prefixes: `Ctrl+`, `Alt+`, `Shift+`.

## Shell Detection

Order of precedence:
1. `--shell <path>` CLI flag
2. `WMUX_SHELL` environment variable
3. `COMSPEC` environment variable (typically `cmd.exe`)
4. Fallback: `powershell.exe`

Note: There is no standard Windows registry key for "default shell." The `DefaultTerminal` registry key stores the default terminal *emulator* (Windows Terminal vs conhost), not the shell. We rely on `COMSPEC` as the closest equivalent.

## Crate Dependencies

| Crate | Purpose |
|-------|---------|
| `ratatui` | TUI rendering framework |
| `crossterm` | Terminal input/output, cross-platform |
| `tokio` | Async runtime (named pipes, I/O) |
| `windows-rs` | ConPTY API bindings |
| `serde` + `serde_json` | JSON serialization |
| `uuid` | Surface/workspace IDs |
| `portable-pty` | PTY abstraction (ConPTY on Windows, battle-tested from wezterm) |
| `alacritty_terminal` | VT/ANSI escape sequence parsing + cell grid |

## Project Structure

```
wmux/
├── Cargo.toml
├── src/
│   ├── main.rs              # Entry point, Tokio runtime, arg parsing
│   ├── app.rs               # AppState, event loop orchestration
│   ├── tui/
│   │   ├── mod.rs
│   │   ├── tabs.rs           # Tab bar widget
│   │   ├── splits.rs         # Split pane layout + rendering
│   │   └── status.rs         # Status bar widget
│   ├── terminal/
│   │   ├── mod.rs
│   │   ├── pty.rs            # ConPTY spawn, read/write
│   │   └── shell.rs          # Shell detection logic
│   ├── socket/
│   │   ├── mod.rs
│   │   ├── server.rs         # Named pipe listener
│   │   └── commands.rs       # JSON-RPC command dispatch
│   └── model/
│       ├── mod.rs
│       ├── workspace.rs      # Workspace struct
│       ├── surface.rs        # Surface struct
│       └── split_tree.rs     # Binary split tree
└── README.md
```

## Focus Model

- Exactly one surface is focused at any time. It receives all keyboard input (unless prefix mode is active).
- The focused surface has a highlighted border (bright color). Unfocused surfaces have a dim border.
- `Ctrl+A` activates prefix mode: the next keypress is interpreted as a keybinding, not forwarded to the PTY. If the keypress doesn't match a binding, it is discarded and prefix mode exits.
- `Ctrl+A, Ctrl+A` sends a literal `Ctrl+A` to the focused surface's PTY (escape hatch).

## Surface Lifecycle

- **Shell exit:** When a shell process exits, the surface shows `[Process exited (code N)]` in the terminal area. The surface remains visible until the user closes it with `Ctrl+A, x` or via socket `surface.close`.
- **Last surface in workspace:** Closing the last surface in a workspace closes the workspace. Closing the last workspace quits wmux.
- **Quit (`Ctrl+A, q`):** All PTY child processes are terminated (Windows `TerminateProcess`). No confirmation prompt in MVP.

## Socket Security

- The named pipe `\\.\pipe\wmux` uses default Windows security: accessible to any process running as the same user.
- Multiple agents can connect concurrently (pipe created with `FILE_FLAG_FIRST_PIPE_INSTANCE` disabled, max instances unlimited).
- This matches cmux's Unix socket security model (file permissions scoped to the user).

## Minimum Supported Environment

- **OS:** Windows 10 1809+ (ConPTY requires this minimum)
- **Recommended terminal:** Windows Terminal (full true-color, Unicode support)
- **Degraded support:** Legacy conhost (no true color, limited mouse, basic Unicode)
- **Character encoding:** ConPTY normalizes output to UTF-8. All internal strings are UTF-8.

## CLI Interface

```
wmux                    # Launch TUI (default)
wmux --shell pwsh.exe   # Launch with specific shell
wmux --pipe \\.\pipe\my-wmux  # Custom pipe path
```

No separate CLI tool for MVP. Agents connect directly to the named pipe and send JSON-RPC.

## Testing Strategy

- **Unit tests:** Split tree operations, shell detection, JSON-RPC parsing
- **Integration tests:** Spawn wmux, connect to pipe, send commands, verify responses
- **Manual testing:** TUI interaction on Windows (splits, tabs, keybindings)

## Future Extensions (Post-MVP)

- CLI tool (`wmux` subcommands like cmux)
- Session persistence / daemon mode
- Notification system (OSC sequences)
- Browser panel (WebView2)
- Configuration file
- Mouse support
- WSL native integration
- cmux socket protocol full compatibility
