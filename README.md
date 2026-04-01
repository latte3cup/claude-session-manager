<div align="center">

<img src="docs/logo.png" alt="wmux mascot" width="120">

# wmux

### The terminal multiplexer Windows never had.

[![Release](https://img.shields.io/github/v/release/fernandomenuk/wmux?color=a78bfa&style=flat-square)](https://github.com/fernandomenuk/wmux/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-a78bfa?style=flat-square)](LICENSE)
[![Windows 10+](https://img.shields.io/badge/Windows-10%2B-a78bfa?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![Rust](https://img.shields.io/badge/Built_with-Rust-a78bfa?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)

<br>

**Split panes. Tabbed workspaces. A socket API for AI agents.**<br>
**One binary. Zero dependencies. Built with Rust + Tauri.**

<br>

[<img src="https://img.shields.io/badge/Download_wmux-v0.6.2-7c3aed?style=for-the-badge&logo=windows&logoColor=white" alt="Download">](https://github.com/fernandomenuk/wmux/releases/latest/download/wmux.msi)
&nbsp;&nbsp;
[<img src="https://img.shields.io/badge/View_Website-fernandomenuk.github.io-18181b?style=for-the-badge" alt="Website">](https://fernandomenuk.github.io/wmux)

<br>

```
 ┌──────────────────────────────────────────────────┐
 │ [ Project ] [ API ] [ Tests ]             [ + ]  │
 ├────────────────────────┬─────────────────────────┤
 │                        │                         │
 │  PS C:\project> _      │  PS C:\api> cargo test  │
 │                        │  running 75 tests...    │
 │                        │  test result: ok        │
 │                        │                         │
 ├────────────────────────┴─────────────────────────┤
 │ Shell: pwsh | WS: Project | Pane: 1 | CPU: 0.2% │
 └──────────────────────────────────────────────────┘
```

</div>

---

<br>

## Why wmux?

Windows developers have been stuck without a proper multiplexer forever. tmux? Linux only. cmux? Also Linux. Screen? lol.

**wmux fixes that.** A native desktop app that just works on Windows.

<table>
<tr>
<td width="50%">

### What you get

- **Graphical Split Panes** — vertical, horizontal, infinitely nestable
- **Tabbed Workspaces** — organize your dev environments
- **AI-First Socket API** — JSON-RPC over named pipes
- **Any Shell** — PowerShell, CMD, WSL, nushell, you name it
- **Blazing Fast** — Rust + ConPTY, near-zero overhead

</td>
<td width="50%">

### What makes it different

- **Not a CLI tool** — it's a real desktop app with a modern UI
- **Built for AI agents** — Claude Code, Cursor, Copilot can control your terminals programmatically
- **Windows-native** — ConPTY, named pipes, high-DPI, the whole deal
- **Single binary** — no Node.js, no Python, no Electron bloat

</td>
</tr>
</table>

<br>

## Quick Start

### Download

Grab the latest `.msi` installer from [Releases](https://github.com/fernandomenuk/wmux/releases/latest) and run it. Done.

### Build from Source

```bash
cargo install tauri-cli
git clone https://github.com/fernandomenuk/wmux.git
cd wmux/crates/wmux-app
cargo tauri build
```

<br>

## Socket API

This is what makes wmux special. AI agents can control your terminal sessions over a named pipe.

```powershell
# Connect
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", "wmux", [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(5000)
```

Newline-delimited JSON-RPC. Compatible with [cmux](https://github.com/anthropics/cmux) protocol.

| Method | What it does |
|---|---|
| `workspace.create` | Create a new tabbed workspace |
| `workspace.close` | Close a workspace by ID |
| `surface.split` | Split the current pane |
| `surface.send_text` | Send commands to a terminal |

<br>

## Architecture

```
wmux/
├── wmux-core     # Engine: PTY management, layouts, state
├── wmux-app      # Desktop app: Tauri + WebView UI
└── wmux-cli      # Legacy CLI (archived)
```

<br>

## Roadmap

- [x] Graphical split panes
- [x] Tabbed workspaces
- [x] JSON-RPC socket API
- [x] Command palette (`Ctrl+Shift+P`)
- [x] Workspace sidebar
- [ ] Drag-and-drop pane resizing
- [ ] Theme support (Light / Dark / Custom)
- [ ] Session persistence (Detach / Reattach)
- [ ] Plugin system

<br>

## Contributing

PRs welcome. The codebase is clean Rust — dive in.

```bash
cargo test          # Run the test suite
cargo tauri dev     # Launch in dev mode with hot reload
```

<br>

## License

[MIT](LICENSE) — do whatever you want.

---

<div align="center">

<img src="docs/logo.png" alt="wmux" width="48">

<br><br>

**Built for Windows developers who are tired of waiting.**

If wmux helps you, [star the repo](https://github.com/fernandomenuk/wmux) — it helps others find it.

<br>

[Website](https://fernandomenuk.github.io/wmux) · [Releases](https://github.com/fernandomenuk/wmux/releases) · [Issues](https://github.com/fernandomenuk/wmux/issues)

</div>
