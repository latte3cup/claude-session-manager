# Claude Session Manager

Multiple Claude Code sessions in a single window. Built with Rust + Tauri + xterm.js.

Based on [wmux](https://github.com/fernandomenuk/wmux) (MIT License).

## Features

- 4-pane terminal grid (session1~4)
- Auto command execution on startup (claude --continue, etc.)
- Post macro system (sequential key/text inputs with delays)
- Context menu (right-click title bar): Stop/Restart, command editor, macro editor
- Session metadata (session.meta.json): title, autoCommand, postMacro, fontSize
- Ctrl+C/V/A/X clipboard shortcuts
- Ctrl+Scroll font size adjustment (saved per session)
- Solarized Dark theme
- Settings modal (layout, font)
- Frameless window with hover header

## Build

Requires: Rust, VS Build Tools 2022, Windows SDK, Tauri CLI

```bash
cargo install tauri-cli
cd crates/wmux-app
cargo tauri build
```

## License

MIT - See [LICENSE](LICENSE)
