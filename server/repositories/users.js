import { randomBytes } from 'node:crypto';
import { newId, now } from '../db.js';

const SESSION_DAYS = 14;

export function createUsersRepo(db, { adminEmails = [] } = {}) {
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));

  function findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  }

  // Alta y activación ocurren en la misma operación: un usuario creado nunca
  // queda inactivo esperando un segundo paso que alguien pueda olvidar.
  function upsertOnLogin({ email, name }) {
    const normalized = email.trim().toLowerCase();
    const existing = findByEmail(normalized);
    if (existing) {
      if (!existing.active) throw Object.assign(new Error('Tu usuario está desactivado. Pide acceso a un administrador.'), { status: 403 });
      if (name && name !== existing.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
      if (admins.has(normalized) && existing.role !== 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
      return findByEmail(normalized);
    }
    const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const role = admins.has(normalized) || isFirstUser ? 'admin' : 'learner';
    const id = newId();
    db.prepare('INSERT INTO users (id, email, name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(id, normalized, name.trim(), role, now());
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  function createSession(userId) {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now(), expires);
    return token;
  }

  function userForToken(token) {
    if (!token) return null;
    return db.prepare(`
      SELECT u.*, a.name AS area_name, a.icon AS area_icon FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN areas a ON a.id = u.area_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, now()) ?? null;
  }

  function setArea(userId, areaId) {
    db.prepare('UPDATE users SET area_id = ? WHERE id = ?').run(areaId, userId);
  }

  function deleteSession(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  function list() {
    return db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.area_id,
        COALESCE((SELECT SUM(points) FROM xp_events x WHERE x.user_id = u.id), 0) AS xp,
        (SELECT COUNT(*) FROM lesson_progress p WHERE p.user_id = u.id) AS lessons_done
      FROM users u ORDER BY u.created_at`).all();
  }

  function setRole(id, role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  return { findByEmail, upsertOnLogin, createSession, userForToken, deleteSession, list, setRole, setArea };
}
