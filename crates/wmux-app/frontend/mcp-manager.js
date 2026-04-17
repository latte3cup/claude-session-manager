/**
 * MCP Server Manager module.
 * Read/write ~/.claude/mcp_settings.json via GUI.
 */
import { invoke } from './transport.js';

function getMcpSettingsPath() {
  const home = typeof process !== 'undefined' ? process.env.USERPROFILE : '';
  // Fallback: read from well-known path
  return `${home || 'C:\\Users\\' + (location.hostname || 'user')}\\.claude\\mcp_settings.json`;
}

export async function openMcpManager() {
  // Try to detect home dir via workspace root parent
  let mcpPath = '';
  try {
    const root = await invoke('get_workspace_root');
    // Derive home from workspace root (e.g. C:\Users\user\Claude Workspace → C:\Users\user)
    const parts = root.split('\\');
    const home = parts.slice(0, 3).join('\\');
    mcpPath = `${home}\\.claude\\mcp_settings.json`;
  } catch {
    mcpPath = getMcpSettingsPath();
  }

  let config = { mcpServers: {} };
  try {
    const text = await invoke('read_file', { path: mcpPath });
    config = JSON.parse(text);
    if (!config.mcpServers) config.mcpServers = {};
  } catch {
    // File doesn't exist — start empty
  }

  showManager(mcpPath, config);
}

function showManager(mcpPath, config) {
  let overlay = document.getElementById('mcp-manager-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'mcp-manager-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '250';

  const servers = config.mcpServers || {};
  const serverEntries = Object.entries(servers);

  let serversHtml = '';
  if (serverEntries.length === 0) {
    serversHtml = '<div style="font-size:11px;color:var(--text);padding:8px 0">No MCP servers configured</div>';
  } else {
    serversHtml = serverEntries.map(([name, srv]) => {
      const cmd = srv.command || '';
      const args = (srv.args || []).join(' ');
      return `
        <div class="mcp-server-item" data-name="${name}">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;font-size:11px;color:var(--text-bright)">${name}</span>
            <span style="font-size:10px;color:var(--text)">${cmd} ${args}</span>
          </div>
          <button class="mcp-delete" data-name="${name}" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px">x</button>
        </div>`;
    }).join('');
  }

  overlay.innerHTML = `
    <div class="modal-box" style="width:480px">
      <div class="modal-header">
        <span>MCP Servers</span>
        <button id="mcp-manager-close">X</button>
      </div>
      <div class="modal-body">
        <div id="mcp-server-list">${serversHtml}</div>
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px">
          <div style="font-size:10px;color:var(--text);margin-bottom:6px">Add Server</div>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <input id="mcp-add-name" class="ctx-input" placeholder="Name" style="flex:1">
            <input id="mcp-add-cmd" class="ctx-input" placeholder="Command" style="flex:2">
          </div>
          <input id="mcp-add-args" class="ctx-input" placeholder="Args (space-separated)" style="width:100%;margin-bottom:8px">
          <div style="display:flex;justify-content:flex-end">
            <button class="opt-btn active" id="mcp-add-btn">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('mcp-manager-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Delete buttons
  overlay.querySelectorAll('.mcp-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      delete config.mcpServers[name];
      await saveConfig(mcpPath, config);
      showManager(mcpPath, config); // re-render
    });
  });

  // Add button
  document.getElementById('mcp-add-btn').addEventListener('click', async () => {
    const name = document.getElementById('mcp-add-name').value.trim();
    const cmd = document.getElementById('mcp-add-cmd').value.trim();
    const argsStr = document.getElementById('mcp-add-args').value.trim();
    if (!name || !cmd) return;

    config.mcpServers[name] = {
      command: cmd,
      args: argsStr ? argsStr.split(/\s+/) : [],
    };
    await saveConfig(mcpPath, config);
    showManager(mcpPath, config); // re-render
  });
}

async function saveConfig(path, config) {
  try {
    await invoke('write_file', { path, content: JSON.stringify(config, null, 2) });
  } catch (e) {
    console.error('Failed to save MCP config:', e);
  }
}
