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
  document.getElementById('btn-close')?.addEventListener('click', (e) => { e.stopPropagation(); invoke('window_close'); });
}

export function setupSettings() {
  const modal = document.getElementById('settings-modal');
  const btnSettings = document.getElementById('btn-settings');
  const btnClose = document.getElementById('settings-close');

  btnSettings.addEventListener('click', () => { modal.style.display = 'flex'; renderOptions(); });
  btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  // Header hover
  const header = document.getElementById('app-header');
  const trigger = document.getElementById('header-trigger');
  let hideTimeout;
  const show = () => { clearTimeout(hideTimeout); header.classList.add('visible'); };
  const hide = () => { hideTimeout = setTimeout(() => header.classList.remove('visible'), 400); };
  trigger.addEventListener('mouseenter', show);
  header.addEventListener('mouseenter', show);
  header.addEventListener('mouseleave', hide);
}

function renderOptions() {
  const layoutContainer = document.getElementById('layout-options');
  const fontContainer = document.getElementById('font-options');

  layoutContainer.innerHTML = '';
  LAYOUT_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn' + (appSettings.activePanes === opt.value ? ' active' : '');
    btn.textContent = opt.label;
    btn.onclick = () => {
      appSettings.activePanes = opt.value;
      saveSettings();
      renderOptions();
      if (onSettingsChange) onSettingsChange(appSettings);
    };
    layoutContainer.appendChild(btn);
  });

  fontContainer.innerHTML = '';
  FONT_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn' + (appSettings.fontFamily === opt.value ? ' active' : '');
    btn.style.fontFamily = opt.value;
    btn.innerHTML = `${opt.label}<span class="font-preview">가나다 ABC 123</span>`;
    btn.onclick = () => {
      appSettings.fontFamily = opt.value;
      saveSettings();
      renderOptions();
      if (onSettingsChange) onSettingsChange(appSettings);
    };
    fontContainer.appendChild(btn);
  });
}
