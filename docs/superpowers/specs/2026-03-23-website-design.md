# wmux Landing Page — Design Spec

## Overview

A single-page, dark-themed landing page for wmux hosted via GitHub Pages from the `docs/` folder. The site's goal is to attract Windows developers and convince them to try wmux. Tone is bold and confident — "tmux for Windows. Finally."

**Delivery:** Single self-contained `docs/index.html` with inline CSS and minimal JS. No build tools, no dependencies, no framework.

**Deployment:** GitHub Pages serving from `docs/` directory.

---

## Color & Typography

- **Background:** #0a0a0a (near-black)
- **Primary text:** #fafafa (near-white)
- **Muted text:** #888 (secondary descriptions)
- **Accent:** #3B82F6 (blue) — used for primary CTA buttons and interactive highlights
- **Borders/cards:** Subtle borders (#222–#333)
- **Font stack:** System monospace for logotype/code, system sans-serif (Inter, -apple-system, etc.) for body text
- **Sizing:** Large hero text (2xl+), generous line-height (1.5), comfortable spacing throughout

---

## Sections

### 1. Hero

- Large **wmux** logotype (monospace, bold)
- Tagline: **"tmux for Windows. Finally."**
- Subtitle: "Split panes. Tabbed workspaces. A socket API for AI agents. One binary. Zero dependencies."
- Two CTA buttons:
  - **"Download"** (filled, accent blue) → `https://github.com/fernandomenuk/wmux/releases`
  - **"View on GitHub"** (outlined/ghost, border only) → `https://github.com/fernandomenuk/wmux`
- Dark background, generous whitespace

### 2. Features

Six feature cards in a 3-column, 2-row grid (desktop), stacked on mobile:

1. **Split Panes** — Vertical and horizontal, infinitely nestable
2. **Tabbed Workspaces** — Switch contexts without losing your place
3. **Socket API** — JSON-RPC over named pipes. AI agents can control terminals programmatically
4. **Any Shell** — PowerShell, cmd, WSL bash, nushell — whatever you use
5. **Mouse Support** — Click to focus, drag to resize, passthrough to apps
6. **Windows Native** — Built on ConPTY. Works in Windows Terminal, conhost, or any emulator

Styled with subtle borders, no heavy backgrounds. Minimal and clean.

### 3. Terminal Demo

A CSS/HTML terminal mockup showing wmux with split panes:

- Clean title bar with minimize/maximize/close icons (Windows-style) and "wmux" label
- Inside: visual representation of split panes (2 vertical splits, one subdivided horizontally)
- Realistic terminal content — file listings, `cargo test` output, etc.
- Tab bar at top showing workspace tabs (e.g., "1:code", "2:tests")
- Subtle box shadow and border to pop against page background

No image files — pure CSS/HTML construction.

### 4. Quick Start

Install commands in a styled code block:

```
git clone https://github.com/fernandomenuk/wmux.git
cd wmux
cargo build --release
./target/release/wmux.exe
```

Followed by a compact keybindings cheat sheet table:

| Keys | Action |
|------|--------|
| Ctrl+A \| | Split vertical |
| Ctrl+A - | Split horizontal |
| Ctrl+A Arrow | Move focus |
| Ctrl+A x | Close pane |
| Ctrl+A z | Toggle zoom |
| Ctrl+A c | New workspace |
| Ctrl+A n/p | Next/prev workspace |
| Ctrl+A 1-9 | Jump to workspace |
| Ctrl+A q | Quit |

Monospace font, subtle borders.

### 5. FAQ

5 collapsible items using native `<details>/<summary>` HTML elements (no JS needed, accessible by default):

1. **What shells does wmux support?** — PowerShell, cmd, WSL bash, nushell, or anything. Set with `--shell` flag or `WMUX_SHELL` env var.
2. **What Windows versions work?** — Windows 10 1809+ (ConPTY required). Best experience in Windows Terminal.
3. **How is this different from tmux in WSL?** — wmux is native Windows. No Linux subsystem, no translation layer. Your Windows shells, your Windows paths, your Windows tools.
4. **Can AI agents use wmux?** — Yes. The JSON-RPC socket API lets agents spawn terminals, send commands, and read output programmatically via named pipes.
5. **Is it free?** — Yes, MIT licensed. Open source forever.

### 6. Footer

- **wmux** logotype (left-aligned)
- Links: GitHub, License, Issues
- Tagline: "MIT Licensed. Built with Rust."
- Copyright line

---

## Responsive Behavior

- **Desktop (768px+):** 3-column, 2-row feature grid, full-width terminal demo, side-by-side elements where applicable
- **Mobile (<768px):** Single column, stacked features, scaled terminal demo

## Constraints

- Single `docs/index.html` file with inline `<style>` and `<script>`
- No external dependencies (no CDN, no fonts to load, no JS frameworks)
- Fast loading, minimal footprint
- Accessible: semantic HTML, `lang="en"`, keyboard navigable, sufficient contrast, `prefers-reduced-motion` respected

## Meta & SEO

- `<title>wmux — tmux for Windows</title>`
- `<meta name="description" content="Terminal multiplexer for Windows. Split panes, tabbed workspaces, and a socket API for AI agents. One binary. Zero dependencies.">`
- `<meta name="color-scheme" content="dark">`
- Open Graph tags for social sharing (`og:title`, `og:description`)
- No favicon required initially
