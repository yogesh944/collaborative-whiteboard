/* ═══════════════════════════════════════════════════
   Auth — JWT guard & logout helper
   ═══════════════════════════════════════════════════ */

(function () {
  const token = localStorage.getItem('cb_token');
  if (!token) {
    window.location.replace('/login.html');
    throw new Error('Not authenticated'); // stop further script execution
  }

  // Expose token globally so SocketManager can read it
  window.CB_TOKEN = token;
  window.CB_USERNAME = localStorage.getItem('cb_username') || '';

  window.cbLogout = function () {
    localStorage.removeItem('cb_token');
    localStorage.removeItem('cb_username');
    window.location.replace('/login.html');
  };
})();
