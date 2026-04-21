/* ═══════════════════════════════════════════════════
   Cursors — Live remote cursor rendering
   ═══════════════════════════════════════════════════ */

class CursorManager {
  constructor() {
    this.container = document.getElementById('cursors-layer');
    this.cursors = new Map(); // userId → DOM element
  }

  update(userId, x, y, name, color) {
    let el = this.cursors.get(userId);

    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = `
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
          <path d="M1 1L7.5 21L10.5 13.5L18 11.5L1 1Z"
                fill="${color}" stroke="${color}" stroke-width="1.5"
                stroke-linejoin="round"/>
        </svg>
        <span class="cursor-label" style="background:${color}; color:${this._contrastColor(color)}">${name}</span>
      `;
      this.container.appendChild(el);
      this.cursors.set(userId, el);
    }

    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  remove(userId) {
    const el = this.cursors.get(userId);
    if (el) {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(() => {
        el.remove();
        this.cursors.delete(userId);
      }, 300);
    }
  }

  _contrastColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  }
}

window.CursorManager = CursorManager;
