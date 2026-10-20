import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createUsersRepo } from './repositories/users.js';
import { createAreasRepo } from './repositories/areas.js';
import { createCoursesRepo } from './repositories/courses.js';
import { createLearningRepo, XP } from './repositories/learning.js';
import { extractFromFile, extractFromUrl, extractFromText, SUPPORTED } from './services/extract.js';
import { aiAvailable, generateCourse, updateCourseWithSources } from './services/ai.js';
import { createLiveGames } from './services/live-game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg']);

export function createApp({
  dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'),
  dbFile,
  adminEmails = (process.env.ADMIN_EMAILS || '').split(','),
  allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || '',
  maxVideoMb = Number(process.env.MAX_VIDEO_MB || 1024),
  ai = { aiAvailable, generateCourse, updateCourseWithSources },
} = {}) {
  const db = openDatabase(dbFile ?? path.join(dataDir, 'academia.db'));
  const users = createUsersRepo(db, { adminEmails });
  const courses = createCoursesRepo(db);
  const areas = createAreasRepo(db);
  const learning = createLearningRepo(db);
  const games = createLiveGames({
    onFinished: ({ title, ranking }) => {
      for (const p of ranking) {
        if (!p.userId) continue;
        learning.award(p.userId, `Juego en vivo: ${title}`, XP.gamePlayed);
        if (p.rank <= 3) learning.award(p.userId, `Juego en vivo: podio #${p.rank}`, XP.gamePodium);
      }
    },
  });
  const sweeper = setInterval(() => games.sweep(), 10 * 60 * 1000);
  sweeper.unref();

  const videoDir = path.join(dataDir, 'uploads', 'videos');
  fs.mkdirSync(videoDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // ---------- Autenticación ----------
  const auth = (required = true) => (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    req.user = users.userForToken(token);
    req.token = token;
    if (required && !req.user) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a ingresar.' });
    next();
  };
  const adminOnly = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Necesitas permisos de administrador.' }));
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (err) { next(err); } };

  app.post('/api/auth/login', wrap((req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
    if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) return res.status(403).json({ error: `Solo se permiten correos @${allowedDomain}.` });
    // Primera vez: no es un error, es un paso más del ingreso.
    if (!users.findByEmail(email) && !name) return res.json({ needs_name: true });
    const user = users.upsertOnLogin({ email, name: name || undefined });
    res.json({ token: users.createSession(user.id), user: publicUser(user) });
  }));

  app.post('/api/auth/logout', auth(), (req, res) => { users.deleteSession(req.token); res.json({ ok: true }); });

  app.get('/api/me', auth(), (req, res) => res.json({ user: publicUser(req.user), stats: learning.myStats(req.user.id) }));

  // La persona elige (o cambia) su área; define qué cursos ve.
  app.post('/api/me/area', auth(), wrap((req, res) => {
    const area = areas.assertSelectable(String(req.body?.area_id ?? ''));
    users.setArea(req.user.id, area.id);
    res.json({ ok: true, area: { id: area.id, name: area.name, icon: area.icon } });
  }));

  // ---------- Áreas ----------
  app.get('/api/areas', auth(), (req, res) => res.json(areas.list({ includeInactive: req.user.role === 'admin' && req.query.all === '1' })));
  app.post('/api/areas', auth(), adminOnly, wrap((req, res) => res.status(201).json(areas.create(req.body ?? {}))));
  app.put('/api/areas/:id', auth(), adminOnly, wrap((req, res) => res.json(areas.update(req.params.id, req.body ?? {}))));

  // ---------- Cursos ----------
  app.get('/api/courses', auth(), (req, res) => {
    const includeUnpublished = req.user.role === 'admin' && req.query.all === '1';
    res.json(courses.listCourses({ includeUnpublished, userId: req.user.id, areaId: req.user.area_id }));
  });

  app.get('/api/courses/:id', auth(), (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const course = courses.getCourse(req.params.id, { withAnswers: isAdmin });
    if (!course || (!isAdmin && (course.status !== 'published' || !courses.isForArea(course.id, req.user.area_id)))) {
      return res.status(404).json({ error: 'Curso no encontrado.' });
    }
    res.json({ ...course, progress: learning.progressFor(req.user.id, course.id) });
  });

  app.post('/api/courses', auth(), adminOnly, wrap((req, res) => {
    res.status(201).json(courses.createCourse(req.body, { userId: req.user.id, sourceIds: req.body.source_ids ?? [], generatedByAi: !!req.body.generated_by_ai }));
  }));

  app.put('/api/courses/:id', auth(), adminOnly, wrap((req, res) => {
    const note = String(req.body.change_note ?? '').trim() || 'Edición manual';
    res.json(courses.updateCourse(req.params.id, req.body, { userId: req.user.id, changeNote: note, sourceIds: req.body.source_ids ?? [] }));
  }));

  app.post('/api/courses/:id/status', auth(), adminOnly, wrap((req, res) => {
    const status = req.body?.status;
    if (!['draft', 'published', 'archived'].includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
    if (status === 'published') {
      const c = courses.getCourse(req.params.id);
      if (!c?.lessons.length) return res.status(400).json({ error: 'Agrega al menos una lección antes de publicar.' });
    }
    courses.setStatus(req.params.id, status);
    res.json({ ok: true, status });
  }));

  app.get('/api/courses/:id/versions', auth(), adminOnly, (req, res) => res.json(courses.listVersions(req.params.id)));

  app.post('/api/courses/:id/versions/:versionId/restore', auth(), adminOnly, wrap((req, res) => {
    res.json(courses.restoreVersion(req.params.id, req.params.versionId, { userId: req.user.id }));
  }));

  // ---------- Aprendizaje ----------
  app.post('/api/lessons/:id/complete', auth(), wrap((req, res) => res.json(learning.completeLesson(req.user.id, req.params.id))));

  app.post('/api/lessons/:id/quiz', auth(), wrap((req, res) => {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.map((a) => (a === null ? null : Number(a))) : [];
    res.json(learning.submitQuiz(req.user.id, req.params.id, answers));
  }));

  app.get('/api/leaderboard', auth(), (req, res) => {
    const byArea = req.query.scope === 'area' && req.user.area_id;
    res.json(learning.leaderboard(20, byArea ? req.user.area_id : null));
  });

  // ---------- Videos ----------
  const videoUpload = multer({
    storage: multer.diskStorage({
      destination: videoDir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: maxVideoMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ok = VIDEO_EXT.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : Object.assign(new Error('Formato de video no soportado. Usa MP4, WebM o MOV.'), { status: 415 }), ok);
    },
  });
  app.post('/api/videos', auth(), adminOnly, videoUpload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecciona un video.' });
    res.status(201).json({ url: `/media/videos/${req.file.filename}`, size: req.file.size, name: req.file.originalname });
  });
  app.use('/media/videos', express.static(videoDir, { maxAge: '7d', fallthrough: false }));

  // ---------- Fuentes de conocimiento (PDF, Word, Excel, PPT, web, texto) ----------
  const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 10 } });

  app.post('/api/sources/files', auth(), adminOnly, docUpload.array('files', 10), wrap(async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Adjunta al menos un archivo.' });
    const results = [];
    for (const f of req.files) {
      // multer entrega el nombre en latin1; se reinterpreta para conservar tildes y ñ.
      const filename = Buffer.from(f.originalname, 'latin1').toString('utf8');
      try {
        const ex = await extractFromFile({ buffer: f.buffer, filename });
        results.push({ ...courses.saveSource({ kind: ex.kind, name: ex.name, text: ex.text, userId: req.user.id }), truncated: ex.truncated, preview: ex.text.slice(0, 400) });
      } catch (err) {
        results.push({ name: filename, error: err.message });
      }
    }
    res.json(results);
  }));

  app.post('/api/sources/url', auth(), adminOnly, wrap(async (req, res) => {
    const ex = await extractFromUrl(String(req.body?.url ?? ''));
    res.json({ ...courses.saveSource({ kind: ex.kind, name: ex.name, text: ex.text, userId: req.user.id }), truncated: ex.truncated, preview: ex.text.slice(0, 400) });
  }));

  app.post('/api/sources/text', auth(), adminOnly, wrap((req, res) => {
    const ex = extractFromText(String(req.body?.name ?? ''), String(req.body?.text ?? ''));
    res.json({ ...courses.saveSource({ kind: ex.kind, name: ex.name, text: ex.text, userId: req.user.id }), truncated: ex.truncated, preview: ex.text.slice(0, 400) });
  }));

  app.get('/api/sources/formats', auth(), (req, res) => res.json(Object.keys(SUPPORTED)));

  // ---------- IA ----------
  app.get('/api/ai/status', auth(), (req, res) => res.json({ available: ai.aiAvailable() }));

  app.post('/api/ai/generate', auth(), adminOnly, wrap(async (req, res) => {
    const sourceIds = req.body?.source_ids ?? [];
    const sources = courses.getSources(sourceIds);
    if (!sources.length) return res.status(400).json({ error: 'Agrega al menos una fuente.' });
    const lessonCount = Math.min(15, Math.max(2, Number(req.body?.lesson_count) || 6));
    const draft = await ai.generateCourse({ sources, instructions: String(req.body?.instructions ?? ''), lessonCount });
    const course = courses.createCourse({ ...draft, area_ids: req.body?.area_ids ?? [] }, { userId: req.user.id, generatedByAi: draft.mode === 'ai', sourceIds });
    res.status(201).json({ course, mode: draft.mode, summary: draft.change_summary, truncated: draft.truncated });
  }));

  // Devuelve una propuesta; no guarda. Una persona revisa y guarda (queda como nueva versión).
  app.post('/api/courses/:id/ai-update', auth(), adminOnly, wrap(async (req, res) => {
    const course = courses.getCourse(req.params.id, { withAnswers: true });
    if (!course) return res.status(404).json({ error: 'Curso no encontrado.' });
    const sources = courses.getSources(req.body?.source_ids ?? []);
    if (!sources.length) return res.status(400).json({ error: 'Agrega el material actualizado.' });
    const proposal = await ai.updateCourseWithSources({ course, sources, instructions: String(req.body?.instructions ?? '') });
    res.json(proposal);
  }));

  // ---------- Administración ----------
  app.get('/api/admin/metrics', auth(), adminOnly, (req, res) => res.json(learning.adminMetrics()));
  app.get('/api/admin/users', auth(), adminOnly, (req, res) => res.json(users.list()));
  app.post('/api/admin/users/:id/area', auth(), adminOnly, wrap((req, res) => {
    const areaId = req.body?.area_id ? areas.assertSelectable(String(req.body.area_id)).id : null;
    users.setArea(req.params.id, areaId);
    res.json({ ok: true });
  }));

  app.post('/api/admin/users/:id/role', auth(), adminOnly, wrap((req, res) => {
    const role = req.body?.role;
    if (!['admin', 'learner'].includes(role)) return res.status(400).json({ error: 'Rol inválido.' });
    if (req.params.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte tu propio rol de administrador.' });
    users.setRole(req.params.id, role);
    res.json({ ok: true });
  }));

  // ---------- Juego en vivo ----------
  app.post('/api/games', auth(), adminOnly, wrap((req, res) => {
    const course = courses.getCourse(String(req.body?.course_id ?? ''), { withAnswers: true });
    if (!course) return res.status(404).json({ error: 'Curso no encontrado.' });
    const quizLessons = course.lessons.filter((l) => l.type === 'quiz' && (!req.body.lesson_id || l.id === req.body.lesson_id));
    const questions = quizLessons.flatMap((l) => l.questions);
    const created = games.create({ hostUserId: req.user.id, title: course.title, questions });
    res.status(201).json({ ...created, question_count: questions.length });
  }));

  app.post('/api/games/:pin/join', auth(false), wrap((req, res) => {
    res.json(games.join(req.params.pin, { nickname: req.body?.nickname, userId: req.user?.id ?? null }));
  }));
  app.post('/api/games/:pin/start', wrap((req, res) => { games.start(req.params.pin, req.body?.hostKey); res.json({ ok: true }); }));
  app.post('/api/games/:pin/next', wrap((req, res) => { games.next(req.params.pin, req.body?.hostKey); res.json({ ok: true }); }));
  app.post('/api/games/:pin/end', wrap((req, res) => { games.end(req.params.pin, req.body?.hostKey); res.json({ ok: true }); }));
  app.post('/api/games/:pin/answer', wrap((req, res) => res.json(games.answer(req.params.pin, req.body ?? {}))));

  // EventSource no permite cabeceras, por eso las llaves viajan en la query.
  app.get('/api/games/:pin/events', (req, res, next) => {
    let unsubscribe;
    try {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      unsubscribe = games.subscribe(req.params.pin, {
        role: req.query.role === 'host' ? 'host' : 'player',
        hostKey: req.query.hostKey, playerId: req.query.playerId, playerKey: req.query.playerKey,
      }, (data) => res.write(`data: ${JSON.stringify(data)}\n\n`));
    } catch (err) {
      return next(err);
    }
    res.flushHeaders?.();
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  // ---------- Frontend ----------
  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, ai: ai.aiAvailable() }));

  // ---------- Errores ----------
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = err.status ?? err.statusCode ?? 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo permitido.' : err.message;
    } else if (err.name === 'ZodError' || err instanceof SyntaxError) {
      status = 502; message = 'La IA devolvió un formato inesperado. Intenta de nuevo.';
    } else if (err.constructor?.name?.endsWith('RateLimitError') || err.status === 429) {
      status = 503; message = 'El servicio de IA está saturado. Intenta en un minuto; tus fuentes quedaron guardadas.';
    }
    if (status >= 500 && status !== 503) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Ocurrió un error inesperado. Intenta de nuevo.' : message });
  });

  return { app, db, close: () => { clearInterval(sweeper); db.close(); } };
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, area_id: u.area_id ?? null, area_name: u.area_name ?? null, area_icon: u.area_icon ?? null };
}
