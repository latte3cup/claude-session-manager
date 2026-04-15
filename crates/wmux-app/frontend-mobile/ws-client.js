export class WsClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.onPtyOutput = null;
    this.onPtyExit = null;
    this.onOpen = null;
    this.onClose = null;
    this._reconnectTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        if (this.onOpen) this.onOpen();
        resolve();
      };

      this.ws.onerror = () => reject(new Error('Connection failed'));

      this.ws.onclose = () => {
        if (this.onClose) this.onClose();
        this._scheduleReconnect();
      };

      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event) {
          this._handleEvent(msg);
        } else {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            msg.ok ? p.resolve(msg.result) : p.reject(msg.error);
          }
        }
      };
    });
  }

  _handleEvent(msg) {
    if (msg.event === 'pty-output' && this.onPtyOutput) {
      this.onPtyOutput(msg.surface_id, msg.data);
    } else if (msg.event === 'pty-exit' && this.onPtyExit) {
      this.onPtyExit(msg.surface_id);
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this._scheduleReconnect();
      }
    }, 3000);
  }

  invoke(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'));
      }
      const id = String(this.nextId++);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = -1; // prevent reconnect
    if (this.ws) this.ws.close();
  }
}
