import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { WebglAddon } from './vendor/addon-webgl.mjs';

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
let focusedId = null;
let onInputCallback = null;
let onNewTerminalCallback = null;
let onFontSizeChangeCallback = null;
let onTitleChangeCallback = null;

export function setOnInput(callback) { onInputCallback = callback; }
export function setOnNewTerminal(callback) { onNewTerminalCallback = callback; }
export function setOnFontSizeChange(callback) { onFontSizeChangeCallback = callback; }
export function setOnTitleChange(callback) { onTitleChangeCallback = callback; }

export function setFontSize(surfaceId, size) {
  const entry = terminals.get(surfaceId);
  if (entry) {
    entry.term.options.fontSize = size;
    entry.fitAddon.fit();
  }
}

export function setAllFontFamily(fontFamily) {
  for (const entry of terminals.values()) {
    entry.term.options.fontFamily = fontFamily;
    entry.fitAddon.fit();
  }
}


export function createTerminal(surfaceId) {
  if (terminals.has(surfaceId)) return terminals.get(surfaceId);

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'Malgun Gothic', monospace",
    fontSize: 12,
    theme: THEME,
    allowTransparency: false,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  try {
    term.loadAddon(new WebglAddon());
  } catch (e) {}

  const container = document.createElement('div');
  container.className = 'pane';
  container.dataset.surfaceId = surfaceId;

  // 타이틀바
  const titleBar = document.createElement('div');
  titleBar.className = 'pane-title';
  const titleText = document.createElement('span');
  titleText.className = 'pane-title-text';
  titleText.textContent = surfaceId.slice(0, 8);
  titleBar.appendChild(titleText);
  container.appendChild(titleBar);

  // 더블클릭 → 인라인 편집
  titleText.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.className = 'pane-title-input';
    input.value = titleText.textContent;
    titleText.style.display = 'none';
    titleBar.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const val = input.value.trim();
      if (val) titleText.textContent = val;
      titleText.style.display = '';
      input.remove();
      if (val && onTitleChangeCallback) onTitleChangeCallback(surfaceId, val);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { titleText.style.display = ''; input.remove(); }
    });
  });

  document.getElementById('pane-area').appendChild(container);
  term.open(container);

  if (onNewTerminalCallback) onNewTerminalCallback(surfaceId, term);

  // Ctrl+C = 복사 (선택 있을 때), Ctrl+V = 붙여넣기
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.key === 'x') {
      // 현재 입력 줄 클리어 (Ctrl+U 전송)
      if (onInputCallback) onInputCallback(surfaceId, '\x15');
      return false;
    }
    if (e.ctrlKey && e.key === 'a') {
      term.selectAll();
      return false;
    }
    if (e.ctrlKey && e.key === 'v') {
      navigator.clipboard.readText().then((text) => {
        if (onInputCallback) onInputCallback(surfaceId, text);
      });
      e.preventDefault();
      return false;
    }
    // Ctrl+Tab은 글로벌 핸들러에서 처리 — xterm에 전달하지 않음
    if (e.ctrlKey && e.key === 'Tab') {
      return false;
    }
    return true;
  });

  // Ctrl+Scroll 폰트 크기 조절 (capture phase로 xterm보다 먼저 처리)
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const current = term.options.fontSize || 12;
    const next = Math.max(8, Math.min(24, current + (e.deltaY < 0 ? 1 : -1)));
    term.options.fontSize = next;
    fitAddon.fit();
    // 크기 변경 후 PTY resize
    window.__TAURI__.core.invoke('resize_terminal', {
      surfaceId, cols: term.cols, rows: term.rows,
    });
    // 콜백으로 저장 알림
    if (onFontSizeChangeCallback) onFontSizeChangeCallback(surfaceId, next);
  }, { passive: false, capture: true });

  term.onData((data) => {
    if (surfaceId === focusedId && onInputCallback) onInputCallback(surfaceId, data);
  });

  container.addEventListener('mousedown', () => {
    window.__TAURI__.core.invoke('focus_pane', { surfaceId });
  });

  // 터미널 영역 우클릭 → 붙여넣기
  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.pane-title')) return; // 타이틀바는 컨텍스트 메뉴 유지
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.readText().then((text) => {
      if (text && onInputCallback) onInputCallback(surfaceId, text);
    });
  });

  const entry = { term, fitAddon, container };
  terminals.set(surfaceId, entry);
  return entry;
}

export function destroyTerminal(surfaceId) {
  const entry = terminals.get(surfaceId);
  if (!entry) return;
  entry.term.dispose();
  entry.container.remove();
  terminals.delete(surfaceId);
}

export function writeOutput(surfaceId, data) {
  const entry = terminals.get(surfaceId);
  if (entry) entry.term.write(data);
}

export function setFocused(surfaceId) {
  focusedId = surfaceId;
  for (const [id, entry] of terminals) {
    entry.container.classList.toggle('focused', id === surfaceId);
    if (id === surfaceId) entry.term.focus();
    entry.term.refresh(0, entry.term.rows - 1);
  }
}

export function getFocusedId() { return focusedId; }
export function getSurfaceIds() { return [...terminals.keys()]; }
export function getTerminal(surfaceId) { return terminals.get(surfaceId); }

export async function applyLayout(panes, totalWidthCells, totalHeightCells, knownSurfaceIds = []) {
  const newIds = new Set(panes.map(p => p.surface_id));
  const knownIds = new Set(knownSurfaceIds);

  for (const id of [...terminals.keys()]) {
    if (knownIds.size > 0 && !knownIds.has(id)) destroyTerminal(id);
  }

  for (const [id, entry] of terminals) {
    if (!newIds.has(id)) entry.container.style.display = 'none';
  }

  for (const pane of panes) {
    let entry = terminals.get(pane.surface_id) || createTerminal(pane.surface_id);
    const left = (pane.x / totalWidthCells) * 100;
    const top = (pane.y / totalHeightCells) * 100;
    const width = (pane.width / totalWidthCells) * 100;
    const height = (pane.height / totalHeightCells) * 100;

    Object.assign(entry.container.style, {
      left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
      display: '', right: 'auto', bottom: 'auto'
    });

    if (pane.is_focused) setFocused(pane.surface_id);
  }

  // 2-3프레임 대기 후 fit — CSS 레이아웃 안정화
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (const pane of panes) {
    const entry = terminals.get(pane.surface_id);
    if (entry) entry.fitAddon.fit();
  }
}

export function setOff(surfaceId, isOff) {
  const entry = terminals.get(surfaceId);
  if (!entry) return;
  let overlay = entry.container.querySelector('.off-overlay');
  if (isOff && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'off-overlay';
    overlay.innerHTML = '<span>OFF</span>';
    entry.container.appendChild(overlay);
  } else if (!isOff && overlay) {
    overlay.remove();
  }
}

export function setTitle(surfaceId, title) {
  const entry = terminals.get(surfaceId);
  if (entry) {
    const titleText = entry.container.querySelector('.pane-title-text');
    if (titleText) titleText.textContent = title;
  }
}

export function getTitleBar(surfaceId) {
  const entry = terminals.get(surfaceId);
  return entry?.container.querySelector('.pane-title');
}

export function getCellDimensions() {
  for (const [, entry] of terminals) {
    const dims = entry.term._core._renderService?.dimensions;
    if (dims) return { cellWidth: dims.css.cell.width, cellHeight: dims.css.cell.height };
  }
  return { cellWidth: 9, cellHeight: 17 };
}
