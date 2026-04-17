/**
 * CLAUDE.md editor module.
 * Opens a modal to edit CLAUDE.md from the project root.
 */
import { invoke } from './transport.js';

let currentPath = '';

export async function openClaudeEditor(projectPath) {
  currentPath = projectPath ? `${projectPath}\\CLAUDE.md` : '';
  if (!currentPath) {
    try {
      const root = await invoke('get_workspace_root');
      currentPath = `${root}\\CLAUDE.md`;
    } catch {
      return;
    }
  }

  let content = '';
  try {
    content = await invoke('read_file', { path: currentPath });
  } catch {
    // File doesn't exist yet — start empty
  }

  showEditor(content);
}

function showEditor(content) {
  let overlay = document.getElementById('claude-editor-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'claude-editor-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '250';
  overlay.innerHTML = `
    <div class="modal-box" style="width:600px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-header">
        <span>CLAUDE.md</span>
        <span style="font-size:10px;color:var(--text);margin-left:8px">${currentPath}</span>
        <button id="claude-editor-close">X</button>
      </div>
      <div class="modal-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column;padding:8px">
        <textarea id="claude-editor-textarea" style="
          flex:1;width:100%;resize:none;
          background:var(--bg);color:var(--text-bright);
          border:1px solid var(--border);border-radius:4px;
          font-family:'Cascadia Mono',Consolas,monospace;
          font-size:12px;padding:8px;outline:none;
          tab-size:2;
        ">${escapeHtml(content)}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
          <button class="opt-btn" id="claude-editor-cancel">Cancel</button>
          <button class="opt-btn active" id="claude-editor-save">Save</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('claude-editor-close').onclick = () => overlay.remove();
  document.getElementById('claude-editor-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('claude-editor-save').onclick = async () => {
    const text = document.getElementById('claude-editor-textarea').value;
    try {
      await invoke('write_file', { path: currentPath, content: text });
      overlay.remove();
    } catch (e) {
      alert('Save failed: ' + e);
    }
  };

  // Tab key inserts spaces instead of changing focus
  document.getElementById('claude-editor-textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 2;
    }
  });

  document.getElementById('claude-editor-textarea').focus();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
