const { invoke } = window.__TAURI__.core;

let SETTINGS_PATH = '';

async function ensureSettingsPath() {
  if (!SETTINGS_PATH) {
    const root = await invoke('get_workspace_root');
    SETTINGS_PATH = `${root}\\app-settings.json`;
  }
}

const LAYOUT_OPTIONS = [
  { value: 2, label: '2 패널' },
  { value: 3, label: '3 패널' },
  { value: 4, label: '4 패널' },
];

const FONT_OPTIONS = [
  { value: "'Cascadia Code', 'Malgun Gothic', monospace", label: 'Cascadia Code' },
  { value: "'Cascadia Mono', 'Malgun Gothic', monospace", label: 'Cascadia Mono' },
  { value: "'Consolas', 'Malgun Gothic', monospace", label: 'Consolas' },
];

let appSettings = { activePanes: 4, fontFamily: "'Cascadia Code', 'Malgun Gothic', monospace" };
let pendingSettings = null; // 저장 전 임시 설정
let onSettingsChange = null;

export function setOnSettingsChange(callback) { onSettingsChange = callback; }
export function getSettings() { return appSettings; }

export async function loadSettings() {
  await ensureSettingsPath();
  try {
    const text = await invoke('read_file', { path: SETTINGS_PATH });
    appSettings = { ...appSettings, ...JSON.parse(text) };
  } catch {}
  return appSettings;
}

async function saveSettings() {
  await ensureSettingsPath();
  try {
    await invoke('write_file', { path: SETTINGS_PATH, content: JSON.stringify(appSettings, null, 2) });
  } catch {}
}

export function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', (e) => { e.stopPropagation(); invoke('window_minimize'); });
  document.getElementById('btn-maximize')?.addEventListener('click', (e) => { e.stopPropagation(); invoke('window_maximize'); });
  document.getElementById('btn-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirmModal('모든 세션이 종료됩니다.\n앱을 닫으시겠습니까?', () => invoke('window_close'));
  });

  const header = document.getElementById('app-header');
  header?.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    invoke('window_start_drag');
  });

  header?.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    invoke('window_maximize');
  });
}

export function setupSettings() {
  const modal = document.getElementById('settings-modal');
  const btnSettings = document.getElementById('btn-settings');
  const btnClose = document.getElementById('settings-close');

  const openModal = () => {
    pendingSettings = { ...appSettings };
    modal.style.display = 'flex';
    renderOptions();
    loadRemoteInfo();
  };

  btnSettings.addEventListener('click', openModal);
  btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  // Copy buttons
  document.getElementById('btn-copy-pin')?.addEventListener('click', () => {
    const pin = document.getElementById('remote-pin').textContent;
    navigator.clipboard.writeText(pin);
  });
  document.getElementById('btn-copy-lan')?.addEventListener('click', () => {
    const url = document.getElementById('remote-lan').textContent;
    navigator.clipboard.writeText(url);
  });
  document.getElementById('btn-copy-ts')?.addEventListener('click', () => {
    const url = document.getElementById('remote-ts').textContent;
    navigator.clipboard.writeText(url);
  });
}

async function loadRemoteInfo() {
  try {
    const info = await invoke('get_remote_info');
    document.getElementById('remote-pin').textContent = info.pin;
    document.getElementById('remote-lan').textContent = `http://${info.lan_ip}:${info.port}`;
    if (info.tailscale_ip) {
      document.getElementById('remote-ts').textContent = `http://${info.tailscale_ip}:${info.port}`;
      document.getElementById('remote-ts-row').style.display = '';
    } else {
      document.getElementById('remote-ts-row').style.display = 'none';
    }
    // Update header text
    document.getElementById('remote-header-info').textContent =
      `${info.lan_ip}:${info.port} PIN:${info.pin}`;
  } catch {}
}

// Load remote info into header on startup
export async function initRemoteHeader() {
  await loadRemoteInfo();
}

function renderOptions() {
  const layoutContainer = document.getElementById('layout-options');
  const fontContainer = document.getElementById('font-options');
  const saveContainer = document.getElementById('settings-save-area');

  // Layout 옵션 (클릭 시 임시 선택만)
  layoutContainer.innerHTML = '';
  LAYOUT_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn' + (pendingSettings.activePanes === opt.value ? ' active' : '');
    btn.textContent = opt.label;
    btn.onclick = () => {
      pendingSettings.activePanes = opt.value;
      renderOptions();
    };
    layoutContainer.appendChild(btn);
  });

  // Font 옵션 (클릭 시 임시 선택만)
  fontContainer.innerHTML = '';
  FONT_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn' + (pendingSettings.fontFamily === opt.value ? ' active' : '');
    btn.style.fontFamily = opt.value;
    btn.innerHTML = `${opt.label}<span class="font-preview">가나다 ABC 123</span>`;
    btn.onclick = () => {
      pendingSettings.fontFamily = opt.value;
      renderOptions();
    };
    fontContainer.appendChild(btn);
  });

  // DevTools 버튼
  saveContainer.innerHTML = '';
  const devBtn = document.createElement('button');
  devBtn.className = 'opt-btn';
  devBtn.textContent = 'DevTools';
  devBtn.style.fontSize = '11px';
  devBtn.onclick = () => invoke('window_devtools');
  saveContainer.appendChild(devBtn);

  // 저장 버튼 (변경 사항 있을 때만 활성화)
  const hasChanges = pendingSettings.activePanes !== appSettings.activePanes
    || pendingSettings.fontFamily !== appSettings.fontFamily;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn' + (hasChanges ? '' : ' disabled');
  saveBtn.textContent = '저장';
  saveBtn.disabled = !hasChanges;
  saveBtn.onclick = () => {
    if (!hasChanges) return;
    const layoutChanged = pendingSettings.activePanes !== appSettings.activePanes;
    if (layoutChanged) {
      showConfirmModal(
        '레이아웃을 변경하면 첫 번째를 제외한\n세션이 종료됩니다. 계속하시겠습니까?',
        () => applySettings()
      );
    } else {
      applySettings();
    }
  };
  saveContainer.appendChild(saveBtn);
}

function applySettings() {
  appSettings = { ...pendingSettings };
  saveSettings();
  if (onSettingsChange) onSettingsChange(appSettings);
  document.getElementById('settings-modal').style.display = 'none';
}

function showConfirmModal(message, onConfirm) {
  let overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '300';
  overlay.innerHTML = `
    <div class="modal-box" style="width:320px">
      <div class="modal-header">
        <span>확인</span>
      </div>
      <div class="modal-body">
        <p style="font-size:12px;color:var(--text-bright);margin:0 0 16px;white-space:pre-line">${message}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="opt-btn" id="confirm-cancel">취소</button>
          <button class="opt-btn active" id="confirm-ok">확인</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('confirm-cancel').onclick = () => overlay.remove();
  document.getElementById('confirm-ok').onclick = () => {
    overlay.remove();
    onConfirm();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
