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
  const authOverlay = document.getElementById('auth-overlay');
  const authForm = document.getElementById('auth-form');
  const authError = document.getElementById('auth-error');
  const authNameRow = document.getElementById('auth-name-row');
  const authSubmit = document.getElementById('auth-submit');
  const authTabs = document.querySelectorAll('.auth-tab');
  const authName = document.getElementById('auth-name');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const inviteForm = document.getElementById('invite-form');
  const inviteEmail = document.getElementById('invite-email');
  const inviteNote = document.getElementById('invite-note');

  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    authTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    authNameRow.classList.toggle('hidden', mode !== 'signup');
    authSubmit.textContent = mode === 'signup' ? 'Create account' : 'Enter workspace';
    authPassword.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    authError.textContent = '';
  }

  authTabs.forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    authError.textContent = '';

    try {
      await app.signIn(authMode, {
        name: authName.value.trim(),
        email: authEmail.value.trim(),
        password: authPassword.value
      });
      authForm.reset();
      setAuthMode('login');
    } catch (error) {
      authError.textContent = error.message || 'Authentication failed';
    }
  });

  document.getElementById('btn-copy-room-link').addEventListener('click', () => app.copyRoomLink());

  document.getElementById('btn-new-room').addEventListener('click', async () => {
    const name = window.prompt('Room name', `${app.authUser?.name || 'My'} room`);
    if (!name) return;
    try {
      await app.createRoom(name.trim());
      app.showToast('New room created');
    } catch (error) {
      app.showToast(error.message || 'Could not create room');
    }
  });

  document.getElementById('btn-leave-room').addEventListener('click', () => app.leaveWorkspace());

  document.getElementById('btn-voice').addEventListener('click', async () => {
    try {
      await app.voiceManager.toggle();
    } catch (error) {
      app.showToast(error.message || 'Voice chat could not start');
    }
  });

  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = await app.sendInvite(inviteEmail.value.trim(), inviteNote.value.trim());
      inviteEmail.value = '';
      inviteNote.value = '';
      app.showToast(payload.sent ? 'Invite sent by email' : 'Invite link generated');
      if (!payload.sent && payload.inviteUrl) {
        await navigator.clipboard.writeText(payload.inviteUrl);
      }
    } catch (error) {
      app.showToast(error.message || 'Invite could not be sent');
    }
  });

  setAuthMode('login');

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
