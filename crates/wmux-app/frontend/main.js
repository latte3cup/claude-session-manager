import * as tm from './terminal-manager.js';
import { refreshLayout, setupResizeHandler } from './layout.js';
import { showContextMenu } from './context-menu.js';
import { setupSettings, loadSettings, setupWindowControls } from './settings.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

async function init() {
  // WebView2 기본 우클릭 메뉴 비활성화
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // F11 최대화/복원
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      invoke('window_maximize');
    }
  });
  // Forward terminal input to backend
  tm.setOnInput((surfaceId, data) => {
    invoke('send_input', { surfaceId, data });
  });

  // Set up resize handler + settings
  setupResizeHandler();
  setupSettings();
  setupWindowControls();
  await loadSettings();

  // 타이틀 변경 시 메타데이터 저장
  tm.setOnTitleChange((surfaceId, newTitle) => {
    for (const [idx, sid] of Object.entries(sessionSurfaceMap)) {
      if (sid === surfaceId && sessionMetas[idx]) {
        sessionMetas[idx].title = newTitle;
        saveSessionMeta(parseInt(idx), sessionMetas[idx]);
      }
    }
  });

  // 폰트 크기 변경 시 메타데이터 저장
  tm.setOnFontSizeChange((surfaceId, size) => {
    for (const [idx, sid] of Object.entries(sessionSurfaceMap)) {
      if (sid === surfaceId && sessionMetas[idx]) {
        sessionMetas[idx].fontSize = size;
        saveSessionMeta(parseInt(idx), sessionMetas[idx]);
      }
    }
  });

  // PTY output → route to correct terminal
  listen('pty-output', (event) => {
    const { surface_id, data } = event.payload;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    tm.writeOutput(surface_id, bytes);
  });

  // PTY exit → OFF 오버레이
  listen('pty-exit', (event) => {
    const { surface_id } = event.payload;
    tm.writeOutput(surface_id, new TextEncoder().encode('\r\n\x1b[90m[Process exited]\x1b[0m\r\n'));
    tm.setOff(surface_id, true);
  });

  // Layout/focus changes → refresh UI
  listen('layout-changed', async () => {
    await refreshLayout();
  });

  listen('focus-changed', (event) => {
    tm.setFocused(event.payload.surface_id);
  });

  // 창이 완전히 렌더링될 때까지 대기
  await sleep(500);

  // Initial load
  await refreshLayout();

  // 자동 4분할 + autoCommand
  await setupSessions();
}

// === Session Management ===

const SESSION_FOLDERS = ['session1', 'session2', 'session3', 'session4'];
let WORKSPACE_ROOT = '';

async function setupSessions() {
  // workspace root 가져오기
  WORKSPACE_ROOT = await invoke('get_workspace_root');

  // 세션 폴더 자동 생성
  for (const folder of SESSION_FOLDERS) {
    try { await invoke('write_file', { path: `${WORKSPACE_ROOT}\\${folder}\\.keep`, content: '' }); } catch {}
  }

  // 3번 split해서 4분할
  // 1. vertical split → 좌/우
  await invoke('split_pane', { direction: 'vertical' });
  await refreshLayout();
  await sleep(500);

  // 2. 좌측 포커스 → horizontal split → 좌상/좌하
  await invoke('focus_direction', { direction: 'left' });
  await sleep(100);
  await invoke('split_pane', { direction: 'horizontal' });
  await refreshLayout();
  await sleep(500);

  // 3. 우측 포커스 → horizontal split → 우상/우하
  await invoke('focus_direction', { direction: 'right' });
  await sleep(100);
  await invoke('focus_direction', { direction: 'right' });
  await sleep(100);
  await invoke('split_pane', { direction: 'horizontal' });
  await refreshLayout();
  await sleep(500);

  // 각 패널에 세션 폴더 cd + autoCommand
  const layout = await invoke('get_layout', { width: 200, height: 50 });
  const surfaceIds = layout.panes.map(p => p.surface_id);

  for (let i = 0; i < Math.min(surfaceIds.length, SESSION_FOLDERS.length); i++) {
    const sid = surfaceIds[i];
    const meta = await loadSessionMeta(SESSION_FOLDERS[i]);
    sessionMetas[i] = meta;
    sessionSurfaceMap[i] = sid;

    // 타이틀 + 폰트 크기 설정
    tm.setTitle(sid, meta.title || SESSION_FOLDERS[i]);
    if (meta.fontSize) tm.setFontSize(sid, meta.fontSize);

    // 컨텍스트 메뉴 연결
    const titleBar = tm.getTitleBar(sid);
    if (titleBar) {
      const idx = i;
      titleBar.addEventListener('contextmenu', (e) => {
        const m = sessionMetas[idx] || {};
        showContextMenu(e, sid, idx, m, {
          onStop: () => invoke('send_input', { surfaceId: sid, data: '\x03' }),
          onStart: () => {},
          onRestart: () => invoke('send_input', { surfaceId: sid, data: '\x03' }),
          onMetaSave: saveSessionMeta,
        });
      });
    }

    // cd + autoCommand
    const cdCmd = `cd /d "${WORKSPACE_ROOT}\\${SESSION_FOLDERS[i]}"\r`;
    await invoke('send_input', { surfaceId: sid, data: cdCmd });

    if (meta.autoCommand) {
      await sleep(500);
      await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
    }

    if (meta.postMacroEnabled && meta.postMacro && meta.postMacro.length > 0) {
      runMacro(sid, meta.postMacro, meta.autoCommand ? 500 : 0);
    }
  }
}

const sessionMetas = {};
const sessionSurfaceMap = {};

async function saveSessionMeta(sessionIndex, meta) {
  const folder = SESSION_FOLDERS[sessionIndex];
  const path = `${WORKSPACE_ROOT}\\${folder}\\session.meta.json`;
  sessionMetas[sessionIndex] = meta;
  // 타이틀 업데이트
  const sid = sessionSurfaceMap[sessionIndex];
  if (sid) tm.setTitle(sid, meta.title || folder);
  try {
    await invoke('write_file', { path, content: JSON.stringify(meta, null, 2) });
  } catch (e) {
    console.error('Failed to save meta:', e);
  }
}

async function loadSessionMeta(folder) {
  const defaults = { title: folder, autoCommand: '', postMacro: [], postMacroEnabled: true };
  try {
    const path = `${WORKSPACE_ROOT}\\${folder}\\session.meta.json`;
    const text = await invoke('read_file', { path });
    return { ...defaults, ...JSON.parse(text) };
  } catch {
    return defaults;
  }
}

const KEY_MAP = {
  enter: '\r', tab: '\t', escape: '\x1b',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  backspace: '\x7f', space: ' ',
};

function runMacro(surfaceId, steps, baseDelay) {
  let totalDelay = baseDelay;
  for (const step of steps) {
    totalDelay += step.delay;
    const d = totalDelay;
    setTimeout(() => {
      if (step.text) {
        invoke('send_input', { surfaceId, data: step.text });
      } else if (step.key && KEY_MAP[step.key.toLowerCase()]) {
        invoke('send_input', { surfaceId, data: KEY_MAP[step.key.toLowerCase()] });
      }
    }, d);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
