/* ═══════════════════════════════════════════════════
   UI — Toolbar interactions & state
   ═══════════════════════════════════════════════════ */

function initUI(app) {

  // ── Tool buttons ──
  const toolButtons = document.querySelectorAll('.tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.setTool(btn.dataset.tool);
    });
  });

  // ── Color palette ──
  const swatches = document.querySelectorAll('.color-swatch');
  swatches.forEach(s => {
    s.addEventListener('click', () => {
      swatches.forEach(sw => sw.classList.remove('active'));
      s.classList.add('active');
      app.currentColor = s.dataset.color;
      document.getElementById('custom-color').value = s.dataset.color;
    });
  });

  // Custom color
  const customColor = document.getElementById('custom-color');
  customColor.addEventListener('input', (e) => {
    app.currentColor = e.target.value;
    swatches.forEach(sw => sw.classList.remove('active'));
  });

  // ── Stroke width ──
  const strokeSlider = document.getElementById('stroke-width');
  const strokeValue = document.getElementById('stroke-value');
  strokeSlider.addEventListener('input', (e) => {
    app.currentSize = parseInt(e.target.value);
    strokeValue.textContent = e.target.value + 'px';
  });

  // ── Actions ──
  document.getElementById('btn-undo').addEventListener('click', () => app.performUndo());
  document.getElementById('btn-redo').addEventListener('click', () => app.performRedo());
  document.getElementById('btn-clear').addEventListener('click', () => app.performClear());
  document.getElementById('btn-export').addEventListener('click', () => window.exportCanvas(app.canvas));

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT') return;

    // Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      app.performUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      app.performRedo();
    }

    // Tool shortcuts
    switch (e.key.toLowerCase()) {
      case 'p': selectToolByName('pen'); break;
      case 'l': selectToolByName('line'); break;
      case 'a': selectToolByName('arrow'); break;
      case 'r': selectToolByName('rectangle'); break;
      case 'e': selectToolByName('ellipse'); break;
      case 'x': selectToolByName('eraser'); break;
    }
  });

  function selectToolByName(name) {
    toolButtons.forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-tool="${name}"]`);
    if (btn) {
      btn.classList.add('active');
      app.setTool(name);
    }
  }
}

window.initUI = initUI;
