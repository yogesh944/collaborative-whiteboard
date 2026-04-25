/* ═══════════════════════════════════════════════════
   Socket — Real-time sync via Socket.io
   ═══════════════════════════════════════════════════ */

class SocketManager {
  constructor(app) {
    this.app = app;
    this.socket = null;
    this.remoteElements = new Map(); // in-progress remote drawings
    this.lastCursorEmit = 0;
  }

  connect() {
    this.socket = io({ auth: { token: window.CB_TOKEN } });

    this.socket.on('connect_error', (err) => {
      if (err.message === 'Authentication required.' || err.message === 'Invalid or expired token.') {
        localStorage.removeItem('cb_token');
        localStorage.removeItem('cb_username');
        window.location.replace('/login.html');
      }
    });

    this.socket.on('init', (data) => {
      this.app.localUser = data.user;
      this.app.canvas.setElements(data.elements);
      this.app.updateUsers(data.users);
      this.app.showToast(`Connected as ${data.user.name}`);
    });

    this.socket.on('user-joined', (user) => {
      this.app.users.set(user.id, user);
      this.app.renderUsers();
      this.app.showToast(`${user.name} joined`);
    });

    this.socket.on('user-left', (userId) => {
      const user = this.app.users.get(userId);
      this.app.users.delete(userId);
      this.app.cursorManager.remove(userId);
      this.app.renderUsers();
      if (user) this.app.showToast(`${user.name} left`);
    });

    // ── Remote drawing ──
    this.socket.on('draw-start', (data) => {
      this.remoteElements.set(data.element?.id || data.id, {
        ...data.element || data,
        points: data.element?.points || [{ x: data.x, y: data.y }]
      });
    });

    this.socket.on('draw-move', (data) => {
      const el = this.remoteElements.get(data.id);
      if (el && el.points) {
        el.points.push({ x: data.x, y: data.y });
      }
    });

    this.socket.on('draw-end', (data) => {
      this.remoteElements.delete(data.element?.id);
      if (data.element) {
        this.app.canvas.addElement(data.element);
      }
    });

    this.socket.on('add-element', (element) => {
      this.app.canvas.addElement(element);
    });

    this.socket.on('undo', (data) => {
      this.app.canvas.removeElementById(data.elementId);
    });

    this.socket.on('redo', (data) => {
      if (data.element) {
        this.app.canvas.addElement(data.element);
      }
    });

    this.socket.on('clear', () => {
      this.app.canvas.clearAll();
      this.app.history.clear();
    });

    this.socket.on('cursor-move', (data) => {
      const user = this.app.users.get(data.userId);
      if (user) {
        this.app.cursorManager.update(data.userId, data.x, data.y, user.name, user.color);
      }
    });
  }

  // ── Emit events ──
  emitDrawStart(element) {
    if (this.socket) this.socket.emit('draw-start', { element });
  }

  emitDrawMove(data) {
    if (this.socket) this.socket.emit('draw-move', data);
  }

  emitDrawEnd(element) {
    if (this.socket) this.socket.emit('draw-end', { element });
  }

  emitUndo(elementId) {
    if (this.socket) this.socket.emit('undo', { elementId });
  }

  emitRedo(element) {
    if (this.socket) this.socket.emit('redo', { element });
  }

  emitClear() {
    if (this.socket) this.socket.emit('clear');
  }

  emitCursorMove(x, y) {
    const now = Date.now();
    if (now - this.lastCursorEmit < 33) return; // ~30fps throttle
    this.lastCursorEmit = now;
    if (this.socket) this.socket.emit('cursor-move', { x, y });
  }

  // ── WebRTC / call helpers ──
  emitWebRTCSignal(to, signal) {
    if (this.socket) this.socket.emit('webrtc-signal', { to, signal });
  }

  emitCallJoin() {
    if (this.socket) this.socket.emit('call-join');
  }

  emitCallLeave() {
    if (this.socket) this.socket.emit('call-leave');
  }
}

window.SocketManager = SocketManager;
