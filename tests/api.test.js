import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sampleCourse, LONG_TEXT } from './helpers.js';

let srv; let admin; let learner;

before(async () => {
  srv = await startServer({ adminEmails: [] });
  admin = await srv.login('ana@empresa.com', 'Ana Admin');
  learner = await srv.login('luis@empresa.com', 'Luis Nuevo');
});
after(() => srv.stop());

test('el primer usuario es administrador y los siguientes aprendices', () => {
  assert.equal(admin.user.role, 'admin');
  assert.equal(learner.user.role, 'learner');
});

test('login de usuario nuevo sin nombre pide el nombre', async () => {
  const r = await srv.call('/api/auth/login', { method: 'POST', body: { email: 'nuevo@empresa.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.needs_name, true);
  assert.equal(r.data.token, undefined);
});

test('un aprendiz no puede crear cursos ni ver el panel', async () => {
  assert.equal((await srv.call('/api/courses', { token: learner.token, method: 'POST', body: sampleCourse() })).status, 403);
  assert.equal((await srv.call('/api/admin/metrics', { token: learner.token })).status, 403);
  assert.equal((await srv.call('/api/courses')).status, 401);
});

test('flujo completo: crear, publicar, aprender, quiz, XP y versiones', async () => {
  const created = await srv.call('/api/courses', { token: admin.token, method: 'POST', body: sampleCourse() });
  assert.equal(created.status, 201);
  const course = created.data;
  assert.equal(course.version, 1);
  assert.equal(course.lessons.length, 3);

  // Borrador invisible para aprendices
  assert.equal((await srv.call(`/api/courses/${course.id}`, { token: learner.token })).status, 404);
  assert.equal((await srv.call('/api/courses', { token: learner.token })).data.length, 0);

  assert.equal((await srv.call(`/api/courses/${course.id}/status`, { token: admin.token, method: 'POST', body: { status: 'published' } })).status, 200);
  const seen = await srv.call(`/api/courses/${course.id}`, { token: learner.token });
  assert.equal(seen.status, 200);
  const quiz = seen.data.lessons[2];
  assert.equal(quiz.questions[0].correct_index, undefined, 'las respuestas no viajan al aprendiz');

  // Completar dos veces no duplica XP
  const c1 = await srv.call(`/api/lessons/${seen.data.lessons[0].id}/complete`, { token: learner.token, method: 'POST' });
  const c1b = await srv.call(`/api/lessons/${seen.data.lessons[0].id}/complete`, { token: learner.token, method: 'POST' });
  assert.equal(c1.data.gained, 10);
  assert.equal(c1b.data.gained, 0);
  await srv.call(`/api/lessons/${seen.data.lessons[1].id}/complete`, { token: learner.token, method: 'POST' });

  // Quiz reprobado no completa la lección
  const fail = await srv.call(`/api/lessons/${quiz.id}/quiz`, { token: learner.token, method: 'POST', body: { answers: [1, 1] } });
  assert.equal(fail.data.passed, false);
  assert.equal(fail.data.score, 0);
  // Quiz perfecto completa la lección y el curso
  const ok = await srv.call(`/api/lessons/${quiz.id}/quiz`, { token: learner.token, method: 'POST', body: { answers: [0, 0] } });
  assert.equal(ok.data.passed, true);
  assert.equal(ok.data.finished_course, true);
  // 2 correctas*5 + perfecto 20 + lección 10 + curso 50
  assert.equal(ok.data.gained, 90);

  const me = await srv.call('/api/me', { token: learner.token });
  assert.equal(me.data.stats.xp, 110);
  assert.ok(me.data.stats.badges.find((b) => b.id === 'course').earned);

  // Editar conserva ids (y progreso) de lecciones existentes y crea versión
  const full = (await srv.call(`/api/courses/${course.id}`, { token: admin.token })).data;
  full.lessons[1].content += '\n- Nuevo valor';
  full.lessons.push({ type: 'reading', title: 'Lección nueva', content: 'Hola', duration_min: 2 });
  const upd = await srv.call(`/api/courses/${course.id}`, { token: admin.token, method: 'PUT', body: { ...full, change_note: 'Agregué valor' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.version, 2);
  assert.deepEqual(upd.data.lessons.slice(0, 3).map((l) => l.id), full.lessons.slice(0, 3).map((l) => l.id));
  const prog = (await srv.call(`/api/courses/${course.id}`, { token: learner.token })).data.progress;
  assert.equal(prog.done, 3);
  assert.equal(prog.total, 4);

  const versions = (await srv.call(`/api/courses/${course.id}/versions`, { token: admin.token })).data;
  assert.deepEqual(versions.map((v) => v.version), [2, 1]);
  assert.equal(versions[0].change_note, 'Agregué valor');

  const restored = await srv.call(`/api/courses/${course.id}/versions/${versions[1].id}/restore`, { token: admin.token, method: 'POST' });
  assert.equal(restored.data.version, 3);
  assert.equal(restored.data.lessons.length, 3);

  const metrics = (await srv.call('/api/admin/metrics', { token: admin.token })).data;
  const m = metrics.courses.find((c) => c.id === course.id);
  assert.equal(m.started, 1);
  assert.equal(m.completed, 1);
  assert.equal(m.completion_rate, 100);
});

test('validaciones del curso', async () => {
  const bad = sampleCourse();
  bad.lessons[2].questions[0].correct_index = 9;
  const r = await srv.call('/api/courses', { token: admin.token, method: 'POST', body: bad });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /respuesta correcta/);
  const empty = await srv.call('/api/courses', { token: admin.token, method: 'POST', body: { title: 'Vacío', lessons: [] } });
  const pub = await srv.call(`/api/courses/${empty.data.id}/status`, { token: admin.token, method: 'POST', body: { status: 'published' } });
  assert.equal(pub.status, 400);
});

test('generar curso sin API key usa el modo básico y crea quizzes', async () => {
  const src = await srv.call('/api/sources/text', { token: admin.token, method: 'POST', body: { name: 'Manual', text: LONG_TEXT } });
  assert.equal(src.status, 200);
  const r = await srv.call('/api/ai/generate', { token: admin.token, method: 'POST', body: { source_ids: [src.data.id], lesson_count: 3 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.mode, 'basic');
  assert.ok(r.data.course.lessons.some((l) => l.type === 'reading'));
  const quizzes = r.data.course.lessons.filter((l) => l.type === 'quiz');
  assert.ok(quizzes.length >= 1, 'al menos un quiz');
  for (const q of quizzes.flatMap((l) => l.questions)) assert.equal(q.options[q.correct_index].length > 0, true);
  assert.equal(r.data.course.sources.length, 1);
});

test('actualizar con IA sin API key responde 503 claro', async () => {
  const c = (await srv.call('/api/courses', { token: admin.token, method: 'POST', body: sampleCourse() })).data;
  const src = await srv.call('/api/sources/text', { token: admin.token, method: 'POST', body: { name: 'x', text: LONG_TEXT } });
  const r = await srv.call(`/api/courses/${c.id}/ai-update`, { token: admin.token, method: 'POST', body: { source_ids: [src.data.id] } });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /ANTHROPIC_API_KEY/);
});

test('leer URL interna está bloqueado (SSRF)', async () => {
  const r = await srv.call('/api/sources/url', { token: admin.token, method: 'POST', body: { url: 'http://127.0.0.1:1/secret' } });
  assert.equal(r.status, 400);
});

test('subida de video valida formato y sirve el archivo con soporte de rangos', async () => {
  const bad = new FormData();
  bad.append('video', new Blob(['x']), 'malware.exe');
  assert.equal((await srv.call('/api/videos', { token: admin.token, method: 'POST', form: bad })).status, 415);
  const good = new FormData();
  good.append('video', new Blob([Buffer.alloc(2048, 1)], { type: 'video/mp4' }), 'intro.mp4');
  const up = await srv.call('/api/videos', { token: admin.token, method: 'POST', form: good });
  assert.equal(up.status, 201);
  const res = await fetch(srv.base + up.data.url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
});

test('cambio de rol protegido', async () => {
  const self = await srv.call(`/api/admin/users/${admin.user.id}/role`, { token: admin.token, method: 'POST', body: { role: 'learner' } });
  assert.equal(self.status, 400);
  const promote = await srv.call(`/api/admin/users/${learner.user.id}/role`, { token: admin.token, method: 'POST', body: { role: 'admin' } });
  assert.equal(promote.status, 200);
  await srv.call(`/api/admin/users/${learner.user.id}/role`, { token: admin.token, method: 'POST', body: { role: 'learner' } });
});
