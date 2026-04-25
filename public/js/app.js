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

    // State
    this.currentColor = '#FFFFFF';
    this.currentSize = 3;
    this.currentToolName = 'pen';
    this.activeTool = null;
    this.isDrawing = false;
    this.localUser = null;
    this.users = new Map();

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

    this._initCanvasEvents();
    initUI(this);
    this.socketManager.connect();
    // MeetManager is wired after socket is ready (connect() is sync call, socket assigned immediately)
    this.meetManager = new MeetManager(this.socketManager);
  }

  setTool(name) {
    this.currentToolName = name;
    this.activeTool = this.tools[name];
    // Update cursor style
    document.body.style.cursor = name === 'eraser' ? 'cell' : 'crosshair';
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
      e.preventDefault();
      const touch = e.touches[0];
      const { x, y } = this._getTouchPos(touch);
      this.isDrawing = true;
      this.activeTool.onMouseDown(x, y);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.isDrawing) return;
      const touch = e.touches[0];
      const { x, y } = this._getTouchPos(touch);
      this.activeTool.onMouseMove(x, y);
      this.socketManager.emitCursorMove(x, y);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.activeTool.onMouseUp(0, 0);
    });
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
