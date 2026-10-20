// Capa de acceso a datos. SQLite embebido (node:sqlite) con un esquema
// normalizado listo para migrarse a Postgres/MySQL copiando filas.
// Convenciones: ids TEXT (UUID), fechas ISO 8601 UTC, JSON solo en campos
// cuyo contenido es un documento (opciones de pregunta, snapshot de versión).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '🏢',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','learner')),
  area_id TEXT REFERENCES areas(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  cover_emoji TEXT NOT NULL DEFAULT '📘',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  generated_by_ai INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Sin filas para un curso = el curso es para toda la empresa.
CREATE TABLE IF NOT EXISTS course_areas (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL REFERENCES areas(id),
  PRIMARY KEY (course_id, area_id)
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video','reading','quiz')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  duration_min INTEGER NOT NULL DEFAULT 5,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  time_limit_sec INTEGER NOT NULL DEFAULT 20
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS course_versions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  change_note TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_course_areas_area ON course_areas(area_id);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id, position);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions(lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_progress_user ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_course ON course_versions(course_id, version);
`;

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const DEFAULT_AREAS = [
  ['Comercial', '💼'], ['Operaciones', '⚙️'], ['Atención al cliente', '🎧'],
  ['Tecnología', '💻'], ['Finanzas', '📊'], ['Recursos Humanos', '🤝'],
];

// Cambios de esquema para bases creadas con versiones anteriores.
function migrate(db) {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('area_id')) db.exec('ALTER TABLE users ADD COLUMN area_id TEXT REFERENCES areas(id)');
  if (db.prepare('SELECT COUNT(*) AS n FROM areas').get().n === 0) {
    const ins = db.prepare('INSERT INTO areas (id, name, icon, active, created_at) VALUES (?, ?, ?, 1, ?)');
    for (const [name, icon] of DEFAULT_AREAS) ins.run(randomUUID(), name, icon, now());
  }
}

// Ejecuta fn dentro de una transacción; revierte todo si algo falla, para que
// un curso nunca quede a medio guardar (lecciones sin preguntas, etc.).
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
