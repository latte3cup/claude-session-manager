# Claude Session Manager

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202.x-orange.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)

Claude Session Manager is a self-hosted desktop workbench for terminal-first AI coding workflows.
Manage Claude Code, OpenCode, Kilo Code sessions alongside terminal, file explorer, Git tools, and a Monaco editor — all in a lightweight Tauri 2.x desktop app.

> Based on [PriuS2/RemoteCode](https://github.com/PriuS2/RemoteCode), migrated from Electron to **Tauri 2.x** for dramatically reduced app size and memory usage.

## Tauri vs Electron

| | Electron | Tauri 2.x |
|---|---|---|
| App Size | ~164MB | **~20MB** |
| Memory | ~300MB | **~36MB** |
| Runtime | Bundled Chromium | System WebView2/WebKit |
| Backend | Node.js | Rust |

## Key Capabilities

| Capability | Description |
|---|---|
| Multi-CLI Sessions | Claude Code, OpenCode, Kilo Code, Terminal, Custom CLI |
| Session Suspend/Resume | Suspend sessions and resume with CLI session recovery (`--resume`, `-s`) |
| Multi-Pane Workbench | Drag-and-drop pane layout with split, replace, and rearrange |
| Saved Project Layouts | Store and restore layouts per project |
| Keep-Alive Terminals | xterm.js instances persist across view switches |
| File Explorer | Browse, preview, upload, download, rename, delete |
| Git Panel | Status, diff, log, branches, stash, commit, push, pull |
| IDE Workspace | Monaco editor with LSP support |
| System Tray | Close-to-tray, tray menu, launch at login |
| Multi-Window | Dedicated project and session windows |
| JWT Auth | Password protection with rate limiting |

## Feature Tour

### Login

![Login](docs/screenshots/readme-login.png)

*Password: default `changeme` (set `CCR_PASSWORD` to change)*

### Terminal Session

![Terminal](docs/screenshots/readme-claude-session.png)

*Run Claude Code, OpenCode, or Kilo Code in a native desktop window.*

### Drag-and-Drop Layout

![Layout](docs/screenshots/readme-layout-editor.png)

*Drag sessions into edges to split panes and build multi-pane layouts.*

### File Explorer

![File Explorer](docs/screenshots/readme-file-explorer.png)

*Browse workspace files without leaving the app.*

### Git Panel

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/readme-git-status.png" alt="Git status" /></td>
    <td width="50%"><img src="docs/screenshots/readme-git-log.png" alt="Git log" /></td>
  </tr>
</table>

### IDE Workspace

![IDE](docs/screenshots/readme-ide-workspace.png)

*Monaco editor with language-aware tooling.*

## Architecture

```
┌──────────────────────────────────────┐
│         Tauri 2.x (Rust)             │
│  Window Manager / Tray / IPC / State │
│              ~20MB binary            │
└──────────────┬───────────────────────┘
               │ HTTP / WebSocket
               ▼
┌──────────────────────────────────────┐
│       Python FastAPI Backend         │
│  REST API / WebSocket PTY / SQLite   │
│  JWT Auth / LSP / Git operations     │
└──────────────┬───────────────────────┘
               │ Serves static files
               ▼
┌──────────────────────────────────────┐
│     React / TypeScript Frontend      │
│  xterm.js / Monaco Editor / UI       │
└──────────────────────────────────────┘
```

## Requirements

- **Rust** (for Tauri)
- **Python 3.10+**
- **Node.js 18+**
- At least one CLI in PATH: `claude`, `kilo`, `opencode`

## Getting Started

### 1. Clone

```bash
git clone https://github.com/latte3cup/claude-session-manager.git
cd claude-session-manager
```

### 2. Setup Python Backend

```bash
python -m venv .venv

# Windows
.venv\Scripts\pip install -r backend/requirements.txt

# macOS / Linux
.venv/bin/pip install -r backend/requirements.txt
```

### 3. Build Frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

### 4. Run with Tauri

```bash
cd src-tauri
cargo tauri dev
```

The app will:
1. Start the Python backend automatically
2. Wait for health check
3. Open a desktop window with the workbench UI

### Web-Only Mode (No Tauri)

```bash
# Start Python backend directly
python remote_code_server.py --host 127.0.0.1 --port 8080

# Open http://localhost:8080 in browser
```

## Configuration

Set in `.env` or environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CCR_PORT` | `8080` | Backend port |
| `CCR_PASSWORD` | `changeme` | Login password |
| `CCR_JWT_SECRET` | (auto) | JWT signing key |
| `CCR_CLAUDE_COMMAND` | `claude` | Claude Code CLI |
| `CCR_KILO_COMMAND` | `kilo` | Kilo Code CLI |
| `CCR_OPENCODE_COMMAND` | `opencode` | OpenCode CLI |
| `CCR_DB_PATH` | `sessions.db` | SQLite database path |
| `CCR_ALLOWED_ORIGINS` | `*` | CORS origins |

## Session Types

| Type | Description |
|---|---|
| `claude` | Claude Code CLI session |
| `kilo` | Kilo Code CLI session |
| `opencode` | OpenCode terminal session |
| `terminal` | Plain shell session |
| `custom` | User-provided command |
| `folder` | File Explorer panel |
| `git` | Git panel |
| `ide` | Monaco editor workspace |

## Build Release

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Build Tauri release
cd src-tauri && cargo tauri build
```

Output: `src-tauri/target/release/`

## Documentation

- [docs/architecture.md](docs/architecture.md) — Backend and frontend architecture
- [docs/backend-api.md](docs/backend-api.md) — REST and WebSocket API reference
- [docs/configuration.md](docs/configuration.md) — Runtime settings
- [docs/deployment.md](docs/deployment.md) — Deployment guide
- [docs/websocket-protocol.md](docs/websocket-protocol.md) — Terminal WebSocket protocol

## Credits

Based on [PriuS2/RemoteCode](https://github.com/PriuS2/RemoteCode) — migrated from Electron to Tauri 2.x.

## License

MIT
