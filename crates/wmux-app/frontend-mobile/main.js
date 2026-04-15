import { WsClient } from './ws-client.js';
import * as term from './terminal.js';

let client = null;
let surfaces = [];
let activeIdx = 0;
const exitedSurfaces = new Set();

// Auth
document.getElementById('pin-submit').addEventListener('click', doAuth);
document.getElementById('pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAuth();
});

async function doAuth() {
  const pin = document.getElementById('pin-input').value.trim();
  if (!pin) return;

  const host = location.hostname;
  const port = location.port || '9784';
  const url = `ws://${host}:${port}/ws?token=${pin}`;

  client = new WsClient(url);

  client.onPtyOutput = (surfaceId, data) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    term.writeOutput(surfaceId, bytes);
  };

  client.onPtyExit = (surfaceId) => {
    exitedSurfaces.add(surfaceId);
    updateTabs();
  };

  client.onOpen = () => {
    document.getElementById('connection-status').textContent = 'connected';
    document.getElementById('connection-status').style.color = '#859900';
  };

  client.onClose = () => {
    document.getElementById('connection-status').textContent = 'disconnected';
    document.getElementById('connection-status').style.color = '#dc322f';
  };

  try {
    await client.connect();
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    await loadSessions();
  } catch {
    document.getElementById('auth-error').textContent = 'PIN이 틀렸거나 연결할 수 없습니다';
  }
}

async function loadSessions() {
  const result = await client.invoke('surface.list', {});
  surfaces = result.surfaces.map(s => s.id);

  // Create terminals for each surface
  for (const sid of surfaces) {
    term.createTerminal(sid);
  }

  // Show first terminal to get accurate size, then load screen states
  if (surfaces.length > 0) {
    term.showTerminal(surfaces[0]);
    await new Promise(r => setTimeout(r, 100)); // let fitAddon measure
  }

  for (const sid of surfaces) {
    try {
      const size = term.getTermSize(sid);
      const out = await client.invoke('surface.screen_state', {
        id: sid, cols: size.cols, rows: size.rows
      });
      if (out.data) {
        const bytes = Uint8Array.from(atob(out.data), c => c.charCodeAt(0));
        term.writeOutput(sid, bytes);
      }
    } catch {}
  }

  // Setup input forwarding
  term.setOnInput((surfaceId, data) => {
    client.invoke('surface.send_text', { id: surfaceId, text: data }).catch(() => {});
  });

  // Setup tabs
  buildTabs();
  switchTab(0);

  // Special key buttons
  document.querySelectorAll('#special-keys button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!surfaces[activeIdx]) return;
      client.invoke('surface.send_text', { id: surfaces[activeIdx], text: btn.dataset.key }).catch(() => {});
    });
  });

  // Handle resize
  window.addEventListener('resize', () => {
    term.fitAll();
  });
  // Visual viewport resize (mobile keyboard)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      term.fitAll();
    });
  }
}

function buildTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  surfaces.forEach((sid, i) => {
    const tab = document.createElement('button');
    tab.className = 'tab' + (i === activeIdx ? ' active' : '');
    tab.textContent = `S${i + 1}`;
    tab.addEventListener('click', () => switchTab(i));
    bar.appendChild(tab);
  });
}

function updateTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab, i) => {
    tab.classList.toggle('active', i === activeIdx);
    tab.classList.toggle('exited', exitedSurfaces.has(surfaces[i]));
  });
}

function switchTab(idx) {
  activeIdx = idx;
  const sid = surfaces[idx];
  term.showTerminal(sid);
  document.getElementById('session-title').textContent = `Session ${idx + 1}`;
  updateTabs();
}

// Swipe gesture for tab switching
let touchStartX = 0;
document.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) < 80) return;
  if (dx < 0 && activeIdx < surfaces.length - 1) {
    switchTab(activeIdx + 1);
  } else if (dx > 0 && activeIdx > 0) {
    switchTab(activeIdx - 1);
  }
});
