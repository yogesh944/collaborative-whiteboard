/* ═══════════════════════════════════════════════════
   History — Command-pattern undo/redo stack
   ═══════════════════════════════════════════════════ */

class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.onUndo = null;  // callback
    this.onRedo = null;
  }

  push(command) {
    this.undoStack.push(command);
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return null;
    const cmd = this.undoStack.pop();
    this.redoStack.push(cmd);
    return cmd;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const cmd = this.redoStack.pop();
    this.undoStack.push(cmd);
    return cmd;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

window.WhiteboardHistory = History;
