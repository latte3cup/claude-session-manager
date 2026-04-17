/**
 * Mobile UI module.
 * Activated when viewport width <= 767px.
 * Provides: tab bar, special keys toolbar, single-pane mode.
 */
import * as tm from './terminal-manager.js';
import { invoke } from './transport.js';

let surfaceIds = [];
let activeIdx = 0;
let mobileActive = false;
let lastSentSize = { cols: 0, rows: 0 };

const SPECIAL_KEYS = [
  { label: 'Ctrl+C', key: '\x03' },
  { label: 'Tab', key: '\t' },
  { label: 'Up', key: '\x1b[A' },
  { label: 'Down', key: '\x1b[B' },
  { label: 'Esc', key: '\x1b' },
  { label: 'Clear', key: 'clear\r' },
];

export function isMobileViewport() {
  return window.innerWidth <= 767;
}

export function initMobileUI() {
  if (!isMobileViewport()) return;
  mobileActive = true;

  // Build tab bar
  const tabBar = document.getElementById('mobile-tab-bar');
  if (tabBar) tabBar.style.display = 'flex';

  // Build special keys
  const keysBar = document.getElementById('mobile-special-keys');
  if (keysBar) {
    keysBar.style.display = 'flex';
    keysBar.innerHTML = '';
    for (const sk of SPECIAL_KEYS) {
      const btn = document.createElement('button');
      btn.textContent = sk.label;
      btn.addEventListener('click', () => {
        const sid = surfaceIds[activeIdx];
        if (sid) invoke('send_input', { surfaceId: sid, data: sk.key });
      });
      keysBar.appendChild(btn);
    }
  }

  // Hide pane-area split layout, show single terminal
  document.getElementById('pane-area')?.classList.add('mobile-mode');

  // Swipe gesture
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 80) return;
    if (dx < 0 && activeIdx < surfaceIds.length - 1) {
      switchTab(activeIdx + 1);
    } else if (dx > 0 && activeIdx > 0) {
      switchTab(activeIdx - 1);
    }
  });

  // Resize handler — refit on keyboard open/close
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      tm.getTerminal(surfaceIds[activeIdx])?.fitAddon.fit();
    });
  }
}

export function updateSurfaces(ids) {
  surfaceIds = ids;
  if (!mobileActive) return;
  buildTabs();
  if (ids.length > 0) switchTab(0);
}

function buildTabs() {
  const bar = document.getElementById('mobile-tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  surfaceIds.forEach((sid, i) => {
    const tab = document.createElement('button');
    tab.className = 'mobile-tab' + (i === activeIdx ? ' active' : '');
    tab.textContent = `S${i + 1}`;
    tab.addEventListener('click', () => switchTab(i));
    bar.appendChild(tab);
  });
}

function switchTab(idx) {
  activeIdx = idx;
  const sid = surfaceIds[idx];
  if (!sid) return;

  // Show only active terminal
  for (const [id, entry] of [...(tm.getSurfaceIds().map(id => [id, tm.getTerminal(id)]))]) {
    if (entry) {
      entry.container.style.display = id === sid ? '' : 'none';
      if (id === sid) {
        // Fill entire pane area in mobile mode
        Object.assign(entry.container.style, {
          left: '0', top: '0', width: '100%', height: '100%'
        });
        entry.fitAddon.fit();
        entry.term.focus();
      }
    }
  }

  // Sync PTY size on tab switch
  syncSize(sid);

  // Update tab bar
  const tabs = document.querySelectorAll('.mobile-tab');
  tabs.forEach((tab, i) => tab.classList.toggle('active', i === activeIdx));
}

function syncSize(sid) {
  const entry = tm.getTerminal(sid);
  if (!entry) return;
  const cols = entry.term.cols;
  const rows = entry.term.rows;
  if (cols !== lastSentSize.cols || rows !== lastSentSize.rows) {
    lastSentSize = { cols, rows };
    invoke('resize_terminal', { surfaceId: sid, cols, rows }).catch(() => {});
  }
}

export function isActive() { return mobileActive; }
