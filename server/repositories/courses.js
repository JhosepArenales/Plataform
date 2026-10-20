import { newId, now, transaction } from '../db.js';

const LESSON_TYPES = new Set(['video', 'reading', 'quiz']);

export function createCoursesRepo(db) {
  function questionsFor(lessonId, { withAnswers }) {
    return db.prepare('SELECT * FROM questions WHERE lesson_id = ? ORDER BY position').all(lessonId).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: JSON.parse(q.options_json),
      time_limit_sec: q.time_limit_sec,
      ...(withAnswers ? { correct_index: q.correct_index, explanation: q.explanation } : {}),
    }));
  }

  function getCourse(id, { withAnswers = false } = {}) {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!course) return null;
    const lessons = db.prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY position').all(id).map((l) => ({
      ...l,
      questions: l.type === 'quiz' ? questionsFor(l.id, { withAnswers }) : [],
    }));
    const sources = db.prepare('SELECT id, kind, name, char_count, created_at FROM sources WHERE course_id = ? ORDER BY created_at').all(id);
    const areas = areasOf(id);
    return { ...course, generated_by_ai: !!course.generated_by_ai, area_ids: areas.map((a) => a.id), areas, lessons, sources };
  }

  function areasOf(courseId) {
    return db.prepare(`SELECT a.id, a.name, a.icon FROM course_areas ca JOIN areas a ON a.id = ca.area_id
      WHERE ca.course_id = ? ORDER BY a.name COLLATE NOCASE`).all(courseId);
  }

  // Un curso sin áreas es para toda la empresa; si tiene áreas, solo para esas.
  function isForArea(courseId, areaId) {
    const rows = db.prepare('SELECT area_id FROM course_areas WHERE course_id = ?').all(courseId);
    return rows.length === 0 || rows.some((r) => r.area_id === areaId);
  }

  function listCourses({ includeUnpublished = false, userId = null, areaId = null } = {}) {
    // Vista de aprendiz: solo cursos de toda la empresa o de su área.
    const where = includeUnpublished ? "c.status != 'archived'" : `c.status = 'published'
      AND (NOT EXISTS (SELECT 1 FROM course_areas ca WHERE ca.course_id = c.id)
        OR EXISTS (SELECT 1 FROM course_areas ca WHERE ca.course_id = c.id AND ca.area_id = ?))`;
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
        (SELECT COALESCE(SUM(duration_min),0) FROM lessons l WHERE l.course_id = c.id) AS total_min,
        (SELECT COUNT(*) FROM lessons l JOIN lesson_progress p ON p.lesson_id = l.id
           WHERE l.course_id = c.id AND p.user_id = ?) AS done_count
      FROM courses c
      WHERE ${where}
      ORDER BY c.updated_at DESC`).all(...(includeUnpublished ? [userId ?? ''] : [userId ?? '', areaId ?? '']));
    return rows.map((r) => {
      const areas = areasOf(r.id);
      return { ...r, generated_by_ai: !!r.generated_by_ai, area_ids: areas.map((a) => a.id), areas };
    });
  }

  function normalizeTree(tree) {
    if (!tree?.title?.trim()) throw Object.assign(new Error('El curso necesita un título.'), { status: 400 });
    const lessons = (tree.lessons ?? []).map((l, i) => {
      if (!LESSON_TYPES.has(l.type)) throw Object.assign(new Error(`Lección ${i + 1}: tipo inválido.`), { status: 400 });
      if (!l.title?.trim()) throw Object.assign(new Error(`Lección ${i + 1}: falta el título.`), { status: 400 });
      const questions = l.type === 'quiz' ? (l.questions ?? []).map((q, j) => {
        const options = (q.options ?? []).map((o) => String(o).trim()).filter(Boolean);
        if (!q.prompt?.trim() || options.length < 2 || options.length > 4) {
          throw Object.assign(new Error(`Lección "${l.title}", pregunta ${j + 1}: necesita enunciado y entre 2 y 4 opciones.`), { status: 400 });
        }
        const correct = Number(q.correct_index);
        if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          throw Object.assign(new Error(`Lección "${l.title}", pregunta ${j + 1}: marca la respuesta correcta.`), { status: 400 });
        }
        return {
          prompt: q.prompt.trim(), options, correct_index: correct,
          explanation: q.explanation ?? '', time_limit_sec: clamp(Number(q.time_limit_sec) || 20, 5, 120),
        };
      }) : [];
      return {
        id: l.id || null, type: l.type, title: l.title.trim(), content: l.content ?? '',
        video_url: l.type === 'video' ? (l.video_url || null) : null,
        duration_min: clamp(Number(l.duration_min) || 5, 1, 600), questions,
      };
    });
    const rawAreas = Array.isArray(tree.area_ids) ? tree.area_ids : (tree.areas ?? []).map((a) => a.id);
    const areaIds = [...new Set(rawAreas.map(String))];
    for (const aid of areaIds) {
      if (!db.prepare('SELECT 1 FROM areas WHERE id = ?').get(aid)) throw Object.assign(new Error('Una de las áreas elegidas no existe.'), { status: 400 });
    }
    return {
      title: tree.title.trim(), description: tree.description ?? '', category: tree.category?.trim() || 'General',
      cover_emoji: tree.cover_emoji || '📘', lessons, area_ids: areaIds,
    };
  }

  // Guarda lecciones conservando los ids existentes: el progreso de cada persona
  // está ligado al id de la lección y no debe perderse al editar el curso.
  function writeLessons(courseId, lessons) {
    const existingIds = new Set(db.prepare('SELECT id FROM lessons WHERE course_id = ?').all(courseId).map((r) => r.id));
    const keptIds = new Set();
    const ts = now();
    lessons.forEach((l, position) => {
      let id = l.id && existingIds.has(l.id) ? l.id : null;
      if (id) {
        db.prepare('UPDATE lessons SET position=?, type=?, title=?, content=?, video_url=?, duration_min=?, updated_at=? WHERE id=?')
          .run(position, l.type, l.title, l.content, l.video_url, l.duration_min, ts, id);
        db.prepare('DELETE FROM questions WHERE lesson_id = ?').run(id);
      } else {
        id = newId();
        db.prepare('INSERT INTO lessons (id, course_id, position, type, title, content, video_url, duration_min, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, courseId, position, l.type, l.title, l.content, l.video_url, l.duration_min, ts);
      }
      keptIds.add(id);
      l.questions.forEach((q, qpos) => {
        db.prepare('INSERT INTO questions (id, lesson_id, position, prompt, options_json, correct_index, explanation, time_limit_sec) VALUES (?,?,?,?,?,?,?,?)')
          .run(newId(), id, qpos, q.prompt, JSON.stringify(q.options), q.correct_index, q.explanation, q.time_limit_sec);
      });
    });
    for (const oldId of existingIds) if (!keptIds.has(oldId)) db.prepare('DELETE FROM lessons WHERE id = ?').run(oldId);
  }

  function writeAreas(courseId, areaIds) {
    db.prepare('DELETE FROM course_areas WHERE course_id = ?').run(courseId);
    for (const aid of areaIds) db.prepare('INSERT INTO course_areas (course_id, area_id) VALUES (?, ?)').run(courseId, aid);
  }

  function snapshot(courseId, changeNote, userId) {
    const current = getCourse(courseId, { withAnswers: true });
    db.prepare('INSERT INTO course_versions (id, course_id, version, change_note, snapshot_json, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId(), courseId, current.version, changeNote, JSON.stringify(current), userId, now());
  }

  function createCourse(tree, { userId, generatedByAi = false, sourceIds = [] } = {}) {
    const data = normalizeTree(tree);
    const id = newId();
    const ts = now();
    transaction(db, () => {
      db.prepare('INSERT INTO courses (id, title, description, category, cover_emoji, status, version, generated_by_ai, created_by, created_at, updated_at) VALUES (?,?,?,?,?,\'draft\',1,?,?,?,?)')
        .run(id, data.title, data.description, data.category, data.cover_emoji, generatedByAi ? 1 : 0, userId, ts, ts);
      writeLessons(id, data.lessons);
      writeAreas(id, data.area_ids);
      for (const sid of sourceIds) db.prepare('UPDATE sources SET course_id = ? WHERE id = ?').run(id, sid);
      snapshot(id, generatedByAi ? 'Versión inicial generada con IA' : 'Versión inicial', userId);
    });
    return getCourse(id, { withAnswers: true });
  }

  // Cada guardado incrementa la versión y deja una foto restaurable del resultado.
  function updateCourse(id, tree, { userId, changeNote = 'Edición manual', sourceIds = [] } = {}) {
    const existing = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!existing) throw Object.assign(new Error('Curso no encontrado.'), { status: 404 });
    const data = normalizeTree(tree);
    transaction(db, () => {
      db.prepare('UPDATE courses SET title=?, description=?, category=?, cover_emoji=?, version=version+1, updated_at=? WHERE id=?')
        .run(data.title, data.description, data.category, data.cover_emoji, now(), id);
      writeLessons(id, data.lessons);
      writeAreas(id, data.area_ids);
      for (const sid of sourceIds) db.prepare('UPDATE sources SET course_id = ? WHERE id = ?').run(id, sid);
      snapshot(id, changeNote, userId);
    });
    return getCourse(id, { withAnswers: true });
  }

  function setStatus(id, status) {
    const r = db.prepare('UPDATE courses SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
    if (!r.changes) throw Object.assign(new Error('Curso no encontrado.'), { status: 404 });
  }

  function listVersions(courseId) {
    return db.prepare(`SELECT v.id, v.version, v.change_note, v.created_at, u.name AS author
      FROM course_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.course_id = ? ORDER BY v.version DESC`).all(courseId);
  }

  function restoreVersion(courseId, versionId, { userId }) {
    const v = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(versionId, courseId);
    if (!v) throw Object.assign(new Error('Versión no encontrada.'), { status: 404 });
    const snap = JSON.parse(v.snapshot_json);
    return updateCourse(courseId, snap, { userId, changeNote: `Restaurada la versión ${v.version}` });
  }

  function saveSource({ kind, name, text, userId }) {
    const id = newId();
    db.prepare('INSERT INTO sources (id, course_id, kind, name, extracted_text, char_count, created_by, created_at) VALUES (?,NULL,?,?,?,?,?,?)')
      .run(id, kind, name, text, text.length, userId, now());
    return { id, kind, name, char_count: text.length };
  }

  function getSources(ids) {
    return ids.map((id) => db.prepare('SELECT * FROM sources WHERE id = ?').get(id)).filter(Boolean);
  }

  return { getCourse, listCourses, isForArea, createCourse, updateCourse, setStatus, listVersions, restoreVersion, saveSource, getSources, normalizeTree };
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, Math.round(n))); }
