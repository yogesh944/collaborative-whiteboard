/* ═══════════════════════════════════════════════════
   Canvas — Two-layer rendering engine
   ═══════════════════════════════════════════════════ */

class CanvasEngine {
  constructor() {
    this.mainCanvas = document.getElementById('main-canvas');
    this.previewCanvas = document.getElementById('preview-canvas');
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas.getContext('2d');
    this.elements = [];
    this.dpr = window.devicePixelRatio || 1;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (const c of [this.mainCanvas, this.previewCanvas]) {
      c.width = w * this.dpr;
      c.height = h * this.dpr;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.getContext('2d').scale(this.dpr, this.dpr);
    }

    this.width = w;
    this.height = h;
    this.render();
  }

  // ── Render all committed elements ──
  render() {
    const ctx = this.mainCtx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0B0D17';
    ctx.fillRect(0, 0, this.width, this.height);

    // Dot grid
    this._drawGrid(ctx);

    // Elements
    for (const el of this.elements) {
      this._drawElement(ctx, el);
    }

    ctx.restore();
  }

  _drawGrid(ctx) {
    const spacing = 30;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let x = spacing; x < this.width; x += spacing) {
      for (let y = spacing; y < this.height; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawElement(ctx, el) {
    ctx.save();
    ctx.strokeStyle = el.color || '#FFFFFF';
    ctx.lineWidth = el.size || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (el.type) {
      case 'freehand':
        this._drawFreehand(ctx, el);
        break;
      case 'line':
        this._drawLine(ctx, el);
        break;
      case 'arrow':
        this._drawArrow(ctx, el);
        break;
      case 'rectangle':
        this._drawRectangle(ctx, el);
        break;
      case 'ellipse':
        this._drawEllipse(ctx, el);
        break;
      case 'eraser':
        ctx.strokeStyle = '#0B0D17';
        ctx.lineWidth = (el.size || 3) * 4;
        this._drawFreehand(ctx, el);
        break;
    }

    ctx.restore();
  }

  _drawFreehand(ctx, el) {
    if (!el.points || el.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(el.points[0].x, el.points[0].y);

    if (el.points.length === 2) {
      ctx.lineTo(el.points[1].x, el.points[1].y);
    } else {
      for (let i = 1; i < el.points.length - 1; i++) {
        const xc = (el.points[i].x + el.points[i + 1].x) / 2;
        const yc = (el.points[i].y + el.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, xc, yc);
      }
      const last = el.points[el.points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  }

  _drawLine(ctx, el) {
    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();
  }

  _drawArrow(ctx, el) {
    const headLen = Math.max(12, el.size * 4);
    const dx = el.x2 - el.x1;
    const dy = el.y2 - el.y1;
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(el.x2, el.y2);
    ctx.lineTo(el.x2 - headLen * Math.cos(angle - Math.PI / 6), el.y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(el.x2, el.y2);
    ctx.lineTo(el.x2 - headLen * Math.cos(angle + Math.PI / 6), el.y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  _drawRectangle(ctx, el) {
    const x = Math.min(el.x1, el.x2);
    const y = Math.min(el.y1, el.y2);
    const w = Math.abs(el.x2 - el.x1);
    const h = Math.abs(el.y2 - el.y1);
    ctx.strokeRect(x, y, w, h);
  }

  _drawEllipse(ctx, el) {
    const cx = (el.x1 + el.x2) / 2;
    const cy = (el.y1 + el.y2) / 2;
    const rx = Math.abs(el.x2 - el.x1) / 2;
    const ry = Math.abs(el.y2 - el.y1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Preview layer ──
  clearPreview() {
    this.previewCtx.save();
    this.previewCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.previewCtx.clearRect(0, 0, this.width, this.height);
    this.previewCtx.restore();
  }

  drawPreview(el) {
    this.clearPreview();
    const ctx = this.previewCtx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._drawElement(ctx, el);
    ctx.restore();
  }

  // ── Element management ──
  addElement(el) {
    this.elements.push(el);
    this.render();
  }

  removeElementById(id) {
    const idx = this.elements.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.elements.splice(idx, 1);
      this.render();
    }
  }

  clearAll() {
    this.elements = [];
    this.render();
  }

  setElements(elements) {
    this.elements = elements;
    this.render();
  }

  // For export
  getExportCanvas() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.width * this.dpr;
    exportCanvas.height = this.height * this.dpr;
    const ctx = exportCanvas.getContext('2d');
    ctx.scale(this.dpr, this.dpr);

    // White background for export
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, this.width, this.height);

    for (const el of this.elements) {
      // Swap white strokes to black for export
      const exportEl = { ...el };
      if (exportEl.color === '#FFFFFF') exportEl.color = '#000000';
      this._drawElement(ctx, exportEl);
    }

    return exportCanvas;
  }
}

window.CanvasEngine = CanvasEngine;
