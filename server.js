const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { DatabaseStore } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const COLORS = [
  '#6C5CE7', '#00B894', '#E17055', '#0984E3',
  '#FDCB6E', '#E84393', '#00CEC9', '#FF7675',
  '#A29BFE', '#55EFC4', '#FAB1A0', '#74B9FF'
];
let colorIndex = 0;
let userCounter = 0;
let store;

// Active socket users are kept in memory for presence/cursor updates.
const connectedUsersByRoom = new Map();

const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    })
  : null;

function nextColor() {
  const c = COLORS[colorIndex % COLORS.length];
  colorIndex++;
  return c;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'room';
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const nextHash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(nextHash, 'hex'));
}

function createToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

function getAuthToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.headers['x-session-token'] || req.body?.token || null;
}

async function getUserFromToken(token) {
  if (!token) return null;
  return store.getUserByToken(String(token));
}

async function requireAuth(req, res, next) {
  try {
    const user = await getUserFromToken(getAuthToken(req));
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return sendJsonError(res, 500, 'Authentication check failed');
  }
}

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function roomSummary(room) {
  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    createdAt: room.createdAt,
    inviteCount: room.inviteCount || 0
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    color: user.color
  };
}

async function ensureRoom(roomId, fallbackName, ownerId = null) {
  let room = await store.getRoomById(roomId);
  if (!room) {
    room = await store.createRoom({
      id: roomId,
      name: fallbackName || 'Whiteboard room',
      ownerId,
      createdAt: new Date().toISOString(),
      inviteCount: 0
    });
  }
  return room;
}

async function createRoomForUser(user, name) {
  const roomId = `${slugify(name || `${user.name}'s room`)}-${makeId('room').split('_')[1]}`;
  return store.createRoom({
    id: roomId,
    name: name || `${user.name}'s room`,
    ownerId: user.id,
    createdAt: new Date().toISOString(),
    inviteCount: 0
  });
}

function buildInviteUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/invite/${token}`;
}

function sendJsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

function getConnectedRoomUsers(roomId) {
  let users = connectedUsersByRoom.get(roomId);
  if (!users) {
    users = new Map();
    connectedUsersByRoom.set(roomId, users);
  }
  return users;
}

app.post('/api/auth/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim() || email.split('@')[0] || 'Creator';

  if (!email || !email.includes('@')) {
    return sendJsonError(res, 400, 'A valid email is required');
  }
  if (password.length < 6) {
    return sendJsonError(res, 400, 'Password must be at least 6 characters');
  }

  const existing = await store.getUserByEmail(email);
  if (existing) {
    return sendJsonError(res, 409, 'That email is already registered');
  }

  const user = {
    id: makeId('user'),
    email,
    name,
    passwordHash: hashPassword(password),
    color: nextColor(),
    createdAt: new Date().toISOString()
  };

  try {
    await store.createUser(user);
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('unique')) {
      return sendJsonError(res, 409, 'That email is already registered');
    }
    return sendJsonError(res, 500, 'Could not create account');
  }

  const token = createToken();
  await store.createSession(token, user.id);

  return res.json({ token, user: serializeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await store.getUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return sendJsonError(res, 401, 'Invalid email or password');
  }

  const token = createToken();
  await store.createSession(token, user.id);
  return res.json({ token, user: serializeUser(user) });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getUserFromToken(getAuthToken(req));
  if (!user) {
    return sendJsonError(res, 401, 'Not signed in');
  }
  return res.json({ user: serializeUser(user) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = getAuthToken(req);
  if (token) {
    await store.deleteSession(String(token));
  }
  return res.json({ ok: true });
});

app.post('/api/rooms', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim() || `${req.user.name}'s room`;
  const room = await createRoomForUser(req.user, name);
  return res.json({ room: roomSummary(room) });
});

app.get('/api/rooms/:roomId', requireAuth, async (req, res) => {
  const room = await store.getRoomById(req.params.roomId);
  if (!room) {
    return sendJsonError(res, 404, 'Room not found');
  }
  return res.json({
    room: roomSummary(room),
    canEdit: room.ownerId === req.user.id
  });
});

app.post('/api/rooms/:roomId/invites', requireAuth, async (req, res) => {
  const room = await store.getRoomById(req.params.roomId);
  if (!room) {
    return sendJsonError(res, 404, 'Room not found');
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const message = String(req.body?.message || '').trim();
  if (!email || !email.includes('@')) {
    return sendJsonError(res, 400, 'A valid recipient email is required');
  }

  const token = createToken();
  const invite = {
    token,
    roomId: room.id,
    email,
    message,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7
  };

  await store.createInvite(invite);
  await store.incrementRoomInviteCount(room.id);

  const inviteUrl = buildInviteUrl(req, token);
  let sent = false;

  if (mailTransport && process.env.MAIL_FROM) {
    await mailTransport.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: `${room.name} invite on CollabBoard`,
      text: [
        `You've been invited to join the room "${room.name}" on CollabBoard.`,
        '',
        inviteUrl,
        '',
        message || ''
      ].join('\n')
    });
    sent = true;
  }

  return res.json({ inviteUrl, inviteToken: token, sent });
});

app.get('/api/invites/:token', async (req, res) => {
  const invite = await store.getInviteByToken(req.params.token);
  if (!invite || invite.expiresAt < Date.now()) {
    return sendJsonError(res, 404, 'Invite not found or expired');
  }

  const room = await store.getRoomById(invite.roomId);
  if (!room) {
    return sendJsonError(res, 404, 'Room not found');
  }

  return res.json({
    invite: {
      token: invite.token,
      roomId: invite.roomId,
      roomName: room.name,
      email: invite.email,
      message: invite.message
    },
    room: roomSummary(room)
  });
});

function serveApp(req, res) {
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
}

app.get('/', serveApp);
app.get('/room/:roomId', serveApp);
app.get('/invite/:token', serveApp);
app.get(/^\/(?!api).*/, serveApp);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = await getUserFromToken(token);
    if (!user) {
      return next(new Error('Authentication required'));
    }

    const requestedRoomId = socket.handshake.auth?.roomId;
    const requestedInviteToken = socket.handshake.auth?.inviteToken;
    let roomId = requestedRoomId;

    if (!roomId && requestedInviteToken) {
      const invite = await store.getInviteByToken(requestedInviteToken);
      if (invite && invite.expiresAt >= Date.now()) {
        roomId = invite.roomId;
      }
    }

    let room;
    if (!roomId) {
      room = await createRoomForUser(user, `${user.name}'s room`);
      roomId = room.id;
    } else {
      room = await ensureRoom(roomId, `${user.name}'s room`, user.id);
    }

    socket.data.user = user;
    socket.data.room = room;
    next();
  } catch (error) {
    next(new Error('Socket auth failed'));
  }
});

io.on('connection', async (socket) => {
  userCounter++;
  const room = socket.data.room;
  const roomId = room.id;
  const authUser = socket.data.user;

  const user = {
    id: socket.id,
    userId: authUser.id,
    name: authUser.name,
    email: authUser.email,
    color: authUser.color,
    cursor: { x: 0, y: 0 },
    voiceActive: false
  };

  const roomUsers = getConnectedRoomUsers(roomId);
  roomUsers.set(socket.id, user);
  socket.join(roomChannel(roomId));

  const elements = await store.listRoomElements(roomId);
  socket.emit('init', {
    user,
    room: roomSummary(room),
    elements,
    users: Array.from(roomUsers.values())
  });

  socket.to(roomChannel(roomId)).emit('user-joined', user);

  socket.on('draw-start', (data) => {
    socket.to(roomChannel(roomId)).emit('draw-start', { ...data, userId: socket.id });
  });

  socket.on('draw-move', (data) => {
    socket.to(roomChannel(roomId)).emit('draw-move', { ...data, userId: socket.id });
  });

  socket.on('draw-end', async (data) => {
    if (data.element?.id) {
      await store.upsertRoomElement(roomId, data.element);
    }
    socket.to(roomChannel(roomId)).emit('draw-end', { ...data, userId: socket.id });
  });

  socket.on('add-element', async (element) => {
    if (element?.id) {
      await store.upsertRoomElement(roomId, element);
    }
    socket.to(roomChannel(roomId)).emit('add-element', element);
  });

  socket.on('undo', async (data) => {
    if (data?.elementId) {
      await store.removeRoomElement(roomId, data.elementId);
    }
    socket.to(roomChannel(roomId)).emit('undo', data);
  });

  socket.on('redo', async (data) => {
    if (data?.element?.id) {
      await store.upsertRoomElement(roomId, data.element);
    }
    socket.to(roomChannel(roomId)).emit('redo', data);
  });

  socket.on('clear', async () => {
    await store.clearRoomElements(roomId);
    socket.to(roomChannel(roomId)).emit('clear');
  });

  socket.on('cursor-move', (pos) => {
    const u = roomUsers.get(socket.id);
    if (u) {
      u.cursor = pos;
      socket.to(roomChannel(roomId)).emit('cursor-move', { userId: socket.id, ...pos });
    }
  });

  socket.on('voice-ready', () => {
    user.voiceActive = true;
    socket.to(roomChannel(roomId)).emit('voice-user-joined', {
      userId: socket.id,
      name: user.name,
      color: user.color
    });
  });

  socket.on('voice-offer', (payload) => {
    io.to(payload.targetId).emit('voice-offer', {
      fromId: socket.id,
      offer: payload.offer
    });
  });

  socket.on('voice-answer', (payload) => {
    io.to(payload.targetId).emit('voice-answer', {
      fromId: socket.id,
      answer: payload.answer
    });
  });

  socket.on('voice-ice', (payload) => {
    io.to(payload.targetId).emit('voice-ice', {
      fromId: socket.id,
      candidate: payload.candidate
    });
  });

  socket.on('voice-leave', () => {
    user.voiceActive = false;
    socket.to(roomChannel(roomId)).emit('voice-user-left', {
      userId: socket.id,
      name: user.name
    });
  });

  socket.on('disconnect', () => {
    roomUsers.delete(socket.id);
    if (roomUsers.size === 0) {
      connectedUsersByRoom.delete(roomId);
    }

    socket.to(roomChannel(roomId)).emit('user-left', socket.id);
    if (user.voiceActive) {
      socket.to(roomChannel(roomId)).emit('voice-user-left', {
        userId: socket.id,
        name: user.name
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  store = await DatabaseStore.create(process.env.DB_PATH);

  server.listen(PORT, () => {
    console.log(`✨ Whiteboard running at http://localhost:${PORT}`);
    console.log(`💾 SQLite DB: ${process.env.DB_PATH || path.join(__dirname, 'data', 'collabboard.db')}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
