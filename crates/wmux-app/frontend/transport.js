/**
 * Transport abstraction layer.
 * Tauri mode: delegates to window.__TAURI__ IPC.
 * Web mode: uses WebSocket JSON-RPC to remote server.
 */

export const IS_TAURI = !!(window.__TAURI__);

// --- WebSocket client (web mode only) ---

let ws = null;
let wsPending = new Map();
let wsNextId = 1;
let wsEventListeners = new Map(); // event -> Set<callback>
let wsReconnectTimer = null;
let wsConnected = false;
let wsConnectPromise = null;

function wsConnect() {
  if (wsConnectPromise) return wsConnectPromise;

  wsConnectPromise = new Promise((resolve) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      wsConnected = true;
      wsConnectPromise = null;
      resolve();
    };

    ws.onerror = () => {
      wsConnectPromise = null;
      resolve(); // don't block — reconnect will retry
    };

    ws.onclose = () => {
      wsConnected = false;
      wsConnectPromise = null;
      // Reject all pending
      for (const [, p] of wsPending) {
        p.reject(new Error('disconnected'));
      }
      wsPending.clear();
      wsScheduleReconnect();
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.event) {
        wsHandleEvent(msg);
      } else {
        const p = wsPending.get(msg.id);
        if (p) {
          wsPending.delete(msg.id);
          msg.ok ? p.resolve(msg.result) : p.reject(msg.error);
        }
      }
    };
  });

  return wsConnectPromise;
}

function wsScheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(async () => {
    wsReconnectTimer = null;
    await wsConnect();
  }, 3000);
}

function wsHandleEvent(msg) {
  // Map WebSocket events to Tauri-style event payloads
  let eventName = msg.event;
  let payload = {};

  if (eventName === 'pty-output') {
    payload = { surface_id: msg.surface_id, data: msg.data };
  } else if (eventName === 'pty-exit') {
    payload = { surface_id: msg.surface_id };
  } else if (eventName === 'layout-changed') {
    payload = {};
  } else if (eventName === 'focus-changed') {
    payload = { surface_id: msg.surface_id };
  }

  const listeners = wsEventListeners.get(eventName);
  if (listeners) {
    for (const cb of listeners) {
      cb({ payload });
    }
  }
}

function wsInvoke(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Not connected'));
    }
    const id = String(wsNextId++);
    wsPending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

// --- Command mapping: Tauri command name → WebSocket RPC method ---

const COMMAND_MAP = {
  // PTY I/O
  'send_input': (args) => wsInvoke('surface.send_text', { id: args.surfaceId, text: args.data }),
  'resize_terminal': (args) => wsInvoke('surface.resize', { id: args.surfaceId, cols: args.cols, rows: args.rows }),
  'kill_pty': (args) => wsInvoke('surface.kill', { id: args.surfaceId }),
  'restart_pty': (args) => wsInvoke('surface.restart', { id: args.surfaceId }),

  // Layout & Pane
  'get_layout': (args) => wsInvoke('layout.get', { width: args.width, height: args.height }),
  'split_pane': (args) => wsInvoke('surface.split', { direction: args.direction }),
  'close_pane': (args) => wsInvoke('surface.close', { id: args.surfaceId }),
  'focus_pane': (args) => wsInvoke('surface.focus', { id: args.surfaceId }),
  'focus_direction': (args) => wsInvoke('surface.focus_direction', { direction: args.direction }),
  'set_split_ratio': (args) => wsInvoke('layout.set_ratio', { path: args.path, ratio: args.ratio }),
  'get_surface_id': () => wsInvoke('surface.focused', {}),

  // File I/O
  'read_file': (args) => wsInvoke('fs.read', { path: args.path }),
  'write_file': (args) => wsInvoke('fs.write', { path: args.path, content: args.content }),

  // Config
  'get_workspace_root': () => wsInvoke('config.workspace_root', {}),
  'get_remote_info': () => Promise.resolve({ pin: '', lan_ip: location.hostname, port: location.port || '9784', tailscale_ip: null }),

  // Window controls (no-op in web mode)
  'window_minimize': () => Promise.resolve(),
  'window_maximize': () => Promise.resolve(),
  'window_close': () => Promise.resolve(),
  'window_start_drag': () => Promise.resolve(),
  'window_fullscreen': () => Promise.resolve(),
  'window_devtools': () => Promise.resolve(),

  // Clipboard (limited in web mode)
  'get_clipboard_files': () => Promise.resolve([]),
};

// --- Public API ---

/**
 * invoke(command, args) — same signature as Tauri's invoke().
 * In Tauri mode: delegates directly.
 * In web mode: maps to WebSocket RPC.
 */
export async function invoke(command, args) {
  if (IS_TAURI) {
    return window.__TAURI__.core.invoke(command, args);
  }

  const mapper = COMMAND_MAP[command];
  if (mapper) {
    return mapper(args || {});
  }
  // Fallback: try direct RPC with command name
  return wsInvoke(command, args || {});
}

/**
 * listen(event, callback) — same signature as Tauri's listen().
 * Returns an unlisten function.
 */
export function listen(event, callback) {
  if (IS_TAURI) {
    return window.__TAURI__.event.listen(event, callback);
  }

  // Web mode: register in local event map
  if (!wsEventListeners.has(event)) {
    wsEventListeners.set(event, new Set());
  }
  wsEventListeners.get(event).add(callback);

  // Return unlisten function (matching Tauri's async pattern)
  return Promise.resolve(() => {
    const set = wsEventListeners.get(event);
    if (set) set.delete(callback);
  });
}

/**
 * Initialize transport. Call once at app startup.
 * In Tauri mode: no-op.
 * In web mode: connects WebSocket.
 */
export async function initTransport() {
  if (IS_TAURI) return;
  await wsConnect();
}

/**
 * Check if WebSocket is connected (web mode).
 */
export function isConnected() {
  if (IS_TAURI) return true;
  return wsConnected;
}
