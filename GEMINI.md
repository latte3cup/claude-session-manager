# wmux - cmux for Windows

Native terminal multiplexer for Windows with split panes, tabbed workspaces, and a JSON-RPC socket API for AI agents.

## Project Overview

`wmux` is a Rust-based terminal multiplexer designed specifically for the Windows ecosystem, leveraging ConPTY for native pseudo-terminal support. It is structured as a workspace with three primary crates:

- **`wmux-core`**: The foundational library containing state management (`WmuxCore`), PTY handling (`portable-pty`), terminal emulation (`vt100`), and the JSON-RPC socket protocol definitions.
- **`wmux-cli`**: A Terminal User Interface (TUI) implementation using `ratatui` and `crossterm`. This is the primary way to use `wmux` from a terminal.
- **`wmux-app`**: A graphical desktop application built with `tauri`, providing a modern GUI alternative to the TUI.

### Core Features

- **Split Panes**: Vertically and horizontally nestable terminal panes.
- **Workspaces**: Multiple tabbed contexts for organizing terminal sessions.
- **Socket API**: A JSON-RPC API over Windows named pipes (`\\.\pipe\wmux`), allowing external tools and AI agents to programmatically control terminal sessions.
- **Zero Dependencies**: A single-binary solution (per interface) that works with any Windows shell (PowerShell, CMD, WSL, etc.).

---

## Building and Running

The project uses standard Rust tooling (`cargo`).

### CLI Version
- **Build**: `cargo build -p wmux-cli`
- **Run**: `cargo run -p wmux-cli` or `target/debug/wmux.exe`
- **Release**: `cargo build -p wmux-cli --release`

### GUI Version (Tauri)
- **Build**: `cargo build -p wmux-app`
- **Run**: `cargo run -p wmux-app`
- **Tauri Dev**: `cd crates/wmux-app && npm run tauri dev` (requires Node.js/npm for frontend)

### Testing
- **Run all tests**: `cargo test`
- **Core tests**: `cargo test -p wmux-core`

---

## Development Conventions

### Architecture
- **State Management**: `WmuxCore` in `wmux-core` is the source of truth. UI implementations should interact with the core or follow its state patterns.
- **Concurrency**: The project heavily relies on `tokio` for asynchronous task management, especially for multiplexing PTY output, socket requests, and UI rendering.
- **Error Handling**: Custom error types are defined in `wmux-core/src/error.rs`.

### Coding Style
- Follow standard Rust idiomatic patterns (as enforced by `clippy`).
- Documentation is located in the `docs/` directory, including design specs and implementation plans.
- New features should generally be implemented in `wmux-core` first to ensure availability in both CLI and GUI versions.

### Socket API
When adding new functionality that should be accessible to AI agents, update:
1. `crates/wmux-core/src/socket/protocol.rs` (Protocol models)
2. `crates/wmux-core/src/socket/commands.rs` (Command handlers)
3. `README.md` (API documentation)

---

## Key Files
- `crates/wmux-core/src/core.rs`: Central state logic.
- `crates/wmux-cli/src/main.rs`: CLI entry point and event loop.
- `crates/wmux-app/src/main.rs`: Tauri app entry point.
- `docs/design.md`: High-level architectural design.
