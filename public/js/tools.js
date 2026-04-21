/* ═══════════════════════════════════════════════════
   Tools — Drawing tool handlers
   ═══════════════════════════════════════════════════ */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

class BaseTool {
  constructor(app) {
    this.app = app;
  }
  onMouseDown(x, y) {}
  onMouseMove(x, y) {}
  onMouseUp(x, y) {}
}

// ── Pen ──
class PenTool extends BaseTool {
  constructor(app) {
    super(app);
    this.currentElement = null;
  }

  onMouseDown(x, y) {
    this.currentElement = {
      id: generateId(),
      type: 'freehand',
      color: this.app.currentColor,
      size: this.app.currentSize,
      points: [{ x, y }]
    };
    this.app.socketManager.emitDrawStart(this.currentElement);
  }

  onMouseMove(x, y) {
    if (!this.currentElement) return;
    this.currentElement.points.push({ x, y });
    this.app.canvas.drawPreview(this.currentElement);
    this.app.socketManager.emitDrawMove({ id: this.currentElement.id, x, y });
  }

  onMouseUp(x, y) {
    if (!this.currentElement) return;
    this.app.canvas.clearPreview();
    this.app.canvas.addElement(this.currentElement);
    this.app.history.push({ type: 'add', element: this.currentElement });
    this.app.socketManager.emitDrawEnd(this.currentElement);
    this.currentElement = null;
  }
}

// ── Eraser ──
class EraserTool extends BaseTool {
  constructor(app) {
    super(app);
    this.currentElement = null;
  }

  onMouseDown(x, y) {
    this.currentElement = {
      id: generateId(),
      type: 'eraser',
      color: '#0B0D17',
      size: this.app.currentSize,
      points: [{ x, y }]
    };
  }

  onMouseMove(x, y) {
    if (!this.currentElement) return;
    this.currentElement.points.push({ x, y });
    this.app.canvas.drawPreview(this.currentElement);
  }

  onMouseUp(x, y) {
    if (!this.currentElement) return;
    this.app.canvas.clearPreview();
    this.app.canvas.addElement(this.currentElement);
    this.app.history.push({ type: 'add', element: this.currentElement });
    this.app.socketManager.emitDrawEnd(this.currentElement);
    this.currentElement = null;
  }
}

// ── Shape tool (base for rect, ellipse, line, arrow) ──
class ShapeTool extends BaseTool {
  constructor(app, shapeType) {
    super(app);
    this.shapeType = shapeType;
    this.startX = 0;
    this.startY = 0;
    this.currentElement = null;
  }

  onMouseDown(x, y) {
    this.startX = x;
    this.startY = y;
    this.currentElement = {
      id: generateId(),
      type: this.shapeType,
      color: this.app.currentColor,
      size: this.app.currentSize,
      x1: x, y1: y,
      x2: x, y2: y
    };
  }

  onMouseMove(x, y) {
    if (!this.currentElement) return;
    this.currentElement.x2 = x;
    this.currentElement.y2 = y;
    this.app.canvas.drawPreview(this.currentElement);
  }

  onMouseUp(x, y) {
    if (!this.currentElement) return;
    this.currentElement.x2 = x;
    this.currentElement.y2 = y;
    this.app.canvas.clearPreview();
    this.app.canvas.addElement(this.currentElement);
    this.app.history.push({ type: 'add', element: this.currentElement });
    this.app.socketManager.emitDrawEnd(this.currentElement);
    this.currentElement = null;
  }
}

window.Tools = {
  generateId,
  PenTool,
  EraserTool,
  LineTool: class extends ShapeTool { constructor(app) { super(app, 'line'); } },
  ArrowTool: class extends ShapeTool { constructor(app) { super(app, 'arrow'); } },
  RectangleTool: class extends ShapeTool { constructor(app) { super(app, 'rectangle'); } },
  EllipseTool: class extends ShapeTool { constructor(app) { super(app, 'ellipse'); } }
};
