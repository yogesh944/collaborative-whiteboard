require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
    process.exit(1);
  }
  console.warn('WARNING: JWT_SECRET is not set. Using an insecure default – set JWT_SECRET in .env before deploying.');
}
const JWT_SIGNING_SECRET = JWT_SECRET || 'dev_secret_change_in_production';
const USERS_FILE = path.join(__dirname, 'users.json');

// ── Persistent user store helpers ─────────────────────
function loadAccounts() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAccounts(accounts) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(accounts, null, 2));
}

// ── Express ───────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth endpoints ─────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 2–32 characters.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const accounts = loadAccounts();
  const key = username.toLowerCase();
  if (accounts[key]) {
    return res.status(409).json({ error: 'Username already taken.' });
  }

  const hash = await bcrypt.hash(password, 10);
  accounts[key] = { username, hash };
  saveAccounts(accounts);

  const token = jwt.sign({ username }, JWT_SIGNING_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const accounts = loadAccounts();
  const key = username.toLowerCase();
  const account = accounts[key];
  if (!account) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const valid = await bcrypt.compare(password, account.hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign({ username: account.username }, JWT_SIGNING_SECRET, { expiresIn: '7d' });
  res.json({ token, username: account.username });
});

// ── State ──────────────────────────────────────────────
const users = new Map();          // socketId → { name, color, cursor }
const elements = [];              // shared canvas element list
const COLORS = [
  '#6C5CE7', '#00B894', '#E17055', '#0984E3',
  '#FDCB6E', '#E84393', '#00CEC9', '#FF7675',
  '#A29BFE', '#55EFC4', '#FAB1A0', '#74B9FF'
];
let colorIndex = 0;

function nextColor() {
  const c = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return c;
}

// ── Socket.io auth middleware ──────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required.'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SIGNING_SECRET);
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Invalid or expired token.'));
  }
});

// ── Socket.io ──────────────────────────────────────────
io.on('connection', (socket) => {
  const user = {
    id: socket.id,
    name: socket.username,
    color: nextColor(),
    cursor: { x: 0, y: 0 }
  };
  users.set(socket.id, user);

  // Send current state to the new user
  socket.emit('init', {
    user,
    elements: [...elements],
    users: Array.from(users.values())
  });

  // Notify others
  socket.broadcast.emit('user-joined', user);

  // ── Drawing events ──
  socket.on('draw-start', (data) => {
    socket.broadcast.emit('draw-start', { ...data, userId: socket.id });
  });

  socket.on('draw-move', (data) => {
    socket.broadcast.emit('draw-move', { ...data, userId: socket.id });
  });

  socket.on('draw-end', (data) => {
    if (data.element) {
      elements.push(data.element);
    }
    socket.broadcast.emit('draw-end', { ...data, userId: socket.id });
  });

  // ── Shape add ──
  socket.on('add-element', (element) => {
    elements.push(element);
    socket.broadcast.emit('add-element', element);
  });

  // ── Undo / Redo ──
  socket.on('undo', (data) => {
    const idx = elements.findIndex(e => e.id === data.elementId);
    if (idx !== -1) elements.splice(idx, 1);
    socket.broadcast.emit('undo', data);
  });

  socket.on('redo', (data) => {
    if (data.element) elements.push(data.element);
    socket.broadcast.emit('redo', data);
  });

  // ── Clear ──
  socket.on('clear', () => {
    elements.length = 0;
    socket.broadcast.emit('clear');
  });

  // ── Cursor ──
  socket.on('cursor-move', (pos) => {
    const u = users.get(socket.id);
    if (u) {
      u.cursor = pos;
      socket.broadcast.emit('cursor-move', { userId: socket.id, ...pos });
    }
  });

  // ── WebRTC signaling ──
  socket.on('webrtc-signal', ({ to, signal }) => {
    const target = io.sockets.sockets.get(to);
    if (target) {
      target.emit('webrtc-signal', { from: socket.id, signal });
    }
  });

  socket.on('call-join', () => {
    const u = users.get(socket.id);
    if (u) {
      u.inCall = true;
      // Send back the list of peers already in the call
      const peers = Array.from(users.values())
        .filter(p => p.inCall && p.id !== socket.id)
        .map(p => p.id);
      socket.emit('call-peers', peers);
      // Tell everyone else this user joined the call
      socket.broadcast.emit('call-user-joined', socket.id);
    }
  });

  socket.on('call-leave', () => {
    const u = users.get(socket.id);
    if (u) {
      u.inCall = false;
      socket.broadcast.emit('call-user-left', socket.id);
    }
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if (u && u.inCall) {
      io.emit('call-user-left', socket.id);
    }
    users.delete(socket.id);
    io.emit('user-left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Whiteboard running at http://localhost:${PORT}`);
});
