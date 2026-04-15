import { Terminal } from '/vendor/xterm.mjs';
import { FitAddon } from '/vendor/addon-fit.mjs';

const THEME = {
  background: '#002b36',
  foreground: '#b0bec5',
  cursor: '#93a1a1',
  selectionBackground: 'rgba(7, 54, 66, 0.6)',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#586e75',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
};

const terminals = new Map();
let onInputCallback = null;

export function setOnInput(cb) { onInputCallback = cb; }

export function createTerminal(surfaceId) {
  if (terminals.has(surfaceId)) return terminals.get(surfaceId);

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Malgun Gothic', monospace",
    fontSize: 14,
    theme: THEME,
    allowTransparency: false,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const container = document.createElement('div');
  container.style.cssText = 'width:100%;height:100%;display:none;';
  document.getElementById('terminal-area').appendChild(container);
  term.open(container);

  term.onData((data) => {
    if (onInputCallback) onInputCallback(surfaceId, data);
  });

  // Long-press paste
  let pressTimer = null;
  container.addEventListener('touchstart', () => {
    pressTimer = setTimeout(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && onInputCallback) onInputCallback(surfaceId, text);
      } catch {}
    }, 600);
  }, { passive: true });
  container.addEventListener('touchend', () => clearTimeout(pressTimer));
  container.addEventListener('touchmove', () => clearTimeout(pressTimer));

  const entry = { term, fitAddon, container };
  terminals.set(surfaceId, entry);
  return entry;
}

export function showTerminal(surfaceId) {
  for (const [id, entry] of terminals) {
    entry.container.style.display = id === surfaceId ? '' : 'none';
  }
  const entry = terminals.get(surfaceId);
  if (entry) {
    entry.fitAddon.fit();
    entry.term.focus();
  }
}

export function writeOutput(surfaceId, data) {
  const entry = terminals.get(surfaceId);
  if (entry) entry.term.write(data);
}

export function fitAll() {
  for (const entry of terminals.values()) {
    entry.fitAddon.fit();
  }
}

export function getTermSize(surfaceId) {
  const entry = terminals.get(surfaceId);
  if (!entry) return { cols: 80, rows: 24 };
  return { cols: entry.term.cols, rows: entry.term.rows };
}
