import * as tm from './terminal-manager.js';
import { refreshLayout, setupResizeHandler } from './layout.js';
import { showContextMenu } from './context-menu.js';
import { setupSettings, loadSettings, getSettings, setOnSettingsChange, setupWindowControls } from './settings.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

async function init() {
  // WebView2 기본 우클릭 메뉴 + 드래그앤드롭 비활성화
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // F11 풀스크린, F5 리프레시, Ctrl+Tab 포커스 순환
  let f11Pending = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      if (f11Pending) return;
      f11Pending = true;
      invoke('window_fullscreen').finally(() => {
        setTimeout(() => { f11Pending = false; }, 500);
      });
    }
    if (e.key === 'F5') {
      e.preventDefault();
      refreshLayout();
    }
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const ids = tm.getSurfaceIds();
      if (ids.length < 2) return;
      const current = tm.getFocusedId();
      const idx = ids.indexOf(current);
      const next = e.shiftKey
        ? ids[(idx - 1 + ids.length) % ids.length]
        : ids[(idx + 1) % ids.length];
      invoke('focus_pane', { surfaceId: next });
    }
  });
  // F5 레이아웃 리프레시 콜백
  tm.setOnRefreshLayout(() => refreshLayout());

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

  // 드래그앤드롭 → 파일 경로 붙여넣기
  listen('tauri://drag-drop', (event) => {
    const paths = event.payload?.paths;
    if (!paths || paths.length === 0) return;
    const focusedId = tm.getFocusedId();
    if (!focusedId) return;
    const text = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
    invoke('send_input', { surfaceId: focusedId, data: text });
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

  // 저장된 폰트 설정 적용
  tm.setAllFontFamily(getSettings().fontFamily);

  // Initial load
  await refreshLayout();

  // 설정 변경 콜백 등록
  setOnSettingsChange(async (settings) => {
    tm.setAllFontFamily(settings.fontFamily);
    const newCount = Math.min(Math.max(settings.activePanes || 4, 2), 4);
    if (currentPaneCount && newCount !== currentPaneCount) {
      await changeLayout(newCount);
      currentPaneCount = newCount;
    }
  });

  // activePanes 설정에 따라 분할 + autoCommand
  await setupSessions();
  currentPaneCount = Math.min(Math.max(getSettings().activePanes || 4, 2), 4);
}

// === Session Management ===

const SESSION_FOLDERS = ['session1', 'session2', 'session3', 'session4'];
let WORKSPACE_ROOT = '';
let currentPaneCount = 0;

async function setupSessions() {
  // workspace root 가져오기
  WORKSPACE_ROOT = await invoke('get_workspace_root');

  const { activePanes } = getSettings();
  const paneCount = Math.min(Math.max(activePanes || 4, 2), 4);
  const folders = SESSION_FOLDERS.slice(0, paneCount);

  // 세션 폴더 자동 생성
  for (const folder of folders) {
    try { await invoke('write_file', { path: `${WORKSPACE_ROOT}\\${folder}\\.keep`, content: '' }); } catch {}
  }

  // activePanes에 따라 분할 (각 레이아웃은 독립적)
  if (paneCount === 2) {
    // 좌/우
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(500);
  } else if (paneCount === 3) {
    // 좌/중/우 균등 3등분
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(300);
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('split_pane', { direction: 'vertical' });
    await invoke('set_split_ratio', { path: [], ratio: 0.333 });
    await refreshLayout();
    await sleep(500);
  } else if (paneCount === 4) {
    // 2x2 그리드
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(300);
    // 좌측 horizontal split
    await invoke('focus_direction', { direction: 'left' });
    await sleep(100);
    await invoke('split_pane', { direction: 'horizontal' });
    await refreshLayout();
    await sleep(300);
    // 우측 horizontal split
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('split_pane', { direction: 'horizontal' });
    await refreshLayout();
    await sleep(500);
  }

  // 각 패널에 세션 폴더 cd + autoCommand
  const layout = await invoke('get_layout', { width: 200, height: 50 });
  const surfaceIds = layout.panes.map(p => p.surface_id);

  for (let i = 0; i < Math.min(surfaceIds.length, folders.length); i++) {
    const sid = surfaceIds[i];
    const meta = await loadSessionMeta(SESSION_FOLDERS[i]);
    sessionMetas[i] = meta;
    sessionSurfaceMap[i] = sid;
    const sessionPath = meta.folderPath || `${WORKSPACE_ROOT}\\${SESSION_FOLDERS[i]}`;
    sessionPaths[i] = sessionPath;

    // 타이틀 + 폰트 크기 설정
    tm.setTitle(sid, sessionPath);
    if (meta.fontSize) tm.setFontSize(sid, meta.fontSize);

    // 컨텍스트 메뉴 연결
    const titleBar = tm.getTitleBar(sid);
    if (titleBar) {
      const idx = i;
      titleBar.addEventListener('contextmenu', (e) => {
        const m = sessionMetas[idx] || {};
        showContextMenu(e, sid, idx, m, {
          onStop: () => {
            invoke('send_input', { surfaceId: sid, data: '\x03' });
            setTimeout(() => invoke('send_input', { surfaceId: sid, data: '\x03' }), 200);
          },
          onStart: async () => {
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${sessionPaths[idx]}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onRestart: async () => {
            await invoke('kill_pty', { surfaceId: sid });
            await sleep(500);
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${sessionPaths[idx]}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onFolderChange: async (newPath) => {
            sessionPaths[idx] = newPath;
            tm.setTitle(sid, newPath);
            await invoke('kill_pty', { surfaceId: sid });
            await sleep(500);
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${newPath}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onMetaSave: saveSessionMeta,
        }, tm.isOff(sid));
      });
    }

    // cd + autoCommand
    const cdCmd = `cd /d "${sessionPath}"\r`;
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

async function changeLayout(newCount) {
  // 첫 번째 pane만 유지, 나머지 닫고 새로 분할
  const layout = await invoke('get_layout', { width: 200, height: 50 });
  const currentIds = layout.panes.map(p => p.surface_id);

  // 첫 번째 빼고 전부 닫기
  for (let i = currentIds.length - 1; i >= 1; i--) {
    await invoke('close_pane', { surfaceId: currentIds[i] });
    tm.destroyTerminal(currentIds[i]);
    delete sessionMetas[i];
    delete sessionSurfaceMap[i];
  }
  await refreshLayout();
  await sleep(300);

  const folders = SESSION_FOLDERS.slice(0, newCount);

  // setupSessions와 동일한 분할 로직 (각 레이아웃은 독립적)
  if (newCount === 2) {
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(300);
  } else if (newCount === 3) {
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(300);
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('split_pane', { direction: 'vertical' });
    await invoke('set_split_ratio', { path: [], ratio: 0.333 });
    await refreshLayout();
    await sleep(300);
  } else if (newCount === 4) {
    await invoke('split_pane', { direction: 'vertical' });
    await refreshLayout();
    await sleep(300);
    await invoke('focus_direction', { direction: 'left' });
    await sleep(100);
    await invoke('split_pane', { direction: 'horizontal' });
    await refreshLayout();
    await sleep(300);
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('focus_direction', { direction: 'right' });
    await sleep(100);
    await invoke('split_pane', { direction: 'horizontal' });
    await refreshLayout();
    await sleep(300);
  }

  // 새 pane들에 세션 설정 (첫 번째는 유지)
  const newLayout = await invoke('get_layout', { width: 200, height: 50 });
  const surfaceIds = newLayout.panes.map(p => p.surface_id);
  sessionSurfaceMap[0] = surfaceIds[0];

  for (let i = 1; i < Math.min(surfaceIds.length, folders.length); i++) {
    const sid = surfaceIds[i];
    const folder = folders[i];
    try { await invoke('write_file', { path: `${WORKSPACE_ROOT}\\${folder}\\.keep`, content: '' }); } catch {}
    const meta = await loadSessionMeta(folder);
    sessionMetas[i] = meta;
    sessionSurfaceMap[i] = sid;
    const sessionPath = meta.folderPath || `${WORKSPACE_ROOT}\\${folder}`;
    sessionPaths[i] = sessionPath;

    tm.setTitle(sid, sessionPath);
    if (meta.fontSize) tm.setFontSize(sid, meta.fontSize);

    const titleBar = tm.getTitleBar(sid);
    if (titleBar) {
      const idx = i;
      titleBar.addEventListener('contextmenu', (e) => {
        const m = sessionMetas[idx] || {};
        showContextMenu(e, sid, idx, m, {
          onStop: () => {
            invoke('send_input', { surfaceId: sid, data: '\x03' });
            setTimeout(() => invoke('send_input', { surfaceId: sid, data: '\x03' }), 200);
          },
          onStart: async () => {
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${sessionPaths[idx]}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onRestart: async () => {
            await invoke('kill_pty', { surfaceId: sid });
            await sleep(500);
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${sessionPaths[idx]}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onFolderChange: async (newPath) => {
            sessionPaths[idx] = newPath;
            tm.setTitle(sid, newPath);
            await invoke('kill_pty', { surfaceId: sid });
            await sleep(500);
            await invoke('restart_pty', { surfaceId: sid });
            tm.setOff(sid, false);
            const cdCmd = `cd /d "${newPath}"\r`;
            await invoke('send_input', { surfaceId: sid, data: cdCmd });
            const meta = sessionMetas[idx] || {};
            if (meta.autoCommand) {
              await sleep(500);
              await invoke('send_input', { surfaceId: sid, data: meta.autoCommand + '\r' });
            }
          },
          onMetaSave: saveSessionMeta,
        }, tm.isOff(sid));
      });
    }

    const cdCmd = `cd /d "${sessionPath}"\r`;
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
const sessionPaths = {};

async function saveSessionMeta(sessionIndex, meta) {
  const folder = SESSION_FOLDERS[sessionIndex];
  const path = `${WORKSPACE_ROOT}\\${folder}\\session.meta.json`;
  sessionMetas[sessionIndex] = meta;
  // 타이틀 업데이트
  const sid = sessionSurfaceMap[sessionIndex];
  if (sid) tm.setTitle(sid, sessionPaths[sessionIndex] || `${WORKSPACE_ROOT}\\${folder}`);
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
