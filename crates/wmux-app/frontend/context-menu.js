const { invoke } = window.__TAURI__.core;

let currentMenu = null;
let currentEditPanel = null;

const KEY_OPTIONS = ['enter', 'tab', 'up', 'down', 'left', 'right', 'escape', 'backspace', 'space'];

export function showContextMenu(e, surfaceId, sessionIndex, meta, callbacks) {
  e.preventDefault();
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  // Stop / Start
  if (meta._isRunning !== false) {
    menu.appendChild(makeItem('Stop', 'stop', () => { callbacks.onStop(); closeMenu(); }));
  } else {
    menu.appendChild(makeItem('Start', 'start', () => { callbacks.onStart(); closeMenu(); }));
  }
  menu.appendChild(makeItem('Restart', '', () => { callbacks.onRestart(); closeMenu(); }));
  menu.appendChild(makeSep());

  // 실행 커맨드
  const cmdLabel = meta.autoCommand || '(없음)';
  menu.appendChild(makeItem('실행 커맨드', cmdLabel, () => {
    closeMenu();
    showAutoCommandEditor(e, sessionIndex, meta, callbacks.onMetaSave);
  }));

  // 매크로 설정
  const macroLabel = meta.postMacro?.length > 0
    ? `${meta.postMacro.length} steps ${meta.postMacroEnabled !== false ? 'ON' : 'OFF'}`
    : '(없음)';
  menu.appendChild(makeItem('매크로 설정', macroLabel, () => {
    closeMenu();
    showMacroEditor(e, sessionIndex, meta, callbacks.onMetaSave);
  }));

  document.body.appendChild(menu);
  currentMenu = menu;

  // 뷰포트 밖으로 안 나가게
  requestAnimationFrame(() => clampToViewport(menu));

  // 바깥 클릭 시 닫기
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
  }, 10);
}

function showAutoCommandEditor(e, sessionIndex, meta, onSave) {
  const panel = document.createElement('div');
  panel.className = 'ctx-menu ctx-edit';
  panel.style.left = e.clientX + 'px';
  panel.style.top = e.clientY + 'px';
  panel.onmousedown = ev => ev.stopPropagation();

  panel.innerHTML = `
    <div class="ctx-edit-header">실행 커맨드</div>
    <div class="ctx-edit-body">
      <input type="text" class="ctx-input" value="${escHtml(meta.autoCommand || '')}" placeholder="예: claude --continue">
      <div class="ctx-edit-buttons">
        <button class="ctx-btn cancel">취소</button>
        <button class="ctx-btn save">저장</button>
      </div>
    </div>
  `;

  const input = panel.querySelector('input');
  panel.querySelector('.cancel').onclick = () => closeEditPanel();
  panel.querySelector('.save').onclick = () => {
    meta.autoCommand = input.value;
    onSave(sessionIndex, meta);
    closeEditPanel();
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') panel.querySelector('.save').click();
    if (ev.key === 'Escape') closeEditPanel();
  };

  document.body.appendChild(panel);
  currentEditPanel = panel;
  requestAnimationFrame(() => { clampToViewport(panel); input.focus(); });

  setTimeout(() => document.addEventListener('mousedown', onOutsideEditClick), 10);
}

function showMacroEditor(e, sessionIndex, meta, onSave) {
  if (!meta.postMacro) meta.postMacro = [];
  if (meta.postMacroEnabled === undefined) meta.postMacroEnabled = true;

  const panel = document.createElement('div');
  panel.className = 'ctx-menu ctx-edit ctx-macro';
  panel.style.left = e.clientX + 'px';
  panel.style.top = e.clientY + 'px';
  panel.onmousedown = ev => ev.stopPropagation();

  function render() {
    const enabledClass = meta.postMacroEnabled ? 'on' : 'off';
    const enabledText = meta.postMacroEnabled ? 'ON' : 'OFF';

    let stepsHtml = '';
    meta.postMacro.forEach((step, idx) => {
      const isKey = step.key !== undefined;
      stepsHtml += `
        <div class="macro-step" data-idx="${idx}">
          <span class="step-num">${idx + 1}</span>
          <button class="step-type">${isKey ? 'KEY' : 'TXT'}</button>
          ${isKey
            ? `<select class="step-value">${KEY_OPTIONS.map(k => `<option value="${k}" ${step.key === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`
            : `<input type="text" class="step-value" value="${escHtml(step.text || '')}" placeholder="텍스트">`
          }
          <input type="number" class="step-delay" value="${step.delay}" title="delay (ms)">
          <span class="step-ms">ms</span>
          <button class="step-remove">×</button>
        </div>
      `;
    });

    panel.innerHTML = `
      <div class="ctx-edit-header">
        <span>매크로 설정</span>
        <button class="toggle-btn ${enabledClass}">${enabledText}</button>
      </div>
      <div class="ctx-edit-body">
        ${meta.postMacro.length === 0 ? '<div class="macro-empty">매크로 스텝이 없습니다</div>' : ''}
        <div class="macro-steps">${stepsHtml}</div>
        <button class="ctx-btn add-step">+ 스텝 추가</button>
        <div class="ctx-edit-buttons">
          <button class="ctx-btn cancel">취소</button>
          <button class="ctx-btn save">저장</button>
        </div>
      </div>
    `;

    // 이벤트 바인딩
    panel.querySelector('.toggle-btn').onclick = () => {
      meta.postMacroEnabled = !meta.postMacroEnabled;
      render();
    };
    panel.querySelector('.add-step').onclick = () => {
      meta.postMacro.push({ text: '', delay: 500 });
      render();
    };
    panel.querySelector('.cancel').onclick = () => closeEditPanel();
    panel.querySelector('.save').onclick = () => {
      // 입력값 수집
      panel.querySelectorAll('.macro-step').forEach((el, idx) => {
        const step = meta.postMacro[idx];
        if (step.key !== undefined) {
          step.key = el.querySelector('.step-value').value;
        } else {
          step.text = el.querySelector('.step-value').value;
        }
        step.delay = parseInt(el.querySelector('.step-delay').value) || 0;
      });
      meta.postMacro = meta.postMacro.filter(s => s.text || s.key);
      onSave(sessionIndex, meta);
      closeEditPanel();
    };

    panel.querySelectorAll('.step-type').forEach((btn, idx) => {
      btn.onclick = () => {
        const step = meta.postMacro[idx];
        if (step.key !== undefined) {
          delete step.key;
          step.text = '';
        } else {
          delete step.text;
          step.key = 'enter';
        }
        render();
      };
    });

    panel.querySelectorAll('.step-remove').forEach((btn, idx) => {
      btn.onclick = () => {
        meta.postMacro.splice(idx, 1);
        render();
      };
    });

    requestAnimationFrame(() => clampToViewport(panel));
  }

  render();
  document.body.appendChild(panel);
  currentEditPanel = panel;

  setTimeout(() => document.addEventListener('mousedown', onOutsideEditClick), 10);
}

function makeItem(label, hint, onclick) {
  const item = document.createElement('div');
  item.className = 'ctx-item' + (label === 'Stop' ? ' stop' : label === 'Start' ? ' start' : '');
  item.innerHTML = `<span>${label}</span>${hint ? `<span class="ctx-hint">${escHtml(hint)}</span>` : ''}`;
  item.onclick = onclick;
  return item;
}

function makeSep() {
  const sep = document.createElement('div');
  sep.className = 'ctx-sep';
  return sep;
}

function clampToViewport(el) {
  const rect = el.getBoundingClientRect();
  if (rect.right > window.innerWidth) el.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) el.style.top = (window.innerHeight - rect.height - 4) + 'px';
  if (rect.left < 0) el.style.left = '4px';
  if (rect.top < 0) el.style.top = '4px';
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function onOutsideClick(e) {
  if (currentMenu && !currentMenu.contains(e.target)) closeMenu();
}

function onOutsideEditClick(e) {
  if (currentEditPanel && !currentEditPanel.contains(e.target)) closeEditPanel();
}

function closeMenu() {
  if (currentMenu) { currentMenu.remove(); currentMenu = null; }
  document.removeEventListener('mousedown', onOutsideClick);
}

function closeEditPanel() {
  if (currentEditPanel) { currentEditPanel.remove(); currentEditPanel = null; }
  document.removeEventListener('mousedown', onOutsideEditClick);
}
