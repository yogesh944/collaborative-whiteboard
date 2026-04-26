const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

class DatabaseStore {
  constructor(db) {
    this.db = db;
  }

  static async create(dbPath) {
    const resolvedPath = dbPath || path.join(__dirname, 'data', 'collabboard.db');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    const db = await open({
      filename: resolvedPath,
      driver: sqlite3.Database
    });

    await db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT,
        created_at TEXT NOT NULL,
        invite_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS room_elements (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_invites_room_id ON invites(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_elements_room_id ON room_elements(room_id);
    `);

    return new DatabaseStore(db);
  }

  async createUser(user) {
    await this.db.run(
      `INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      user.id,
      user.email,
      user.name,
      user.passwordHash,
      user.color,
      user.createdAt
    );
  }

  _normalizeUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      color: row.color,
      createdAt: row.created_at
    };
  }

  _normalizeRoom(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      inviteCount: row.invite_count || 0
    };
  }

  _normalizeInvite(row) {
    if (!row) return null;
    return {
      token: row.token,
      roomId: row.room_id,
      email: row.email,
      message: row.message || '',
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  async getUserByEmail(email) {
    const row = await this.db.get(`SELECT * FROM users WHERE email = ?`, email);
    return this._normalizeUser(row);
  }

  async getUserById(id) {
    const row = await this.db.get(`SELECT * FROM users WHERE id = ?`, id);
    return this._normalizeUser(row);
  }

  async createSession(token, userId) {
    await this.db.run(
      `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
      token,
      userId,
      new Date().toISOString()
    );
  }

  async deleteSession(token) {
    await this.db.run(`DELETE FROM sessions WHERE token = ?`, token);
  }

  async getUserByToken(token) {
    const row = await this.db.get(
      `
      SELECT u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      `,
      token
    );
    return this._normalizeUser(row);
  }

  async createRoom(room) {
    await this.db.run(
      `INSERT INTO rooms (id, name, owner_id, created_at, invite_count) VALUES (?, ?, ?, ?, ?)`,
      room.id,
      room.name,
      room.ownerId || null,
      room.createdAt,
      room.inviteCount || 0
    );
    return this.getRoomById(room.id);
  }

  async getRoomById(id) {
    const row = await this.db.get(`SELECT * FROM rooms WHERE id = ?`, id);
    return this._normalizeRoom(row);
  }

  async incrementRoomInviteCount(roomId) {
    await this.db.run(
      `UPDATE rooms SET invite_count = invite_count + 1 WHERE id = ?`,
      roomId
    );
  }

  async createInvite(invite) {
    await this.db.run(
      `
      INSERT INTO invites (token, room_id, email, message, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      invite.token,
      invite.roomId,
      invite.email,
      invite.message || '',
      invite.createdBy,
      invite.createdAt,
      invite.expiresAt
    );
  }

  async getInviteByToken(token) {
    const row = await this.db.get(`SELECT * FROM invites WHERE token = ?`, token);
    return this._normalizeInvite(row);
  }

  async listRoomElements(roomId) {
    const rows = await this.db.all(
      `SELECT payload FROM room_elements WHERE room_id = ? ORDER BY created_at ASC`,
      roomId
    );

    return rows
      .map((row) => {
        try {
          return JSON.parse(row.payload);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async upsertRoomElement(roomId, element) {
    const now = Date.now();
    await this.db.run(
      `
      INSERT INTO room_elements (id, room_id, payload, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        room_id = excluded.room_id,
        payload = excluded.payload
      `,
      element.id,
      roomId,
      JSON.stringify(element),
      now
    );
  }

  async removeRoomElement(roomId, elementId) {
    await this.db.run(
      `DELETE FROM room_elements WHERE room_id = ? AND id = ?`,
      roomId,
      elementId
    );
  }

  async clearRoomElements(roomId) {
    await this.db.run(`DELETE FROM room_elements WHERE room_id = ?`, roomId);
  }
}

module.exports = { DatabaseStore };
