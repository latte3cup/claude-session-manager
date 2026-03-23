import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { WebglAddon } from './vendor/addon-webgl.mjs';

let term;
let fitAddon;
let surfaceId = null;

async function init() {
  term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 14,
    theme: {
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
    }
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  try {
    const webglAddon = new WebglAddon();
    term.loadAddon(webglAddon);
  } catch (e) {
    console.warn('WebGL addon not available, using canvas renderer');
  }

  const container = document.getElementById('terminal-container');
  term.open(container);
  fitAddon.fit();

  // Get the surface ID from backend
  try {
    surfaceId = await window.__TAURI__.core.invoke('get_surface_id');
  } catch (e) {
    term.write('Error: Could not connect to backend: ' + e + '\r\n');
    return;
  }

  // Send initial size to backend
  await sendResize();

  // Handle user input → send to backend
  term.onData((data) => {
    if (surfaceId) {
      window.__TAURI__.core.invoke('send_input', {
        surfaceId: surfaceId,
        data: data,
      });
    }
  });

  // Handle terminal resize
  term.onResize(({ cols, rows }) => {
    if (surfaceId) {
      window.__TAURI__.core.invoke('resize_terminal', {
        surfaceId: surfaceId,
        cols: cols,
        rows: rows,
      });
    }
  });

  // Listen for PTY output from backend
  window.__TAURI__.event.listen('pty-output', (event) => {
    const { surface_id, data } = event.payload;
    if (surface_id === surfaceId) {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      term.write(bytes);
    }
  });

  // Listen for PTY exit
  window.__TAURI__.event.listen('pty-exit', (event) => {
    const { surface_id } = event.payload;
    if (surface_id === surfaceId) {
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });
}

async function sendResize() {
  if (surfaceId && term) {
    await window.__TAURI__.core.invoke('resize_terminal', {
      surfaceId: surfaceId,
      cols: term.cols,
      rows: term.rows,
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
