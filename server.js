const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── State ──────────────────────────────────────────────
const users = new Map();          // socketId → { name, color, cursor }
const elements = [];              // shared canvas element list
const COLORS = [
  '#6C5CE7', '#00B894', '#E17055', '#0984E3',
  '#FDCB6E', '#E84393', '#00CEC9', '#FF7675',
  '#A29BFE', '#55EFC4', '#FAB1A0', '#74B9FF'
];
let colorIndex = 0;
let userCounter = 0;

function nextColor() {
  const c = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return c;
}

// ── Socket.io ──────────────────────────────────────────
io.on('connection', (socket) => {
  userCounter++;
  const user = {
    id: socket.id,
    name: `User ${userCounter}`,
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

  // ── Disconnect ──
  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('user-left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Whiteboard running at http://localhost:${PORT}`);
});
