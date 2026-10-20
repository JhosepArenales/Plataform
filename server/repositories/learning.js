import { newId, now, transaction } from '../db.js';

// Reglas de gamificación en un solo lugar para poder ajustarlas sin buscar en el código.
export const XP = { lesson: 10, quizCorrect: 5, quizPerfect: 20, courseCompleted: 50, gamePodium: 30, gamePlayed: 10 };
const LEVELS = [
  { min: 0, name: 'Explorador' }, { min: 100, name: 'Aprendiz' }, { min: 300, name: 'Practicante' },
  { min: 700, name: 'Experto' }, { min: 1500, name: 'Maestro' },
];

export function levelFor(xp) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (xp >= l.min) idx = i; });
  const next = LEVELS[idx + 1];
  return { level: idx + 1, name: LEVELS[idx].name, xp, next_at: next?.min ?? null };
}

export function createLearningRepo(db) {
  function award(userId, reason, points) {
    db.prepare('INSERT INTO xp_events (id, user_id, reason, points, created_at) VALUES (?,?,?,?,?)').run(newId(), userId, reason, points, now());
  }

  function courseIdOf(lessonId) {
    return db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId)?.course_id ?? null;
  }

  function courseCompleted(userId, courseId) {
    const r = db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END) AS done
      FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ?
      WHERE l.course_id = ?`).get(userId, courseId);
    return r.total > 0 && r.done === r.total;
  }

  // Idempotente: completar dos veces no duplica XP.
  function completeLesson(userId, lessonId) {
    const courseId = courseIdOf(lessonId);
    if (!courseId) throw Object.assign(new Error('Lección no encontrada.'), { status: 404 });
    let gained = 0;
    let finishedCourse = false;
    transaction(db, () => {
      const r = db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?,?,?)').run(userId, lessonId, now());
      if (r.changes) {
        award(userId, 'Lección completada', XP.lesson); gained += XP.lesson;
        if (courseCompleted(userId, courseId)) {
          const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(courseId);
          award(userId, `Curso completado: ${course.title}`, XP.courseCompleted); gained += XP.courseCompleted;
          finishedCourse = true;
        }
      }
    });
    return { gained, finished_course: finishedCourse, progress: progressFor(userId, courseId) };
  }

  // La corrección ocurre en el servidor: el navegador nunca recibe las respuestas
  // correctas antes de responder.
  function submitQuiz(userId, lessonId, answers) {
    const questions = db.prepare('SELECT * FROM questions WHERE lesson_id = ? ORDER BY position').all(lessonId);
    if (!questions.length) throw Object.assign(new Error('Este quiz no tiene preguntas.'), { status: 400 });
    const results = questions.map((q, i) => ({
      question_id: q.id, chosen: answers[i] ?? null, correct_index: q.correct_index,
      is_correct: answers[i] === q.correct_index, explanation: q.explanation,
    }));
    const score = results.filter((r) => r.is_correct).length;
    const prevBest = db.prepare('SELECT MAX(score) AS best FROM quiz_attempts WHERE user_id = ? AND lesson_id = ?').get(userId, lessonId).best ?? 0;
    let gained = 0;
    transaction(db, () => {
      db.prepare('INSERT INTO quiz_attempts (id, user_id, lesson_id, score, total, created_at) VALUES (?,?,?,?,?,?)')
        .run(newId(), userId, lessonId, score, questions.length, now());
      // Solo se premia la mejora sobre el mejor intento anterior, para no incentivar repetir por puntos.
      const improvement = Math.max(0, score - prevBest);
      if (improvement) { award(userId, 'Respuestas correctas en quiz', improvement * XP.quizCorrect); gained += improvement * XP.quizCorrect; }
      if (score === questions.length && prevBest < questions.length) { award(userId, 'Quiz perfecto', XP.quizPerfect); gained += XP.quizPerfect; }
    });
    const passed = score / questions.length >= 0.7;
    let completion = null;
    if (passed) completion = completeLesson(userId, lessonId);
    return { score, total: questions.length, passed, results, gained: gained + (completion?.gained ?? 0), finished_course: completion?.finished_course ?? false };
  }

  function progressFor(userId, courseId) {
    const done = db.prepare(`SELECT l.id FROM lessons l JOIN lesson_progress p ON p.lesson_id = l.id
      WHERE l.course_id = ? AND p.user_id = ?`).all(courseId, userId).map((r) => r.id);
    const total = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?').get(courseId).n;
    return { done_lesson_ids: done, done: done.length, total, percent: total ? Math.round((done.length / total) * 100) : 0 };
  }

  function myStats(userId) {
    const xp = db.prepare('SELECT COALESCE(SUM(points),0) AS xp FROM xp_events WHERE user_id = ?').get(userId).xp;
    const lessons = db.prepare('SELECT COUNT(*) AS n FROM lesson_progress WHERE user_id = ?').get(userId).n;
    const perfect = db.prepare('SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id = ? AND score = total').get(userId).n;
    const courses = db.prepare("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND reason LIKE 'Curso completado%'").get(userId).n;
    const games = db.prepare("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND reason LIKE 'Juego en vivo%'").get(userId).n;
    const badges = [
      { id: 'first', icon: '🚀', name: 'Primer paso', desc: 'Completa tu primera lección', earned: lessons >= 1 },
      { id: 'ten', icon: '📚', name: 'Constante', desc: 'Completa 10 lecciones', earned: lessons >= 10 },
      { id: 'perfect', icon: '🎯', name: 'Puntería', desc: 'Saca 100% en un quiz', earned: perfect >= 1 },
      { id: 'course', icon: '🏅', name: 'Graduado', desc: 'Termina un curso completo', earned: courses >= 1 },
      { id: 'game', icon: '🎮', name: 'Competidor', desc: 'Juega una partida en vivo', earned: games >= 1 },
    ];
    const recent = db.prepare('SELECT reason, points, created_at FROM xp_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').all(userId);
    return { ...levelFor(xp), lessons_done: lessons, courses_done: courses, badges, recent };
  }

  // areaId opcional: ranking solo entre personas de la misma área.
  function leaderboard(limit = 10, areaId = null) {
    return db.prepare(`SELECT u.id, u.name, COALESCE(SUM(x.points),0) AS xp
      FROM users u LEFT JOIN xp_events x ON x.user_id = u.id
      WHERE u.active = 1 ${areaId ? 'AND u.area_id = ?' : ''} GROUP BY u.id ORDER BY xp DESC, u.name LIMIT ?`).all(...(areaId ? [areaId, limit] : [limit]))
      .map((r) => ({ ...r, level: levelFor(r.xp).name }));
  }

  // Avance por área: % promedio de lecciones completadas de los cursos que le corresponden a cada persona.
  function areaMetrics() {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const areas = db.prepare('SELECT id, name, icon FROM areas WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
    return areas.map((a) => {
      const lessonIds = db.prepare(`SELECT l.id FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE c.status = 'published' AND (NOT EXISTS (SELECT 1 FROM course_areas ca WHERE ca.course_id = c.id)
          OR EXISTS (SELECT 1 FROM course_areas ca WHERE ca.course_id = c.id AND ca.area_id = ?))`).all(a.id).map((r) => r.id);
      const people = db.prepare('SELECT id FROM users WHERE active = 1 AND area_id = ?').all(a.id).map((r) => r.id);
      const assigned = new Set(lessonIds);
      let sum = 0;
      for (const uid of people) {
        const done = db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ?').all(uid).filter((r) => assigned.has(r.lesson_id)).length;
        sum += assigned.size ? done / assigned.size : 0;
      }
      const activeWeek = people.length ? db.prepare(`SELECT COUNT(DISTINCT x.user_id) AS n FROM xp_events x JOIN users u ON u.id = x.user_id
        WHERE u.area_id = ? AND x.created_at > ?`).get(a.id, weekAgo).n : 0;
      return { ...a, people: people.length, active_week: activeWeek, assigned_lessons: assigned.size, avg_progress: people.length ? Math.round((100 * sum) / people.length) : null };
    });
  }

  // Indicadores para el panel de administración.
  function adminMetrics() {
    const learners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'learner'").get().n;
    const activeWeek = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM xp_events WHERE created_at > ?')
      .get(new Date(Date.now() - 7 * 864e5).toISOString()).n;
    const courses = db.prepare(`SELECT c.id, c.title, c.cover_emoji, c.status, c.version,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons,
        (SELECT COUNT(DISTINCT p.user_id) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE l.course_id = c.id) AS started,
        (SELECT ROUND(AVG(100.0 * a.score / a.total)) FROM quiz_attempts a JOIN lessons l ON l.id = a.lesson_id WHERE l.course_id = c.id) AS avg_quiz
      FROM courses c WHERE c.status != 'archived' ORDER BY c.updated_at DESC`).all();
    for (const c of courses) {
      c.completed = c.lessons ? db.prepare(`SELECT COUNT(*) AS n FROM (
          SELECT p.user_id FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
          WHERE l.course_id = ? GROUP BY p.user_id HAVING COUNT(*) = ?)`).get(c.id, c.lessons).n : 0;
      c.completion_rate = c.started ? Math.round((100 * c.completed) / c.started) : 0;
    }
    const noArea = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1 AND area_id IS NULL').get().n;
    return { learners, active_week: activeWeek, courses, areas: areaMetrics(), people_without_area: noArea };
  }

  return { completeLesson, submitQuiz, progressFor, myStats, leaderboard, adminMetrics, award };
}
