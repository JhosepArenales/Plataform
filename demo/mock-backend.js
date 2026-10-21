// Backend simulado para la demostración: replica en el navegador las reglas
// de server/ (cursos, versiones, progreso, XP, juego en vivo, fuentes e IA)
// para que la interfaz real funcione sin servidor. Lo usa demo/build.mjs.

const DEMO_KEY = 'academia-demo-v2';
const nowIso = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

// Almacenamiento tolerante: el visor puede bloquear localStorage/sessionStorage.
function safeStorage(kind) {
  const mem = new Map();
  const fallback = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k), clear: () => mem.clear(),
  };
  try {
    const s = window[kind];
    const probe = '__academia_probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    return s;
  } catch { return fallback; }
}
const localStorage = safeStorage('localStorage');
const sessionStorage = safeStorage('sessionStorage');

// ---------- Capacidades del visor (IA y sala en tiempo real) ----------
const capability = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const samplePromise = capability('sample');
const roomPromise = capability('room');

// ---------- Estado ----------
let store = loadStore() ?? null;
function loadStore() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { return null; } }
// Guardado inmediato: algunas acciones recargan la página justo después de responder.
function persist() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(store)); } catch { /* sin espacio o bloqueado */ }
}
function emptyStore() { return { areas: [], users: [], sessions: {}, courses: [], versions: [], sources: [], progress: [], attempts: [], xp: [] }; }

// ---------- Usuarios ----------
const users = {
  byEmail: (email) => store.users.find((u) => u.email === email.toLowerCase()),
  byToken: (token) => { const s = token && store.sessions[token]; return s ? store.users.find((u) => u.id === s && u.active) : null; },
  login({ email, name }) {
    const normalized = email.trim().toLowerCase();
    let u = users.byEmail(normalized);
    if (u) { if (name && name !== u.name) u.name = name; }
    else {
      u = { id: uid(), email: normalized, name: name.trim(), role: store.users.length === 0 ? 'admin' : 'learner', area_id: null, active: 1, created_at: nowIso() };
      store.users.push(u);
    }
    const token = hex(24);
    store.sessions[token] = u.id;
    return { token, user: publicUser(u) };
  },
};
const areaById = (id) => store.areas.find((a) => a.id === id) ?? null;
const publicUser = (u) => {
  const a = areaById(u.area_id);
  return { id: u.id, email: u.email, name: u.name, role: u.role, area_id: a?.id ?? null, area_name: a?.name ?? null, area_icon: a?.icon ?? null };
};

// ---------- Áreas ----------
const areaPublic = (c) => (c.area_ids ?? []).map(areaById).filter(Boolean).map(({ id, name, icon }) => ({ id, name, icon }));
const isForArea = (c, areaId) => !(c.area_ids?.length) || c.area_ids.includes(areaId);
function listAreas(includeInactive) {
  return store.areas.filter((a) => includeInactive || a.active).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((a) => ({
    ...a, active: !!a.active,
    people: store.users.filter((u) => u.active && u.area_id === a.id).length,
    courses: store.courses.filter((c) => c.status === 'published' && c.area_ids?.includes(a.id)).length,
  }));
}
function cleanAreaName(name, exceptId = null) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 40) throw httpError(400, 'El nombre del área debe tener entre 2 y 40 caracteres.');
  if (store.areas.some((a) => a.id !== exceptId && a.name.toLowerCase() === n.toLowerCase())) throw httpError(409, `Ya existe un área llamada "${n}".`);
  return n;
}
function selectableArea(id) {
  const a = areaById(id);
  if (!a || !a.active) throw httpError(400, 'Elige un área válida.');
  return a;
}
function areaMetrics() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  return listAreas(false).map((a) => {
    const assigned = new Set(store.courses.filter((c) => c.status === 'published' && isForArea(c, a.id)).flatMap((c) => c.lessons.map((l) => l.id)));
    const people = store.users.filter((u) => u.active && u.area_id === a.id);
    const sum = people.reduce((acc, u) => acc + (assigned.size ? store.progress.filter((p) => p.user_id === u.id && assigned.has(p.lesson_id)).length / assigned.size : 0), 0);
    const activeWeek = new Set(store.xp.filter((x) => x.created_at > weekAgo && people.some((u) => u.id === x.user_id)).map((x) => x.user_id)).size;
    return { id: a.id, name: a.name, icon: a.icon, people: people.length, active_week: activeWeek, assigned_lessons: assigned.size, avg_progress: people.length ? Math.round((100 * sum) / people.length) : null };
  });
}

// ---------- Cursos ----------
// Conserva los ids de lecciones existentes: el progreso de cada persona depende de ellos.
function writeLessons(course, lessons) {
  const existing = new Set(course.lessons.map((l) => l.id));
  const ts = nowIso();
  const kept = new Set();
  course.lessons = lessons.map((l, position) => {
    const id = l.id && existing.has(l.id) ? l.id : uid();
    kept.add(id);
    return { ...l, id, position, updated_at: ts, questions: l.questions.map((q) => ({ ...q, id: uid() })) };
  });
  const removed = [...existing].filter((id) => !kept.has(id));
  if (removed.length) {
    store.progress = store.progress.filter((p) => !removed.includes(p.lesson_id));
    store.attempts = store.attempts.filter((a) => !removed.includes(a.lesson_id));
  }
}

function courseView(c, { withAnswers }) {
  return {
    ...c, generated_by_ai: !!c.generated_by_ai,
    lessons: c.lessons.map((l) => ({
      ...l,
      questions: l.type === 'quiz' ? l.questions.map((q) => (withAnswers ? { ...q } : { id: q.id, prompt: q.prompt, options: q.options, time_limit_sec: q.time_limit_sec })) : [],
    })),
    area_ids: [...(c.area_ids ?? [])], areas: areaPublic(c),
    sources: store.sources.filter((s) => s.course_id === c.id).map(({ id, kind, name, char_count, created_at }) => ({ id, kind, name, char_count, created_at })),
  };
}
const findCourse = (id) => store.courses.find((c) => c.id === id);

function snapshot(course, note, userId) {
  store.versions.push({ id: uid(), course_id: course.id, version: course.version, change_note: note, snapshot: JSON.parse(JSON.stringify(courseView(course, { withAnswers: true }))), created_by: userId, created_at: nowIso() });
}

function createCourse(tree, { userId, generatedByAi = false, sourceIds = [] }) {
  const data = normalizeTree(tree, (id) => !!areaById(id));
  const ts = nowIso();
  const course = { id: uid(), area_ids: data.area_ids, title: data.title, description: data.description, category: data.category, cover_emoji: data.cover_emoji, status: 'draft', version: 1, generated_by_ai: generatedByAi ? 1 : 0, created_by: userId, created_at: ts, updated_at: ts, lessons: [] };
  writeLessons(course, data.lessons);
  store.courses.push(course);
  for (const s of store.sources) if (sourceIds.includes(s.id)) s.course_id = course.id;
  snapshot(course, generatedByAi ? 'Versión inicial generada con IA' : 'Versión inicial', userId);
  return courseView(course, { withAnswers: true });
}

function updateCourse(id, tree, { userId, changeNote = 'Edición manual', sourceIds = [] }) {
  const course = findCourse(id);
  if (!course) throw httpError(404, 'Curso no encontrado.');
  const data = normalizeTree(tree, (id) => !!areaById(id));
  Object.assign(course, { title: data.title, description: data.description, category: data.category, cover_emoji: data.cover_emoji, area_ids: data.area_ids, version: course.version + 1, updated_at: nowIso() });
  writeLessons(course, data.lessons);
  for (const s of store.sources) if (sourceIds.includes(s.id)) s.course_id = course.id;
  snapshot(course, changeNote, userId);
  return courseView(course, { withAnswers: true });
}

// ---------- Aprendizaje y gamificación ----------
const award = (userId, reason, points) => store.xp.push({ id: uid(), user_id: userId, reason, points, created_at: nowIso() });
const xpOf = (userId) => store.xp.filter((x) => x.user_id === userId).reduce((a, x) => a + x.points, 0);
const lessonOwner = (lessonId) => store.courses.find((c) => c.lessons.some((l) => l.id === lessonId));
const isDone = (userId, lessonId) => store.progress.some((p) => p.user_id === userId && p.lesson_id === lessonId);

function progressFor(userId, course) {
  const done = course.lessons.filter((l) => isDone(userId, l.id)).map((l) => l.id);
  const total = course.lessons.length;
  return { done_lesson_ids: done, done: done.length, total, percent: total ? Math.round((done.length / total) * 100) : 0 };
}

function completeLesson(userId, lessonId) {
  const course = lessonOwner(lessonId);
  if (!course) throw httpError(404, 'Lección no encontrada.');
  let gained = 0;
  let finished = false;
  if (!isDone(userId, lessonId)) {
    store.progress.push({ user_id: userId, lesson_id: lessonId, completed_at: nowIso() });
    award(userId, 'Lección completada', XP.lesson); gained += XP.lesson;
    if (course.lessons.every((l) => isDone(userId, l.id))) {
      award(userId, `Curso completado: ${course.title}`, XP.courseCompleted); gained += XP.courseCompleted; finished = true;
    }
  }
  return { gained, finished_course: finished, progress: progressFor(userId, course) };
}

function submitQuiz(userId, lessonId, answers) {
  const course = lessonOwner(lessonId);
  const lesson = course?.lessons.find((l) => l.id === lessonId);
  if (!lesson?.questions.length) throw httpError(400, 'Este quiz no tiene preguntas.');
  const results = lesson.questions.map((q, i) => ({ question_id: q.id, chosen: answers[i] ?? null, correct_index: q.correct_index, is_correct: answers[i] === q.correct_index, explanation: q.explanation }));
  const score = results.filter((r) => r.is_correct).length;
  const prev = store.attempts.filter((a) => a.user_id === userId && a.lesson_id === lessonId);
  const prevBest = prev.reduce((m, a) => Math.max(m, a.score), 0);
  store.attempts.push({ id: uid(), user_id: userId, lesson_id: lessonId, score, total: lesson.questions.length, created_at: nowIso() });
  let gained = 0;
  const improvement = Math.max(0, score - prevBest);
  if (improvement) { award(userId, 'Respuestas correctas en quiz', improvement * XP.quizCorrect); gained += improvement * XP.quizCorrect; }
  if (score === lesson.questions.length && prevBest < score) { award(userId, 'Quiz perfecto', XP.quizPerfect); gained += XP.quizPerfect; }
  const passed = score / lesson.questions.length >= 0.7;
  const completion = passed ? completeLesson(userId, lessonId) : null;
  return { score, total: lesson.questions.length, passed, results, gained: gained + (completion?.gained ?? 0), finished_course: completion?.finished_course ?? false };
}

function myStats(userId) {
  return statsFrom({
    xp: xpOf(userId),
    lessons: store.progress.filter((p) => p.user_id === userId).length,
    perfect: store.attempts.filter((a) => a.user_id === userId && a.score === a.total).length,
    courses: store.xp.filter((x) => x.user_id === userId && x.reason.startsWith('Curso completado')).length,
    games: store.xp.filter((x) => x.user_id === userId && x.reason.startsWith('Juego en vivo')).length,
    recent: store.xp.filter((x) => x.user_id === userId).slice(-8).reverse(),
  });
}

function leaderboard(limit, areaId = null) {
  return store.users.filter((u) => u.active && (!areaId || u.area_id === areaId)).map((u) => ({ id: u.id, name: u.name, xp: xpOf(u.id) }))
    .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name)).slice(0, limit).map((r) => ({ ...r, level: levelFor(r.xp).name }));
}

function adminMetrics() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const courses = store.courses.filter((c) => c.status !== 'archived').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((c) => {
    const ids = new Set(c.lessons.map((l) => l.id));
    const byUser = new Map();
    for (const p of store.progress) if (ids.has(p.lesson_id)) byUser.set(p.user_id, (byUser.get(p.user_id) ?? 0) + 1);
    const attempts = store.attempts.filter((a) => ids.has(a.lesson_id));
    const started = byUser.size;
    const completed = c.lessons.length ? [...byUser.values()].filter((n) => n === c.lessons.length).length : 0;
    return {
      id: c.id, title: c.title, cover_emoji: c.cover_emoji, status: c.status, version: c.version, lessons: c.lessons.length, started, completed,
      avg_quiz: attempts.length ? Math.round(attempts.reduce((s, a) => s + (100 * a.score) / a.total, 0) / attempts.length) : null,
      completion_rate: started ? Math.round((100 * completed) / started) : 0,
    };
  });
  return {
    learners: store.users.filter((u) => u.active && u.role === 'learner').length,
    active_week: new Set(store.xp.filter((x) => x.created_at > weekAgo).map((x) => x.user_id)).size,
    courses, areas: areaMetrics(), people_without_area: store.users.filter((u) => u.active && !u.area_id).length,
  };
}

function saveSource({ kind, name, text, userId }) {
  const s = { id: uid(), course_id: null, kind, name, extracted_text: text, char_count: text.length, created_by: userId, created_at: nowIso() };
  store.sources.push(s);
  return { id: s.id, kind, name, char_count: s.char_count };
}

// ---------- IA ----------
const AI_SCHEMA_HINT = `Responde SOLO con un objeto JSON con esta forma exacta:
{"title": string, "description": string, "category": string, "cover_emoji": string (un emoji), "change_summary": string,
 "lessons": [{"existing_id": string|null, "type": "reading"|"quiz"|"video", "title": string, "content": string (Markdown), "duration_min": number,
   "questions": [{"prompt": string, "options": [string, string, string, string], "correct_index": number (0-3), "explanation": string}]}]}`;
const AI_RULES = `Eres diseñador instruccional senior. Conviertes material interno de una empresa en cursos de inducción claros, prácticos y amigables en español para personas nuevas.
- Usa SOLO la información del material. No inventes datos; si falta algo importante, menciónalo en "change_summary".
- Lecciones cortas (3–8 minutos), una idea central cada una, tono cercano y directo.
- "content" de las lecturas en Markdown simple: ## títulos, listas, **negritas**, y al final "## Para recordar" con 3 puntos.
- Después de cada 2–3 lecturas incluye una lección "quiz" con preguntas de 4 opciones, una correcta, distractores plausibles y explicación breve. Las lecciones que no son quiz llevan "questions": [].
- Las preguntas evalúan comprensión y aplicación en situaciones reales del trabajo, no memorización.`;
const AI_SOURCE_BUDGET = 120000;

function sourcesBlock(sources) {
  let budget = AI_SOURCE_BUDGET;
  let truncated = false;
  const text = sources.map((s) => {
    const t = s.extracted_text.slice(0, Math.max(0, budget));
    if (t.length < s.extracted_text.length) truncated = true;
    budget -= t.length;
    return `<documento nombre="${s.name.replace(/"/g, "'")}">\n${t}\n</documento>`;
  }).join('\n\n');
  return { text, truncated };
}

function toCourseTree(draft, existingLessons = []) {
  if (!draft || !Array.isArray(draft.lessons)) throw httpError(502, 'La IA devolvió un formato inesperado. Intenta de nuevo.');
  const byId = new Map(existingLessons.map((l) => [l.id, l]));
  const lessons = draft.lessons.map((l) => {
    const type = ['reading', 'quiz', 'video'].includes(l?.type) ? l.type : 'reading';
    const existing = l.existing_id ? byId.get(l.existing_id) : null;
    if (type === 'video' && !existing?.video_url) return null;
    const questions = type === 'quiz' ? (Array.isArray(l.questions) ? l.questions : [])
      .map((q) => ({ prompt: String(q?.prompt ?? ''), options: (Array.isArray(q?.options) ? q.options : []).map(String).filter((o) => o.trim()).slice(0, 4), correct_index: Number(q?.correct_index), explanation: String(q?.explanation ?? ''), time_limit_sec: 20 }))
      .filter((q) => q.prompt.trim() && q.options.length >= 2 && Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length) : [];
    if (type === 'quiz' && !questions.length) return null;
    return { id: existing ? existing.id : null, type, title: String(l.title || 'Lección'), content: String(l.content ?? ''), video_url: type === 'video' ? existing.video_url : null, duration_min: Number(l.duration_min) || 5, questions };
  }).filter(Boolean);
  return { title: String(draft.title || 'Nuevo curso'), description: String(draft.description ?? ''), category: String(draft.category || 'Inducción'), cover_emoji: String(draft.cover_emoji || '📘'), lessons, change_summary: String(draft.change_summary ?? '') };
}

const aiErrorCopy = {
  not_granted: 'No se dio permiso para usar Claude en esta demo. Se usará el modo básico.',
  sampling_disabled: 'Claude no está disponible para tu cuenta. Se usará el modo básico.',
  rate_limited: 'Claude está recibiendo demasiadas solicitudes. Intenta en un minuto.',
  prompt_too_large: 'El material es demasiado extenso. Usa menos archivos o más cortos.',
  invalid_json: 'La IA devolvió un formato inesperado. Intenta de nuevo.',
  refused: 'La IA no pudo procesar este material. Revisa el contenido.',
};

async function generateWithAi(sources, instructions, lessonCount) {
  const sample = await samplePromise;
  const { text, truncated } = sourcesBlock(sources);
  if (!sample) return { ...basicCourseFromSources(sources, lessonCount), mode: 'basic', truncated };
  const prompt = `${AI_RULES}\n\n${text}\n\nCrea un curso de inducción a partir de los documentos anteriores.\n- Lecciones de lectura aproximadas: ${lessonCount} (más quizzes intermedios y un quiz final de repaso de 5 preguntas).\n- "existing_id" siempre null.\n- "change_summary": 2–3 frases sobre qué cubre el curso y vacíos detectados.\n${instructions ? `- Indicaciones de quien crea el curso: ${instructions}\n` : ''}\n${AI_SCHEMA_HINT}`;
  try {
    const draft = await sample.json(prompt, { modelTier: 'default' });
    return { ...toCourseTree(draft), mode: 'ai', truncated };
  } catch (e) {
    if (e?.code === 'not_granted' || e?.code === 'sampling_disabled' || e?.code === 'capability_disabled') return { ...basicCourseFromSources(sources, lessonCount), mode: 'basic', truncated };
    throw httpError(e?.status ?? 503, aiErrorCopy[e?.code] ?? e?.message ?? 'No se pudo contactar a la IA. Intenta de nuevo.');
  }
}

async function updateWithAi(course, sources, instructions) {
  const sample = await samplePromise;
  if (!sample) throw httpError(503, 'Actualizar con IA necesita abrir esta demo dentro de Claude (claude.ai). Puedes editar el curso manualmente.');
  const { text } = sourcesBlock(sources);
  const current = {
    title: course.title, description: course.description, category: course.category, cover_emoji: course.cover_emoji,
    lessons: course.lessons.map((l) => ({ existing_id: l.id, type: l.type, title: l.title, content: l.content, duration_min: l.duration_min, questions: l.questions.map(({ prompt, options, correct_index, explanation }) => ({ prompt, options, correct_index, explanation })) })),
  };
  const prompt = `${AI_RULES}\n\n<curso_actual>\n${JSON.stringify(current)}\n</curso_actual>\n\n<material_nuevo>\n${text}\n</material_nuevo>\n\nActualiza el curso actual con el material nuevo (por ejemplo, una política o proceso que cambió).\n- Conserva las lecciones vigentes con su mismo "existing_id"; modifica las que cambian manteniendo su "existing_id"; usa null solo para lecciones nuevas.\n- Omite las lecciones que el material nuevo deja obsoletas. Conserva las lecciones "video" con su existing_id salvo que ya no apliquen.\n- Ajusta las preguntas a la información vigente.\n- "change_summary": lista breve y concreta de qué cambió y por qué (nota de versión visible para el equipo).\n${instructions ? `- Indicaciones adicionales: ${instructions}\n` : ''}\n${AI_SCHEMA_HINT}`;
  try {
    const draft = await sample.json(prompt, { modelTier: 'default', cache: false });
    return { ...toCourseTree(draft, course.lessons), mode: 'ai' };
  } catch (e) {
    throw httpError(503, aiErrorCopy[e?.code] ?? 'No se pudo contactar a la IA. Intenta de nuevo.');
  }
}

// ---------- Juego en vivo (mismo motor que server/services/live-game.js) ----------
function createLiveGames({ onFinished, onChange }) {
  const games = new Map();
  const randomPin = () => { let p; do { p = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while (games.has(p)); return p; };
  const get = (pin) => { const g = games.get(String(pin)); if (!g) throw httpError(404, 'No existe una partida con ese PIN.'); return g; };
  const assertHost = (g, key) => { if (key !== g.hostKey) throw httpError(403, 'Solo quien creó la partida puede controlarla.'); };

  function create({ title, questions, hostUserId = null, hostName = '', areaIds = [], simulatedHost = false }) {
    if (!questions?.length) throw httpError(400, 'Elige un curso con al menos un quiz.');
    const pin = randomPin();
    games.set(pin, { pin, title, hostUserId, hostName, areaIds, simulatedHost, hostLeftAt: Date.now(), createdAt: Date.now(), hostKey: hex(16), questions, phase: 'lobby', index: -1, startedAt: 0, timer: null, players: new Map(), answers: new Map(), subs: new Set() });
    return { pin, hostKey: games.get(pin).hostKey };
  }
  function join(pin, { nickname, userId = null, bot = false, remotePeer = null }) {
    const g = get(pin);
    if (g.phase === 'finished') throw httpError(409, 'Esta partida ya terminó.');
    const name = String(nickname ?? '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Escribe un apodo.');
    if ([...g.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) throw httpError(409, 'Ese apodo ya está en uso en esta partida.');
    const id = remotePeer ?? hex(8);
    const key = hex(16);
    g.players.set(id, { id, key, name, userId, bot, remote: !!remotePeer, score: 0, streak: 0, lastGain: 0, lastCorrect: null });
    broadcast(g);
    return { playerId: id, playerKey: key, title: g.title };
  }
  function start(pin, hostKey) {
    const g = get(pin); assertHost(g, hostKey);
    if (g.phase !== 'lobby') throw httpError(409, 'La partida ya empezó.');
    if (!g.players.size) throw httpError(409, 'Espera a que se una al menos una persona.');
    openQuestion(g, 0);
  }
  function openQuestion(g, index) {
    g.index = index; g.phase = 'question'; g.startedAt = Date.now(); g.answers = new Map();
    clearTimeout(g.timer);
    g.timer = setTimeout(() => reveal(g), g.questions[index].time_limit_sec * 1000 + 300);
    broadcast(g);
  }
  function answer(pin, { playerId, playerKey, choice, trusted = false }) {
    const g = get(pin);
    const p = g.players.get(playerId);
    if (!p || (!trusted && p.key !== playerKey)) throw httpError(403, 'Jugador no válido.');
    if (g.phase !== 'question') throw httpError(409, 'El tiempo para responder terminó.');
    if (g.answers.has(playerId)) throw httpError(409, 'Ya respondiste esta pregunta.');
    const q = g.questions[g.index];
    const c = Number(choice);
    if (!Number.isInteger(c) || c < 0 || c >= q.options.length) throw httpError(400, 'Opción inválida.');
    g.answers.set(playerId, { choice: c, elapsed: Date.now() - g.startedAt });
    if (g.answers.size === g.players.size) reveal(g); else broadcast(g);
    return { received: true };
  }
  const scoreFor = (ms, limit, streak) => Math.round(1000 * (1 - Math.min(1, ms / (limit * 1000)) / 2)) + Math.min(500, 100 * streak);
  function reveal(g) {
    if (g.phase !== 'question') return;
    clearTimeout(g.timer);
    const q = g.questions[g.index];
    for (const p of g.players.values()) {
      const a = g.answers.get(p.id);
      const ok = a?.choice === q.correct_index;
      p.lastCorrect = a ? ok : null;
      if (ok) { p.lastGain = scoreFor(a.elapsed, q.time_limit_sec, p.streak); p.score += p.lastGain; p.streak += 1; } else { p.lastGain = 0; p.streak = 0; }
    }
    g.phase = 'reveal';
    broadcast(g);
  }
  function next(pin, hostKey) {
    const g = get(pin); assertHost(g, hostKey);
    if (g.phase === 'question') return reveal(g);
    if (g.phase === 'reveal') { g.phase = 'leaderboard'; return broadcast(g); }
    if (g.phase === 'leaderboard') return g.index + 1 < g.questions.length ? openQuestion(g, g.index + 1) : finish(g);
    throw httpError(409, 'No hay un siguiente paso en este momento.');
  }
  function finish(g) { clearTimeout(g.timer); g.phase = 'finished'; broadcast(g); onFinished?.({ title: g.title, ranking: ranking(g) }); }
  function end(pin, hostKey) { const g = get(pin); assertHost(g, hostKey); if (g.phase !== 'finished') finish(g); }
  const ranking = (g) => [...g.players.values()].sort((a, b) => b.score - a.score).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, userId: p.userId, streak: p.streak }));

  function baseView(g) {
    const q = g.questions[g.index];
    const v = { pin: g.pin, title: g.title, phase: g.phase, index: g.index, total: g.questions.length, player_count: g.players.size, answered: g.answers.size, remaining_ms: g.phase === 'question' ? Math.max(0, q.time_limit_sec * 1000 - (Date.now() - g.startedAt)) : 0 };
    if (q && g.phase !== 'lobby') {
      v.question = { prompt: q.prompt, options: q.options, time_limit_sec: q.time_limit_sec };
      if (g.phase !== 'question') { v.question.correct_index = q.correct_index; v.question.explanation = q.explanation; v.distribution = q.options.map((_, i) => [...g.answers.values()].filter((a) => a.choice === i).length); }
    }
    return v;
  }
  function meFor(g, p, rank) {
    const mine = rank.find((r) => r.id === p.id);
    return { name: p.name, score: p.score, rank: mine?.rank, streak: p.streak, answered: g.answers.has(p.id), last_correct: g.phase === 'question' ? null : p.lastCorrect, last_gain: p.lastGain };
  }
  function viewFor(g, sub) {
    const v = baseView(g);
    const rank = ranking(g);
    if (sub.role === 'host') {
      v.players = [...g.players.values()].map((p) => p.name);
      if (['leaderboard', 'finished', 'reveal'].includes(g.phase)) v.ranking = rank.slice(0, g.phase === 'finished' ? 10 : 5).map(({ rank: r, name, score }) => ({ rank: r, name, score }));
    } else {
      const p = g.players.get(sub.playerId);
      if (p) { v.me = meFor(g, p, rank); if (g.phase === 'finished') v.ranking = rank.slice(0, 3).map(({ rank: r, name, score }) => ({ rank: r, name, score })); }
    }
    return v;
  }
  // Estado compacto para celulares remotos: base + puntaje de cada jugador remoto.
  function remoteState(g) {
    const rank = ranking(g);
    const me = {};
    for (const p of g.players.values()) if (p.remote) me[p.id] = meFor(g, p, rank);
    const v = baseView(g);
    if (g.phase === 'finished') v.ranking = rank.slice(0, 3).map(({ rank: r, name, score }) => ({ rank: r, name, score }));
    return { ...v, me };
  }
  function broadcast(g) { for (const s of g.subs) s.send(viewFor(g, s)); onChange?.(g); }
  function subscribe(pin, { role, hostKey, playerId, playerKey }, send) {
    const g = get(pin);
    if (role === 'host') assertHost(g, hostKey);
    else { const p = g.players.get(playerId); if (!p || p.key !== playerKey) throw httpError(403, 'Jugador no válido.'); }
    const sub = { role, playerId, send };
    g.subs.add(sub);
    send(viewFor(g, sub));
    return () => { g.subs.delete(sub); if (role === 'host' && !hostConnected(g)) g.hostLeftAt = Date.now(); };
  }
  const hostConnected = (g) => g.simulatedHost || [...g.subs].some((s) => s.role === 'host');
  function listOpen({ areaId = null, seeAll = false, userId = null }) {
    return [...games.values()]
      .filter((g) => g.phase !== 'finished' && (hostConnected(g) || Date.now() - g.hostLeftAt < 60000))
      .filter((g) => seeAll || !g.areaIds.length || g.areaIds.includes(areaId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => ({ pin: g.pin, title: g.title, host_name: g.hostName, phase: g.phase, index: g.index, total: g.questions.length, player_count: g.players.size, created_at: new Date(g.createdAt).toISOString(), mine: !!userId && g.hostUserId === userId }));
  }
  function resume(pin, { userId, isAdmin }) {
    const g = get(pin);
    if (g.simulatedHost || (g.hostUserId !== userId && !isAdmin)) throw httpError(403, 'Solo quien creó la partida puede abrir su pantalla.');
    if (g.phase === 'finished') throw httpError(409, 'Esta partida ya terminó.');
    return { pin: g.pin, hostKey: g.hostKey };
  }
  return { create, join, start, answer, next, end, subscribe, listOpen, resume, remoteState, has: (pin) => games.has(String(pin)), raw: (pin) => games.get(String(pin)) };
}

const games = createLiveGames({
  onFinished: ({ title, ranking }) => {
    for (const p of ranking) {
      if (!p.userId) continue;
      award(p.userId, `Juego en vivo: ${title}`, XP.gamePlayed);
      if (p.rank <= 3) award(p.userId, `Juego en vivo: podio #${p.rank}`, XP.gamePodium);
    }
    persist();
  },
  onChange: (g) => { botsReact(g); remoteHost.publish(g); autoHost(g); },
});

// Partidas abiertas simuladas: "facilitadas" por compañeros de ejemplo, avanzan solas
// y empiezan cuando una persona real se une. Así la lista de partidas nunca está vacía en la demo.
const simulated = { timers: new Set() };
function autoHost(g) {
  if (!g.simulatedHost) return;
  const key = `${g.pin}:${g.phase}:${g.index}`;
  if (simulated.timers.has(key)) return;
  const later = (ms, action) => { simulated.timers.add(key); setTimeout(() => { try { action(); } catch { /* la partida cambió */ } }, ms); };
  const human = [...g.players.values()].some((p) => !p.bot);
  if (g.phase === 'lobby' && human) later(5000, () => games.start(g.pin, g.hostKey));
  else if (g.phase === 'reveal') later(4500, () => games.next(g.pin, g.hostKey));
  else if (g.phase === 'leaderboard') later(3000, () => games.next(g.pin, g.hostKey));
}
const SIMULATED_GAMES = [
  { course: 'Bienvenida a Plataform', host: 'Sofía Ríos' },
  { course: 'Técnicas de negociación', host: 'Mateo López' },
  { course: 'Seguridad de la información', host: 'Diego Mora' },
];
function ensureSimulatedGames() {
  for (const spec of SIMULATED_GAMES) {
    const open = [...gamesOpenPins()].some((pin) => games.raw(pin)?.simulatedFrom === spec.course);
    if (open) continue;
    const course = store.courses.find((c) => c.title === spec.course && c.status === 'published');
    const questions = course?.lessons.filter((l) => l.type === 'quiz').flatMap((l) => l.questions);
    if (!questions?.length) continue;
    const { pin } = games.create({ title: course.title, questions, hostName: spec.host, areaIds: course.area_ids ?? [], simulatedHost: true });
    games.raw(pin).simulatedFrom = spec.course;
    addBots(pin, 3);
  }
}
function* gamesOpenPins() { for (const g of games.listOpen({ seeAll: true })) yield g.pin; }

// Participantes simulados: se unen solos y responden con distinta rapidez y acierto.
const BOT_NAMES = ['Sofía', 'Mateo', 'Valentina', 'Joaquín', 'Camila'];
const BOT_SKILL = [0.85, 0.7, 0.6, 0.75, 0.5];
const botTimers = new Map();
function addBots(pin, count = BOT_NAMES.length) {
  BOT_NAMES.slice(0, count).forEach((name, i) => setTimeout(() => {
    const g = games.raw(pin);
    if (!g || g.phase !== 'lobby') return;
    try { games.join(pin, { nickname: name, bot: true }); } catch { /* apodo tomado */ }
  }, 900 + i * 900));
}
function botsReact(g) {
  if (g.phase !== 'question') return;
  const key = `${g.pin}:${g.index}`;
  if (botTimers.has(key)) return;
  botTimers.set(key, true);
  const q = g.questions[g.index];
  [...g.players.values()].filter((p) => p.bot).forEach((p) => {
    const skill = BOT_SKILL[BOT_NAMES.indexOf(p.name)] ?? 0.6;
    const delay = 1500 + Math.random() * Math.min(q.time_limit_sec * 1000 * 0.7, 12000);
    setTimeout(() => {
      const cur = games.raw(g.pin);
      if (!cur || cur.phase !== 'question' || cur.index !== g.index) return;
      const choice = Math.random() < skill ? q.correct_index : (q.correct_index + 1 + Math.floor(Math.random() * (q.options.length - 1))) % q.options.length;
      try { games.answer(g.pin, { playerId: p.id, choice, trusted: true }); } catch { /* ya respondió */ }
    }, delay);
  });
}

// ---------- Juego multi-dispositivo con la sala del visor ----------
// Quien proyecta es la autoridad: recibe a los celulares por su "presence"
// y les envía el estado del juego por el tema "gstate".
const remoteHost = {
  rooms: new Map(),
  async attach(pin) {
    const room = await roomPromise;
    if (!room) return false;
    let gameRoom;
    try { gameRoom = await room.join(`juego-${pin}`); } catch { return false; }
    const entry = { room: gameRoom, last: 0, timer: null };
    this.rooms.set(pin, entry);
    gameRoom.onPeers((change) => {
      for (const peer of change.peers) {
        if (peer.sameTab || peer.kind !== 'viewer') continue;
        const pres = peer.presence ?? {};
        const g = games.raw(pin);
        if (!g || pres.pin !== pin || typeof pres.nick !== 'string') continue;
        if (!g.players.has(peer.peer)) {
          let nick = pres.nick.slice(0, 20);
          for (let n = 2; [...g.players.values()].some((p) => p.name.toLowerCase() === nick.toLowerCase()); n++) nick = `${pres.nick.slice(0, 17)} ${n}`;
          try { games.join(pin, { nickname: nick, remotePeer: peer.peer }); } catch { continue; }
        }
        const ans = pres.ans;
        if (ans && ans.i === g.index && g.phase === 'question' && !g.answers.has(peer.peer)) {
          try { games.answer(pin, { playerId: peer.peer, choice: ans.c, trusted: true }); } catch { /* fuera de tiempo */ }
        }
      }
      this.publish(games.raw(pin));
    });
    entry.timer = setInterval(() => this.publish(games.raw(pin), true), 2000);
    return true;
  },
  publish(g, force = false) {
    const entry = g && this.rooms.get(g.pin);
    if (!entry) return;
    if (!force && Date.now() - entry.last < 150) { clearTimeout(entry.pending); entry.pending = setTimeout(() => this.publish(g, true), 160); return; }
    entry.last = Date.now();
    entry.room.emit('gstate', games.remoteState(g)).catch(() => {});
    if (g.phase === 'finished') { clearInterval(entry.timer); setTimeout(() => this.publish(g, true), 1500); }
  },
};

// Lado del celular: se une por presence y escucha el estado del anfitrión.
const remotePlayer = {
  active: null,
  async join(pin, nickname) {
    const room = await roomPromise;
    if (!room) throw httpError(404, 'No existe una partida con ese PIN en este dispositivo. Para jugar desde otro celular, abre el link compartido de la demostración dentro de Claude.');
    const gameRoom = await room.join(`juego-${pin}`);
    const nick = String(nickname ?? '').trim().slice(0, 20);
    if (!nick) throw httpError(400, 'Escribe un apodo.');
    const state = { pin, room: gameRoom, peer: null, last: null, listeners: new Set() };
    gameRoom.onPeers((c) => { const me = c.peers.find((p) => p.sameTab); if (me) state.peer = me.peer; });
    gameRoom.on('gstate', (msg) => {
      if (msg.data?.pin !== pin) return;
      state.last = msg.data;
      for (const fn of state.listeners) fn(msg.data);
    });
    await gameRoom.presence({ pin, nick, ans: null });
    // Espera a que quien proyecta confirme la entrada (aparece en su estado).
    const ok = await new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (state.peer && state.last?.me?.[state.peer]) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > 8000) { clearInterval(iv); resolve(false); }
      }, 200);
    });
    if (!ok) { gameRoom.leave?.(); throw httpError(404, 'No encontramos una partida activa con ese PIN. Verifica el número en la pantalla proyectada.'); }
    this.active = state;
    return { playerId: state.peer, playerKey: 'remoto', title: state.last.title };
  },
  subscribe(send) {
    const s = this.active;
    const fn = (data) => { const { me, ...base } = data; send({ ...base, me: me?.[s.peer] }); };
    s.listeners.add(fn);
    if (s.last) fn(s.last);
    return () => s.listeners.delete(fn);
  },
  answer(choice) {
    const s = this.active;
    s.room.presence({ ans: { i: s.last?.index, c: Number(choice) } }).catch(() => {});
    return { received: true };
  },
};

// ---------- Datos de ejemplo ----------
function seed() {
  store = emptyStore();
  for (const [name, icon] of [['Comercial', '💼'], ['Operaciones', '⚙️'], ['Atención al cliente', '🎧'], ['Tecnología', '💻'], ['Finanzas', '📊'], ['Recursos Humanos', '🤝']]) {
    store.areas.push({ id: uid(), name, icon, active: 1, created_at: nowIso() });
  }
  const areaId = (name) => store.areas.find((a) => a.name === name).id;
  const admin = users.login({ email: 'ana.gomez@plataform.com', name: 'Ana Gómez' }).user;
  const q = (prompt, options, c, explanation) => ({ prompt, options, correct_index: c, explanation, time_limit_sec: 20 });
  const demoVideo = 'demo:bienvenida';
  const courses = [
    { title: 'Bienvenida a Plataform', cover_emoji: '👋', category: 'Inducción', description: 'Quiénes somos, cómo trabajamos y qué esperar de tu primera semana.', lessons: [
      { type: 'video', title: 'Mensaje de bienvenida del gerente general', video_url: demoVideo, duration_min: 4, content: 'Escucha a nuestro gerente general contarte la historia de Plataform y lo que esperamos construir juntos.' },
      { type: 'reading', title: 'Nuestra historia y propósito', duration_min: 5, content: '## Nuestro propósito\nAyudamos a las empresas a **operar mejor** con procesos simples y tecnología útil.\n\n## Cómo trabajamos\n- **Cliente primero:** cada decisión empieza por el impacto en el cliente.\n- **Simple antes que complejo:** si se puede eliminar un paso, se elimina.\n- **Datos sobre opiniones:** medimos antes de cambiar.\n\n> Lo que no se mide no se puede mejorar.\n\n## Para recordar\n- El cliente está en el centro.\n- Simplificamos antes de automatizar.\n- Medimos todo lo importante.' },
      { type: 'reading', title: 'Tu primera semana', duration_min: 4, content: '## Día 1\n- Recibe tu equipo y credenciales con Tecnología.\n- Reunión de bienvenida con tu líder.\n\n## Días 2 a 5\n- Completa los cursos de inducción en la Academia.\n- Acompaña a un compañero en su trabajo diario.\n\n## Para recordar\n- Tu líder es tu primer punto de contacto.\n- Los cursos de inducción se completan en la primera semana.' },
      { type: 'quiz', title: 'Repaso: cultura Plataform', duration_min: 3, questions: [
        q('Un cliente pide un cambio urgente que agrega un paso al proceso. ¿Qué principio aplicas primero?', ['Revisar si el paso se puede simplificar o eliminar', 'Aceptarlo sin preguntar', 'Escalarlo a gerencia', 'Rechazarlo'], 0, 'Simple antes que complejo: primero buscamos eliminar o simplificar.'),
        q('¿Quién es tu primer punto de contacto durante la inducción?', ['Recursos Humanos', 'Tu líder directo', 'El gerente general', 'Tecnología'], 1, 'Tu líder te acompaña desde el día 1.'),
        q('¿Qué hacemos antes de cambiar un proceso?', ['Pedir opinión al equipo', 'Medir la situación actual', 'Comprar un software', 'Esperar a fin de año'], 1, 'Datos sobre opiniones: medimos antes de cambiar.'),
      ] },
    ] },
    { title: 'Seguridad de la información', cover_emoji: '🔐', category: 'Seguridad', description: 'Contraseñas, correos sospechosos y cómo reportar un incidente.', lessons: [
      { type: 'video', title: 'Cómo reconocer un correo de phishing', video_url: 'demo:phishing', duration_min: 6, content: 'Tres señales de alerta: remitente extraño, urgencia artificial y enlaces que no coinciden con el sitio oficial.' },
      { type: 'reading', title: 'Contraseñas y accesos', duration_min: 4, content: '## Reglas básicas\n- Las contraseñas son **personales e intransferibles**.\n- Usa el gestor de contraseñas corporativo.\n- Activa la verificación en dos pasos.\n\n## Si algo sale mal\nReporta cualquier incidente **de inmediato** al canal de soporte de Tecnología.\n\n## Para recordar\n- Nunca compartas tu contraseña.\n- Usa el gestor corporativo.\n- Reporta rápido: minutos importan.' },
      { type: 'quiz', title: 'Quiz de seguridad', duration_min: 3, questions: [
        q('Recibes un correo del “banco” pidiendo tu clave. ¿Qué haces?', ['Respondo con la clave', 'Lo reporto a Tecnología y no hago clic', 'Lo reenvío a mi equipo', 'Lo ignoro'], 1, 'Reportarlo ayuda a proteger a todos.'),
        q('¿Dónde guardas tus contraseñas?', ['En una nota del celular', 'En el gestor corporativo', 'En un Excel', 'En un post-it'], 1, 'El gestor corporativo está cifrado y respaldado.'),
        q('Perdiste tu laptop en un taxi. ¿Cuándo lo reportas?', ['Mañana', 'De inmediato', 'Si no aparece en una semana', 'No hace falta'], 1, 'Reportar de inmediato permite bloquear accesos a tiempo.'),
      ] },
    ] },
    { title: 'Proceso comercial de punta a punta', areas: ['Comercial'], cover_emoji: '💼', category: 'Ventas', description: 'Desde el primer contacto hasta la factura: etapas, responsables y plazos.', lessons: [
      { type: 'reading', title: 'Etapas del embudo', duration_min: 6, content: '## Etapas\n1. Prospecto\n2. Reunión de diagnóstico\n3. Propuesta\n4. Cierre\n5. Traspaso a Operaciones\n\n## Para recordar\n- Cada etapa tiene un responsable.\n- El traspaso a Operaciones se hace con acta.' },
      { type: 'reading', title: 'Cómo registrar una oportunidad', duration_min: 5, content: '## En el CRM\n- Toda oportunidad se registra el **mismo día** del primer contacto.\n- Adjunta la propuesta enviada.\n\n## Para recordar\n- Lo que no está en el CRM no existe.' },
      { type: 'quiz', title: 'Repaso comercial', duration_min: 3, questions: [q('¿Cuándo se registra una oportunidad?', ['Al cerrar', 'El mismo día del primer contacto', 'A fin de mes', 'Cuando lo pida el jefe'], 1, 'Registrar a tiempo mantiene la trazabilidad.'), q('¿Qué etapa sigue a la propuesta?', ['Prospecto', 'Cierre', 'Diagnóstico', 'Facturación'], 1, 'Propuesta → Cierre → Traspaso.')] },
    ] },
    { title: 'Atención al cliente', areas: ['Atención al cliente', 'Operaciones'], cover_emoji: '🎧', category: 'Operaciones', description: 'Protocolo de atención, tiempos de respuesta y manejo de reclamos.', lessons: [
      { type: 'reading', title: 'Protocolo de atención', duration_min: 5, content: '## Pasos\n1. Saluda con tu nombre.\n2. Identifica al cliente.\n3. Registra el caso.\n4. Confirma el número de ticket.\n\n## Para recordar\n- Respondemos en máximo 24 horas hábiles.' },
      { type: 'quiz', title: 'Quiz de atención', duration_min: 2, questions: [q('¿Plazo máximo de respuesta?', ['24 horas hábiles', '1 semana', '1 hora', 'Sin plazo'], 0, 'Es nuestro compromiso de servicio.')] },
    ] },
    { title: 'Técnicas de negociación', areas: ['Comercial'], cover_emoji: '🤝', category: 'Ventas', description: 'Cómo preparar una negociación, manejar objeciones y cerrar acuerdos que convienen a ambas partes.', lessons: [
      { type: 'video', title: 'Negociar no es ganar: es acordar', video_url: 'demo:negociacion', duration_min: 5, content: 'Una buena negociación deja a ambas partes con ganas de volver a trabajar juntas.' },
      { type: 'reading', title: 'Manejo de objeciones', duration_min: 6, content: '## Las 3 objeciones más comunes\n- **"Está caro":** muestra el costo de no resolver el problema.\n- **"Lo tengo que pensar":** pregunta qué información le falta para decidir.\n- **"Ya trabajo con otro proveedor":** pregunta qué mejoraría de su situación actual.\n\n## Para recordar\n- Escucha antes de responder.\n- Una objeción es una pregunta disfrazada.\n- Nunca bajes el precio sin cambiar el alcance.' },
      { type: 'quiz', title: 'Quiz de negociación', duration_min: 3, questions: [
        q('El cliente dice "está caro". ¿Qué haces primero?', ['Bajo el precio de inmediato', 'Muestro el costo de no resolver su problema', 'Cambio de tema', 'Le digo que es el precio de mercado'], 1, 'Conectar el precio con el valor evita descuentos innecesarios.'),
        q('¿Cuándo es aceptable bajar el precio?', ['Siempre que lo pida', 'Nunca', 'Cuando también se ajusta el alcance', 'Si es fin de mes'], 2, 'Precio y alcance se mueven juntos.'),
      ] },
    ] },
    { title: 'Mesa de ayuda y tickets', areas: ['Tecnología'], cover_emoji: '🛠️', category: 'Tecnología', description: 'Cómo clasificar, priorizar y cerrar tickets de soporte dentro de los tiempos acordados.', lessons: [
      { type: 'reading', title: 'Prioridades de un ticket', duration_min: 5, content: '## Prioridades\n- **P1 Crítico:** la operación está detenida. Respuesta en 30 minutos.\n- **P2 Alto:** un equipo no puede trabajar. Respuesta en 4 horas.\n- **P3 Normal:** consulta o mejora. Respuesta en 2 días hábiles.\n\n## Para recordar\n- La prioridad la define el impacto, no quién lo pide.' },
      { type: 'quiz', title: 'Quiz de soporte', duration_min: 2, questions: [q('Se cayó el sistema de facturación para toda la empresa. ¿Prioridad?', ['P1 Crítico', 'P2 Alto', 'P3 Normal', 'Depende de quién llame'], 0, 'La operación está detenida: P1.'), q('¿Qué define la prioridad?', ['El cargo de quien pide', 'El impacto en la operación', 'El orden de llegada', 'El área'], 1, 'El impacto, no la jerarquía.')] },
    ] },
    { title: 'Cierre contable mensual', areas: ['Finanzas'], cover_emoji: '📊', category: 'Finanzas', description: 'Calendario de cierre, conciliaciones y reportes que se entregan cada mes.', lessons: [
      { type: 'reading', title: 'Calendario de cierre', duration_min: 6, content: '## Días hábiles del cierre\n1. **Día 1–2:** registro de facturas y gastos pendientes.\n2. **Día 3:** conciliación bancaria.\n3. **Día 4:** provisiones y ajustes.\n4. **Día 5:** estados financieros a gerencia.\n\n## Para recordar\n- El cierre termina el quinto día hábil.' },
      { type: 'quiz', title: 'Quiz de cierre', duration_min: 2, questions: [q('¿Qué día se entrega el reporte a gerencia?', ['Día 1', 'Día 3', 'Día 5', 'Fin de mes'], 2, 'Los estados financieros se entregan el quinto día hábil.')] },
    ] },
    { title: 'Gastos y reembolsos', cover_emoji: '🧾', category: 'Inducción', description: 'Cómo rendir gastos y cuándo se pagan los reembolsos.', lessons: [
      { type: 'reading', title: 'Rendición mensual', duration_min: 4, content: '## Plazo\nAntes del **quinto día hábil** de cada mes, con comprobantes escaneados.\n\n## Para recordar\n- Finanzas paga en la siguiente quincena.' },
      { type: 'quiz', title: 'Repaso', duration_min: 2, questions: [q('¿Hasta cuándo rindes tus gastos?', ['Quinto día hábil', 'Fin de mes', 'Cuando quieras', 'Cada trimestre'], 0, 'Así Finanzas paga en la siguiente quincena.')] },
    ] },
  ];
  const created = courses.map((c) => { const r = createCourse({ ...c, area_ids: (c.areas ?? []).map(areaId) }, { userId: admin.id }); findCourse(r.id).status = 'published'; return findCourse(r.id); });
  const welcome = created[0];
  const updated = courseView(welcome, { withAnswers: true });
  updated.lessons[2].content = updated.lessons[2].content.replace('## Para recordar', '## Cierre de la semana\n- Agenda una reunión de cierre con tu líder.\n\n## Para recordar');
  updateCourse(welcome.id, updated, { userId: admin.id, changeNote: 'Agregué la reunión de cierre de la primera semana.' });
  const people = [
    ['sofia.rios', 'Sofía Ríos', 9, 'Comercial'], ['mateo.lopez', 'Mateo López', 7, 'Comercial'], ['valentina.cruz', 'Valentina Cruz', 5, 'Tecnología'],
    ['joaquin.vera', 'Joaquín Vera', 3, 'Finanzas'], ['camila.soto', 'Camila Soto', 4, 'Atención al cliente'], ['diego.mora', 'Diego Mora', 6, 'Operaciones'],
    ['luis.perez', 'Luis Pérez', 1, 'Comercial'],
  ];
  for (const [u, name, n, area] of people) {
    const { user } = users.login({ email: `${u}@plataform.com`, name });
    store.users.find((x) => x.id === user.id).area_id = areaId(area);
    let done = 0;
    for (const c of created.filter((cc) => isForArea(cc, areaId(area)))) for (const l of c.lessons) {
      if (done >= n) break;
      if (l.type === 'quiz') submitQuiz(user.id, l.id, l.questions.map((qq, i) => (i === 0 && n === 3 ? (qq.correct_index + 1) % qq.options.length : qq.correct_index)));
      else completeLesson(user.id, l.id);
      done++;
    }
  }
  // Persona recién ingresada, sin área: muestra el primer paso del recorrido.
  users.login({ email: 'andrea.torres@plataform.com', name: 'Andrea Torres' });
  store.sessions = {};
  persist();
}
if (!store) seed();

// ---------- Rutas ----------
function route(method, path, body, token) {
  const user = users.byToken(token);
  const need = () => { if (!user) throw httpError(401, 'Tu sesión expiró. Vuelve a ingresar.'); return user; };
  const admin = () => { need(); if (user.role !== 'admin') throw httpError(403, 'Necesitas permisos de administrador.'); return user; };
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  const m = (re) => pathname.match(re);
  let r;

  if (method === 'POST' && pathname === '/api/auth/login') {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const name = String(body?.name ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Escribe un correo válido.');
    if (!users.byEmail(email) && !name) return { needs_name: true };
    return users.login({ email, name: name || undefined });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') { delete store.sessions[token]; return { ok: true }; }
  if (method === 'GET' && pathname === '/api/me') { need(); return { user: publicUser(user), stats: myStats(user.id) }; }
  if (method === 'POST' && pathname === '/api/me/area') {
    need();
    const a = selectableArea(String(body?.area_id ?? ''));
    user.area_id = a.id;
    return { ok: true, area: { id: a.id, name: a.name, icon: a.icon } };
  }
  if (method === 'GET' && pathname === '/api/areas') { need(); return listAreas(user.role === 'admin' && params.get('all') === '1'); }
  if (method === 'POST' && pathname === '/api/areas') {
    admin();
    const a = { id: uid(), name: cleanAreaName(body?.name), icon: String(body?.icon || '🏢').slice(0, 8), active: 1, created_at: nowIso() };
    store.areas.push(a);
    return a;
  }
  if (method === 'PUT' && (r = m(/^\/api\/areas\/([\w-]+)$/))) {
    admin();
    const a = areaById(r[1]);
    if (!a) throw httpError(404, 'Área no encontrada.');
    if (body?.name !== undefined) a.name = cleanAreaName(body.name, a.id);
    if (body?.icon !== undefined) a.icon = String(body.icon || '🏢').slice(0, 8);
    if (body?.active !== undefined) a.active = body.active ? 1 : 0;
    return a;
  }
  if (method === 'GET' && pathname === '/api/health') return { ok: true };

  if (method === 'GET' && pathname === '/api/courses') {
    need();
    const all = user.role === 'admin' && params.get('all') === '1';
    return store.courses.filter((c) => (all ? c.status !== 'archived' : c.status === 'published' && isForArea(c, user.area_id))).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((c) => ({
      ...c, lessons: undefined, areas: areaPublic(c), generated_by_ai: !!c.generated_by_ai, lesson_count: c.lessons.length,
      total_min: c.lessons.reduce((s, l) => s + l.duration_min, 0), done_count: c.lessons.filter((l) => isDone(user.id, l.id)).length,
    }));
  }
  if ((r = m(/^\/api\/courses\/([\w-]+)$/))) {
    const c = findCourse(r[1]);
    if (method === 'GET') {
      need();
      const isAdmin = user.role === 'admin';
      if (!c || (!isAdmin && (c.status !== 'published' || !isForArea(c, user.area_id)))) throw httpError(404, 'Curso no encontrado.');
      return { ...courseView(c, { withAnswers: isAdmin }), progress: progressFor(user.id, c) };
    }
    if (method === 'PUT') { admin(); return updateCourse(r[1], body, { userId: user.id, changeNote: String(body.change_note ?? '').trim() || 'Edición manual', sourceIds: body.source_ids ?? [] }); }
  }
  if (method === 'POST' && pathname === '/api/courses') { admin(); return createCourse(body, { userId: user.id, sourceIds: body.source_ids ?? [], generatedByAi: !!body.generated_by_ai }); }
  if (method === 'POST' && (r = m(/^\/api\/courses\/([\w-]+)\/status$/))) {
    admin();
    const c = findCourse(r[1]);
    if (!c) throw httpError(404, 'Curso no encontrado.');
    if (!['draft', 'published', 'archived'].includes(body?.status)) throw httpError(400, 'Estado inválido.');
    if (body.status === 'published' && !c.lessons.length) throw httpError(400, 'Agrega al menos una lección antes de publicar.');
    c.status = body.status; c.updated_at = nowIso();
    return { ok: true, status: c.status };
  }
  if (method === 'GET' && (r = m(/^\/api\/courses\/([\w-]+)\/versions$/))) {
    admin();
    return store.versions.filter((v) => v.course_id === r[1]).sort((a, b) => b.version - a.version)
      .map((v) => ({ id: v.id, version: v.version, change_note: v.change_note, created_at: v.created_at, author: store.users.find((u) => u.id === v.created_by)?.name }));
  }
  if (method === 'POST' && (r = m(/^\/api\/courses\/([\w-]+)\/versions\/([\w-]+)\/restore$/))) {
    admin();
    const v = store.versions.find((x) => x.id === r[2] && x.course_id === r[1]);
    if (!v) throw httpError(404, 'Versión no encontrada.');
    return updateCourse(r[1], v.snapshot, { userId: user.id, changeNote: `Restaurada la versión ${v.version}` });
  }
  if (method === 'POST' && (r = m(/^\/api\/lessons\/([\w-]+)\/complete$/))) { need(); return completeLesson(user.id, r[1]); }
  if (method === 'POST' && (r = m(/^\/api\/lessons\/([\w-]+)\/quiz$/))) {
    need();
    const answers = Array.isArray(body?.answers) ? body.answers.map((a) => (a === null ? null : Number(a))) : [];
    return submitQuiz(user.id, r[1], answers);
  }
  if (method === 'GET' && pathname === '/api/leaderboard') { need(); return leaderboard(20, params.get('scope') === 'area' ? user.area_id : null); }

  if (method === 'POST' && pathname === '/api/sources/url') { admin(); throw httpError(400, 'En la demostración el navegador no puede leer páginas web externas. En la versión instalada esta opción funciona; aquí puedes copiar el texto de la página y pegarlo abajo.'); }
  if (method === 'POST' && pathname === '/api/sources/text') {
    admin();
    const ex = finishExtraction('texto', String(body?.name ?? '') || 'Texto pegado', String(body?.text ?? ''));
    return { ...saveSource({ ...ex, userId: user.id }), truncated: ex.truncated, preview: ex.text.slice(0, 400) };
  }
  if (method === 'GET' && pathname === '/api/admin/metrics') { admin(); return adminMetrics(); }
  if (method === 'GET' && pathname === '/api/admin/users') {
    admin();
    return store.users.map((u) => ({ ...publicUser(u), active: u.active, created_at: u.created_at, xp: xpOf(u.id), lessons_done: store.progress.filter((p) => p.user_id === u.id).length }));
  }
  if (method === 'POST' && (r = m(/^\/api\/admin\/users\/([\w-]+)\/area$/))) {
    admin();
    const u = store.users.find((x) => x.id === r[1]);
    if (!u) throw httpError(404, 'Persona no encontrada.');
    u.area_id = body?.area_id ? selectableArea(String(body.area_id)).id : null;
    return { ok: true };
  }
  if (method === 'POST' && (r = m(/^\/api\/admin\/users\/([\w-]+)\/role$/))) {
    admin();
    if (!['admin', 'learner'].includes(body?.role)) throw httpError(400, 'Rol inválido.');
    if (r[1] === user.id && body.role !== 'admin') throw httpError(400, 'No puedes quitarte tu propio rol de administrador.');
    const u = store.users.find((x) => x.id === r[1]);
    if (u) u.role = body.role;
    return { ok: true };
  }

  if (method === 'POST' && pathname === '/api/games') {
    admin();
    const c = findCourse(String(body?.course_id ?? ''));
    if (!c) throw httpError(404, 'Curso no encontrado.');
    const questions = c.lessons.filter((l) => l.type === 'quiz').flatMap((l) => l.questions);
    const created = games.create({ title: c.title, questions, hostUserId: user.id, hostName: user.name, areaIds: c.area_ids ?? [] });
    addBots(created.pin);
    remoteHost.attach(created.pin);
    return { ...created, question_count: questions.length };
  }
  if (method === 'GET' && pathname === '/api/games') {
    need();
    ensureSimulatedGames();
    return games.listOpen({ areaId: user.area_id, seeAll: user.role === 'admin', userId: user.id });
  }
  if (method === 'POST' && (r = m(/^\/api\/games\/(\d{6})\/resume$/))) { need(); return games.resume(r[1], { userId: user.id, isAdmin: user.role === 'admin' }); }
  if ((r = m(/^\/api\/games\/(\d{6})\/(join|start|next|end|answer)$/)) && method === 'POST') {
    const [, pin, action] = r;
    if (action === 'join') {
      if (!games.has(pin)) return remotePlayer.join(pin, body?.nickname);
      return games.join(pin, { nickname: body?.nickname, userId: user?.id ?? null });
    }
    if (action === 'answer') {
      if (body?.playerKey === 'remoto' && remotePlayer.active?.pin === pin) return remotePlayer.answer(body.choice);
      return games.answer(pin, body ?? {});
    }
    games[action](pin, body?.hostKey);
    return { ok: true };
  }
  throw httpError(404, 'Ruta no encontrada en la demostración.');
}

// Rutas que necesitan trabajo asíncrono (archivos e IA).
async function routeAsync(method, path, body, token) {
  const user = users.byToken(token);
  const admin = () => { if (!user) throw httpError(401, 'Tu sesión expiró. Vuelve a ingresar.'); if (user.role !== 'admin') throw httpError(403, 'Necesitas permisos de administrador.'); };
  const pathname = path.split('?')[0];
  let r;
  if (method === 'GET' && pathname === '/api/ai/status') {
    return { available: !!(await samplePromise), hint: 'Se generará un borrador básico (secciones + preguntas de completar). Abre esta demostración dentro de Claude para que la IA redacte el curso con lecciones y preguntas de calidad.' };
  }
  if (method === 'POST' && pathname === '/api/sources/files') {
    admin();
    const files = body instanceof FormData ? body.getAll('files') : [];
    if (!files.length) throw httpError(400, 'Adjunta al menos un archivo.');
    const results = [];
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) { results.push({ name: f.name, error: 'El archivo supera 50 MB.' }); continue; }
      try {
        const ex = await extractFile(f);
        results.push({ ...saveSource({ ...ex, userId: user.id }), truncated: ex.truncated, preview: ex.text.slice(0, 400) });
      } catch (err) { results.push({ name: f.name, error: err.message || 'No se pudo leer el archivo.' }); }
    }
    return results;
  }
  if (method === 'POST' && pathname === '/api/ai/generate') {
    admin();
    const ids = body?.source_ids ?? [];
    const sources = store.sources.filter((s) => ids.includes(s.id));
    if (!sources.length) throw httpError(400, 'Agrega al menos una fuente.');
    const lessonCount = Math.min(15, Math.max(2, Number(body?.lesson_count) || 6));
    const draft = await generateWithAi(sources, String(body?.instructions ?? ''), lessonCount);
    const course = createCourse({ ...draft, area_ids: body?.area_ids ?? [] }, { userId: user.id, generatedByAi: draft.mode === 'ai', sourceIds: ids });
    return { course, mode: draft.mode, summary: draft.change_summary, truncated: draft.truncated };
  }
  if (method === 'POST' && (r = pathname.match(/^\/api\/courses\/([\w-]+)\/ai-update$/))) {
    admin();
    const c = findCourse(r[1]);
    if (!c) throw httpError(404, 'Curso no encontrado.');
    const sources = store.sources.filter((s) => (body?.source_ids ?? []).includes(s.id));
    if (!sources.length) throw httpError(400, 'Agrega el material actualizado.');
    return updateWithAi(courseView(c, { withAnswers: true }), sources, String(body?.instructions ?? ''));
  }
  return route(method, path, body, token);
}

// ---------- Reemplazo de fetch y EventSource ----------
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  const auth = init.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  let body = init.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = undefined; } }
  // Latencia mínima realista para que los estados de carga se vean.
  await new Promise((res) => setTimeout(res, 60));
  try {
    const data = await routeAsync(method, url, body, token);
    persist();
    return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    return new Response(JSON.stringify({ error: status === 500 ? 'Ocurrió un error inesperado en la demostración.' : err.message, ...(err.body ?? {}) }), { status, headers: { 'Content-Type': 'application/json' } });
  }
};

window.EventSource = class DemoEventSource {
  constructor(url) {
    this.onmessage = null; this.onerror = null; this.closed = false;
    const u = new URL(url, 'https://demo.local');
    const pin = u.pathname.match(/\/api\/games\/(\d{6})\/events/)?.[1];
    const send = (data) => { if (!this.closed) setTimeout(() => this.onmessage?.({ data: JSON.stringify(data) }), 0); };
    setTimeout(() => {
      try {
        if (u.searchParams.get('playerKey') === 'remoto' && remotePlayer.active?.pin === pin) this.unsub = remotePlayer.subscribe(send);
        else this.unsub = games.subscribe(pin, { role: u.searchParams.get('role'), hostKey: u.searchParams.get('hostKey'), playerId: u.searchParams.get('playerId'), playerKey: u.searchParams.get('playerKey') }, send);
      } catch { this.onerror?.(new Event('error')); }
    }, 0);
  }
  close() { this.closed = true; this.unsub?.(); }
};

const demo = {
  reset() { try { localStorage.removeItem(DEMO_KEY); } catch { /* ignorado */ } seed(); },
  loginAs(email, { resetArea = false } = {}) {
    if (resetArea) { const u = users.byEmail(email); if (u) u.area_id = null; persist(); }
    return users.login({ email });
  },
  roomAvailable: async () => !!(await roomPromise),
  aiAvailable: async () => !!(await samplePromise),
};
