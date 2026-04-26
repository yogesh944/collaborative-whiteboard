/* ═══════════════════════════════════════════════════
   App — Main entry point, wires everything together
   ═══════════════════════════════════════════════════ */

class WhiteboardApp {
  constructor() {
    // Core modules
    this.canvas = new CanvasEngine();
    this.history = new WhiteboardHistory();
    this.cursorManager = new CursorManager();
    this.socketManager = new SocketManager(this);
    this.voiceManager = new VoiceManager(this);

    // State
    this.currentColor = '#FFFFFF';
    this.currentSize = 3;
    this.currentToolName = 'pen';
    this.activeTool = null;
    this.isDrawing = false;
    this.localUser = null;
    this.authUser = null;
    this.currentRoom = null;
    this.sessionToken = localStorage.getItem('collabboard-token') || '';
    this.pendingInviteToken = null;
    this.pendingRoomId = localStorage.getItem('collabboard-room-id') || '';
    this.voiceMedia = document.getElementById('voice-media');
    this.users = new Map();
    this.lastTouchPoint = null;

    const routeContext = this._readRouteContext();
    if (routeContext.inviteToken) {
      this.pendingInviteToken = routeContext.inviteToken;
    }
    if (routeContext.roomId) {
      this.pendingRoomId = routeContext.roomId;
    }

    // Tool instances
    this.tools = {
      pen: new Tools.PenTool(this),
      line: new Tools.LineTool(this),
      arrow: new Tools.ArrowTool(this),
      rectangle: new Tools.RectangleTool(this),
      ellipse: new Tools.EllipseTool(this),
      eraser: new Tools.EraserTool(this)
    };

    this.activeTool = this.tools.pen;

    this.setBoardVisible(false);
    this._initCanvasEvents();
    initUI(this);
    this._bootstrapSession();
  }

  _readRouteContext() {
    const pathMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/) || window.location.pathname.match(/^\/room\/([^/]+)$/);
    const inviteToken = pathMatch && window.location.pathname.startsWith('/invite/') ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(window.location.search).get('invite');
    const roomId = pathMatch && window.location.pathname.startsWith('/room/') ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(window.location.search).get('room');
    return { inviteToken, roomId };
  }

  async _bootstrapSession() {
    if (!this.sessionToken) {
      this.showAuthOverlay();
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${this.sessionToken}` }
      });
      if (!response.ok) throw new Error('session expired');
      const payload = await response.json();
      this.authUser = payload.user;
      this.showAuthOverlay(true);
      await this._joinInitialRoom();
    } catch (error) {
      this.clearSession();
      this.showAuthOverlay();
    }
  }

  async _joinInitialRoom() {
    if (this.pendingInviteToken) {
      const inviteResponse = await fetch(`/api/invites/${encodeURIComponent(this.pendingInviteToken)}`);
      if (!inviteResponse.ok) {
        this.showToast('Invite link is invalid or expired');
        this.pendingInviteToken = null;
      } else {
        const invitePayload = await inviteResponse.json();
        this.pendingRoomId = invitePayload.room.id;
        history.replaceState({}, '', `/room/${invitePayload.room.id}`);
      }
    }

    if (this.pendingRoomId) {
      await this.joinRoom(this.pendingRoomId, { inviteToken: this.pendingInviteToken || undefined, replaceUrl: true });
      return;
    }

    await this.createRoom(`${this.authUser.name}'s room`);
  }

  setSession(user, token) {
    this.authUser = user;
    this.sessionToken = token;
    localStorage.setItem('collabboard-token', token);
  }

  clearSession() {
    this.authUser = null;
    this.sessionToken = '';
    this.pendingInviteToken = null;
    this.pendingRoomId = '';
    localStorage.removeItem('collabboard-token');
    localStorage.removeItem('collabboard-room-id');
  }

  showAuthOverlay(forceHidden = false) {
    document.getElementById('auth-overlay').classList.toggle('hidden', forceHidden);
    this.setBoardVisible(forceHidden);
  }

  setBoardVisible(visible) {
    document.getElementById('toolbar').classList.toggle('hidden', !visible);
    document.getElementById('users-panel').classList.toggle('hidden', !visible);
    document.getElementById('room-bar').classList.toggle('hidden', !visible);
    document.body.style.cursor = visible ? (this.currentToolName === 'eraser' ? 'cell' : 'crosshair') : 'default';
  }

  async signIn(mode, { email, password, name }) {
    const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Authentication failed');
    }

    this.setSession(payload.user, payload.token);
    this.showAuthOverlay(true);
    await this._joinInitialRoom();
    return payload.user;
  }

  async createRoom(name) {
    if (!this.sessionToken) {
      throw new Error('Sign in before creating a room');
    }
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify({ name })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Could not create room');
    }

    await this.joinRoom(payload.room.id, { room: payload.room, replaceUrl: true });
    return payload.room;
  }

  async joinRoom(roomId, options = {}) {
    if (!roomId) return;
    const headers = { Authorization: `Bearer ${this.sessionToken}` };
    let room = options.room || null;

    if (!room) {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { headers });
      if (response.ok) {
        const payload = await response.json();
        room = payload.room;
      } else {
        room = { id: roomId, name: roomId };
      }
    }

    this.currentRoom = room;
    this.pendingRoomId = room.id;
    this.pendingInviteToken = options.inviteToken || null;
    localStorage.setItem('collabboard-room-id', room.id);
    this.renderRoom();
    this.setBoardVisible(true);

    if (this.socketManager.socket) {
      await this.voiceManager.leave().catch(() => {});
    }

    if (options.replaceUrl !== false) {
      history.replaceState({}, '', `/room/${room.id}`);
    }

    this.socketManager.connect({
      token: this.sessionToken,
      roomId: room.id,
      inviteToken: this.pendingInviteToken
    });
  }

  async reloadRoom() {
    if (!this.pendingRoomId) return;
    await this.joinRoom(this.pendingRoomId, { replaceUrl: true });
  }

  async sendInvite(email, note) {
    if (!this.currentRoom) {
      throw new Error('Create or join a room first');
    }

    const response = await fetch(`/api/rooms/${encodeURIComponent(this.currentRoom.id)}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify({ email, message: note })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Invite could not be sent');
    }

    return payload;
  }

  async copyRoomLink() {
    if (!this.currentRoom) return;
    const link = `${window.location.origin}/room/${this.currentRoom.id}`;
    await navigator.clipboard.writeText(link);
    this.showToast('Room link copied');
  }

  async leaveWorkspace() {
    await this.voiceManager.leave().catch(() => {});
    if (this.socketManager.socket) {
      this.socketManager.socket.disconnect();
      this.socketManager.socket = null;
    }
    this.clearSession();
    this.currentRoom = null;
    this.localUser = null;
    this.users.clear();
    this.canvas.clearAll();
    this.history.clear();
    this.renderUsers();
    this.renderRoom();
    this.setBoardVisible(false);
    history.replaceState({}, '', '/');
    this.showAuthOverlay();
  }

  setVoiceStatus(message) {
    const el = document.getElementById('voice-status');
    if (el) {
      el.textContent = message;
    }
    const btn = document.getElementById('btn-voice');
    if (btn) {
      btn.textContent = message.toLowerCase().includes('active') ? 'Leave voice' : 'Join voice';
    }
  }

  renderRoom() {
    const title = document.getElementById('room-title');
    const id = document.getElementById('room-id');
    if (title) {
      title.textContent = this.currentRoom?.name || 'Personal room';
    }
    if (id) {
      id.textContent = this.currentRoom ? `Room ${this.currentRoom.id}` : '';
    }
  }

  handleSocketInit(data) {
    this.localUser = data.user;
    if (data.room) {
      this.currentRoom = data.room;
      this.renderRoom();
    }
    this.canvas.setElements(data.elements);
    this.updateUsers(data.users);
    this.voiceManager.bindSocket(this.socketManager.socket);
    this.voiceManager.syncAfterReconnect();
    this.showToast(`Connected as ${data.user.name}`);
  }

  setTool(name) {
    this.currentToolName = name;
    this.activeTool = this.tools[name];
    // Update cursor style
    document.body.style.cursor = this.boardVisible ? (name === 'eraser' ? 'cell' : 'crosshair') : 'default';
  }

  get boardVisible() {
    return !document.getElementById('toolbar').classList.contains('hidden');
  }

  // ── Canvas mouse events ──
  _initCanvasEvents() {
    const canvas = this.canvas.mainCanvas;

    canvas.addEventListener('mousedown', (e) => {
      if (e.target.closest('#toolbar') || e.target.closest('#users-panel')) return;
      this.isDrawing = true;
      const { x, y } = this._getPos(e);
      this.activeTool.onMouseDown(x, y);
    });

    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = this._getPos(e);
      this.socketManager.emitCursorMove(x, y);
      if (this.isDrawing) {
        this.activeTool.onMouseMove(x, y);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const { x, y } = this._getPos(e);
      this.activeTool.onMouseUp(x, y);
    });

    canvas.addEventListener('mouseleave', (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const { x, y } = this._getPos(e);
      this.activeTool.onMouseUp(x, y);
    });

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const { x, y } = this._getTouchPos(touch);
      this.lastTouchPoint = { x, y };
      this.isDrawing = true;
      this.activeTool.onMouseDown(x, y);
      this.socketManager.emitCursorMove(x, y);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!this.isDrawing) return;
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const { x, y } = this._getTouchPos(touch);
      this.lastTouchPoint = { x, y };
      this.activeTool.onMouseMove(x, y);
      this.socketManager.emitCursorMove(x, y);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      this.isDrawing = false;
      const lastTouch = e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null;
      const endPos = lastTouch ? this._getTouchPos(lastTouch) : this.lastTouchPoint || { x: 0, y: 0 };
      this.activeTool.onMouseUp(endPos.x, endPos.y);
      this.lastTouchPoint = null;
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const endPos = this.lastTouchPoint || { x: 0, y: 0 };
      this.activeTool.onMouseUp(endPos.x, endPos.y);
      this.lastTouchPoint = null;
    }, { passive: true });
  }

  _getPos(e) {
    return { x: e.clientX, y: e.clientY };
  }

  _getTouchPos(touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  // ── Undo / Redo ──
  performUndo() {
    const cmd = this.history.undo();
    if (!cmd) return;
    if (cmd.type === 'add') {
      this.canvas.removeElementById(cmd.element.id);
      this.socketManager.emitUndo(cmd.element.id);
    }
  }

  performRedo() {
    const cmd = this.history.redo();
    if (!cmd) return;
    if (cmd.type === 'add') {
      this.canvas.addElement(cmd.element);
      this.socketManager.emitRedo(cmd.element);
    }
  }

  performClear() {
    this.canvas.clearAll();
    this.history.clear();
    this.socketManager.emitClear();
  }

  // ── Users ──
  updateUsers(usersArr) {
    this.users.clear();
    for (const u of usersArr) {
      this.users.set(u.id, u);
    }
    this.renderUsers();
  }

  renderUsers() {
    const list = document.getElementById('users-list');
    const count = document.getElementById('user-count');
    count.textContent = this.users.size;

    list.innerHTML = '';
    this.users.forEach((user) => {
      const div = document.createElement('div');
      div.className = 'user-item';
      const isYou = this.localUser && user.id === this.localUser.id;
      div.innerHTML = `
        <span class="user-dot" style="color:${user.color}; background:${user.color}"></span>
        <span class="user-name">${user.name}</span>
        ${isYou ? '<span class="user-you">(you)</span>' : ''}
      `;
      list.appendChild(div);
    });
  }

  // ── Toast ──
  showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WhiteboardApp();
});
