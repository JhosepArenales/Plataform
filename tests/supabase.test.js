// Versión con Supabase: el backend del navegador (supabase/backend.js) con el cliente
// oficial de Supabase, contra la base real (supabase/schema.sql) en Postgres embebido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as supabaseJs from '@supabase/supabase-js';
import { startFakeSupabase } from './supabase-fake.js';
import { LONG_TEXT, makeDocx } from './helpers.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fake;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Un navegador por persona: su propio cliente de Supabase y su propia sesión.
async function browser(email, { name = 'Persona', create = true, password = 'clave-segura-1' } = {}) {
  const window = { supabase: supabaseJs, localStorage: memoryStorage(), fetch: globalThis.fetch };
  const ctx = vm.createContext({ window, crypto: globalThis.crypto, Response, URL, URLSearchParams, TextDecoder, FormData, File, Blob, DecompressionStream, console });
  vm.runInContext(read('supabase/config.js').replace(/url: '[^']+'/, `url: '${fake.url}'`).replace(/^const /m, 'var '), ctx);
  vm.runInContext(read('demo/lib/content.js'), ctx);
  vm.runInContext(read('supabase/backend.js'), ctx);
  const sb = vm.runInContext('sb', ctx);
  const auth = create
    ? await sb.auth.signUp({ email, password, options: { data: { name } } })
    : await sb.auth.signInWithPassword({ email, password });
  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await window.fetch(p, { method, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  return { call, sb, auth, id: auth.data?.user?.id };
}

const ok = async (promise) => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
let admin; let ana; let beto;
let areas;
const areaId = (n) => areas.find((a) => a.name === n).id;

before(async () => {
  fake = await startFakeSupabase();
  admin = await browser('jefa@plataform.com', { name: 'Jefa Admin' });
  ana = await browser('ana@plataform.com', { name: 'Ana Comercial' });
  beto = await browser('beto@plataform.com', { name: 'Beto Tecnología' });
  areas = await ok(admin.call('/api/areas'));
});
after(async () => { await fake?.close(); });

const course = (title, extra = {}) => ({
  title, category: 'Inducción', cover_emoji: '📘', description: 'Curso de prueba',
  lessons: [
    { type: 'reading', title: 'Lectura 1', content: '## Hola', duration_min: 5 },
    { type: 'video', title: 'Video', video_url: 'https://youtu.be/dQw4w9WgXcQ', duration_min: 3 },
    { type: 'quiz', title: 'Quiz', duration_min: 3, questions: [
      { prompt: '¿Uno?', options: ['A', 'B', 'C'], correct_index: 1, explanation: 'Es B' },
      { prompt: '¿Dos?', options: ['X', 'Y'], correct_index: 0, explanation: 'Es X' },
    ] },
  ],
  ...extra,
});

test('la primera cuenta es administradora, las demás aprenden; otros dominios no entran', async () => {
  assert.equal((await ok(admin.call('/api/me'))).user.role, 'admin');
  assert.equal((await ok(ana.call('/api/me'))).user.role, 'learner');
  const intruso = await browser('alguien@gmail.com');
  assert.match(intruso.auth.error.message, /Database error saving new user/);
  assert.equal(areas.length, 6);
});

test('sin sesión no se puede leer nada, ni siquiera las tablas directamente', async () => {
  const anon = await browser('nadie@plataform.com', { create: false });
  assert.equal((await anon.call('/api/courses')).status, 401);
  await assert.rejects(fake.asUser(ana.id, 'select * from course_keys'), /permission denied/);
  await assert.rejects(fake.asUser(ana.id, 'select * from profiles'), /permission denied/);
});

test('cursos por área, quiz corregido en la base y puntos', async () => {
  const general = await ok(admin.call('/api/courses', { method: 'POST', body: course('Bienvenida') }));
  const comercial = await ok(admin.call('/api/courses', { method: 'POST', body: course('Negociación', { area_ids: [areaId('Comercial')] }) }));
  for (const c of [general, comercial]) await ok(admin.call(`/api/courses/${c.id}/status`, { method: 'POST', body: { status: 'published' } }));

  // Sin área elegida, la persona solo ve lo de toda la empresa.
  await ok(ana.call('/api/me/area', { method: 'POST', body: { area_id: areaId('Comercial') } }));
  await ok(beto.call('/api/me/area', { method: 'POST', body: { area_id: areaId('Tecnología') } }));
  const titles = async (b) => (await ok(b.call('/api/courses'))).map((c) => c.title).sort();
  assert.deepEqual(await titles(ana), ['Bienvenida', 'Negociación']);
  assert.deepEqual(await titles(beto), ['Bienvenida']);
  assert.equal((await beto.call(`/api/courses/${comercial.id}`)).status, 404);

  const view = await ok(ana.call(`/api/courses/${general.id}`));
  const quiz = view.lessons.find((l) => l.type === 'quiz');
  assert.equal(quiz.questions[0].correct_index, undefined, 'las respuestas no llegan al navegador');
  assert.equal(quiz.questions[0].explanation, undefined);

  const wrong = await ok(ana.call(`/api/lessons/${quiz.id}/quiz`, { method: 'POST', body: { answers: [0, 1] } }));
  assert.equal(wrong.score, 0); assert.equal(wrong.passed, false); assert.equal(wrong.gained, 0);
  const right = await ok(ana.call(`/api/lessons/${quiz.id}/quiz`, { method: 'POST', body: { answers: [1, 0] } }));
  assert.equal(right.score, 2); assert.equal(right.passed, true);
  assert.equal(right.gained, 2 * 5 + 20 + 10, 'aciertos + quiz perfecto + lección');
  assert.equal(right.results[0].explanation, 'Es B');

  for (const l of view.lessons.filter((x) => x.type !== 'quiz')) await ok(ana.call(`/api/lessons/${l.id}/complete`, { method: 'POST', body: {} }));
  const again = await ok(ana.call(`/api/lessons/${view.lessons[0].id}/complete`, { method: 'POST', body: {} }));
  assert.equal(again.gained, 0, 'una lección solo da puntos una vez');
  const me = await ok(ana.call('/api/me'));
  assert.equal(me.stats.xp, 30 + 3 * 10 + 50, 'quiz + 3 lecciones + curso completo');
  assert.equal(me.stats.courses_done, 1);
  assert.ok(me.stats.badges.find((b) => b.id === 'perfect').earned);

  const board = await ok(beto.call('/api/leaderboard'));
  assert.equal(board[0].name, 'Ana Comercial');
  assert.equal(board[0].level, 'Aprendiz', '110 XP es nivel 2');
  const areaBoard = await ok(beto.call('/api/leaderboard?scope=area'));
  assert.ok(!areaBoard.some((r) => r.name === 'Ana Comercial'));
});

test('editar conserva el progreso de las lecciones que siguen, versiones y restaurar', async () => {
  const created = await ok(admin.call('/api/courses', { method: 'POST', body: course('Procesos') }));
  await ok(admin.call(`/api/courses/${created.id}/status`, { method: 'POST', body: { status: 'published' } }));
  const [first, second] = created.lessons;
  await ok(beto.call(`/api/lessons/${first.id}/complete`, { method: 'POST', body: {} }));
  await ok(beto.call(`/api/lessons/${second.id}/complete`, { method: 'POST', body: {} }));

  const edited = await ok(admin.call(`/api/courses/${created.id}`));
  assert.equal(edited.lessons[2].questions[0].correct_index, 1, 'la administración sí ve las respuestas');
  edited.lessons.splice(1, 1); // quita el video
  edited.lessons[0].title = 'Lectura renombrada';
  const saved = await ok(admin.call(`/api/courses/${created.id}`, { method: 'PUT', body: { ...edited, change_note: 'Quité el video' } }));
  assert.equal(saved.version, 2);
  assert.equal(saved.lessons[0].id, first.id, 'la lección conserva su id');

  const progress = (await ok(beto.call(`/api/courses/${created.id}`))).progress;
  assert.deepEqual(progress.done_lesson_ids, [first.id]);
  assert.equal(progress.total, 2);

  const versions = await ok(admin.call(`/api/courses/${created.id}/versions`));
  assert.deepEqual(versions.map((v) => v.change_note), ['Quité el video', 'Versión inicial']);
  const restored = await ok(admin.call(`/api/courses/${created.id}/versions/${versions[1].id}/restore`, { method: 'POST', body: {} }));
  assert.equal(restored.version, 3);
  assert.equal(restored.lessons.length, 3);
  assert.equal(restored.lessons[2].questions[1].correct_index, 0);
});

test('solo la administración crea, publica y gestiona personas', async () => {
  assert.equal((await ana.call('/api/courses', { method: 'POST', body: course('Pirata') })).status, 403);
  assert.equal((await ana.call('/api/admin/metrics')).status, 403);
  assert.equal((await ana.call('/api/areas', { method: 'POST', body: { name: 'Hackers' } })).status, 403);
  assert.equal((await admin.call('/api/areas', { method: 'POST', body: { name: 'comercial' } })).status, 409);
  const nueva = await ok(admin.call('/api/areas', { method: 'POST', body: { name: 'Logística', icon: '🚚' } }));
  assert.equal(nueva.name, 'Logística');

  const users = await ok(admin.call('/api/admin/users'));
  assert.equal(users.length, 3);
  const self = users.find((u) => u.role === 'admin');
  assert.equal((await admin.call(`/api/admin/users/${self.id}/role`, { method: 'POST', body: { role: 'learner' } })).status, 400);
  await ok(admin.call(`/api/admin/users/${beto.id}/area`, { method: 'POST', body: { area_id: nueva.id } }));
  assert.equal((await ok(beto.call('/api/me'))).user.area_name, 'Logística');

  const m = await ok(admin.call('/api/admin/metrics'));
  assert.equal(m.learners, 2);
  assert.ok(m.courses.some((c) => c.title === 'Bienvenida' && c.started >= 1));
  const comercial = m.areas.find((a) => a.name === 'Comercial');
  assert.equal(comercial.people, 1);
  assert.ok(comercial.avg_progress > 0);
});

test('crear un curso desde texto pegado y desde un Word, en modo básico', async () => {
  const src = await ok(admin.call('/api/sources/text', { method: 'POST', body: { name: 'Manual', text: LONG_TEXT } }));
  assert.ok(src.char_count > 100);
  const docx = await makeDocx(LONG_TEXT);
  const form = new FormData();
  form.append('files', new File([docx], 'manual.docx'));
  const [word] = await ok(admin.call('/api/sources/files', { method: 'POST', body: form }));
  assert.equal(word.kind, 'word', JSON.stringify(word));

  const r = await ok(admin.call('/api/ai/generate', { method: 'POST', body: { source_ids: [src.id, word.id], lesson_count: 3, area_ids: [areaId('Finanzas')] } }));
  assert.equal(r.mode, 'basic');
  assert.equal(r.course.status, 'draft');
  assert.deepEqual(r.course.area_ids, [areaId('Finanzas')]);
  assert.ok(r.course.lessons.some((l) => l.type === 'quiz'));
  assert.deepEqual(r.course.sources.map((s) => s.name).sort(), ['Manual', 'manual.docx']);
  assert.equal((await ana.call('/api/sources/text', { method: 'POST', body: { name: 'x', text: LONG_TEXT } })).status, 403);
});
