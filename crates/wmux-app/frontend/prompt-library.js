/**
 * Prompt Library module.
 * CRUD for saved prompts (SQLite), click to send to active session.
 */
import { invoke } from './transport.js';

let prompts = [];
let onSendPrompt = null;

export function setOnSendPrompt(cb) { onSendPrompt = cb; }

export async function openPromptLibrary() {
  await loadPrompts();
  showLibrary();
}

async function loadPrompts() {
  try {
    prompts = await invoke('db_get_prompts');
  } catch {
    prompts = [];
  }
}

function showLibrary() {
  let overlay = document.getElementById('prompt-library-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'prompt-library-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '250';

  let promptsHtml = '';
  if (prompts.length === 0) {
    promptsHtml = '<div style="font-size:11px;color:var(--text);padding:8px 0">No prompts saved</div>';
  } else {
    promptsHtml = prompts.map(p => `
      <div class="prompt-item" data-id="${p.id}">
        <div class="prompt-title">${escapeHtml(p.title)}</div>
        <div class="prompt-preview">${escapeHtml(p.content.substring(0, 80))}${p.content.length > 80 ? '...' : ''}</div>
        <div class="prompt-actions">
          <button class="prompt-send" data-id="${p.id}">Send</button>
          <button class="prompt-delete" data-id="${p.id}">x</button>
        </div>
      </div>
    `).join('');
  }

  overlay.innerHTML = `
    <div class="modal-box" style="width:500px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-header">
        <span>Prompt Library</span>
        <button id="prompt-lib-close">X</button>
      </div>
      <div class="modal-body" style="flex:1;overflow-y:auto">
        <div id="prompt-list">${promptsHtml}</div>
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
          <input id="prompt-new-title" class="ctx-input" placeholder="Title" style="width:100%;margin-bottom:6px">
          <textarea id="prompt-new-content" class="ctx-input" placeholder="Prompt content..." style="width:100%;height:60px;resize:vertical;margin-bottom:8px"></textarea>
          <div style="display:flex;justify-content:flex-end">
            <button class="opt-btn active" id="prompt-add-btn">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('prompt-lib-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Send buttons
  overlay.querySelectorAll('.prompt-send').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = prompts.find(p => String(p.id) === btn.dataset.id);
      if (prompt && onSendPrompt) {
        onSendPrompt(prompt.content);
        overlay.remove();
      }
    });
  });

  // Delete buttons
  overlay.querySelectorAll('.prompt-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      try {
        await invoke('db_delete_prompt', { id });
        await loadPrompts();
        showLibrary(); // re-render
      } catch {}
    });
  });

  // Add button
  document.getElementById('prompt-add-btn').addEventListener('click', async () => {
    const title = document.getElementById('prompt-new-title').value.trim();
    const content = document.getElementById('prompt-new-content').value.trim();
    if (!title || !content) return;
    try {
      await invoke('db_save_prompt', { title, content, category: '' });
      await loadPrompts();
      showLibrary(); // re-render
    } catch {}
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
