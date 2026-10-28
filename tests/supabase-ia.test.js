// Formación IA por niveles (versión Supabase): examen de una sola ronda con tiempo
// controlado en la base, niveles, mapa de calor con permisos por rol, mentorías,
// Demo Days e indicadores.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeSupabase, openBrowser } from './supabase-fake.js';

let fake;
const ok = async (promise) => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
let admin; let dir; let ana; let beto; let caro; let otra;
let areas;
const areaId = (n) => areas.find((a) => a.name === n).id;

// Lee desde la base la opción correcta de la pregunta actual (solo en pruebas).
async function correctOf(q) {
  const r = await fake.db.query('select correct_shown from ia_attempt_items where attempt_id = $1 and position = $2', [q.attempt_id, q.position]);
  return r.rows[0].correct_shown;
}

// Responde el examen completo: plan(position, q) devuelve 'bien', 'mal' o 'tiempo'.
async function takeExam(b, plan) {
  let q = await ok(b.call('/api/ia/start', { method: 'POST', body: {} }));
  while (q.status === 'question') {
    const action = plan(q.position, q);
    if (action === 'tiempo') {
      await fake.db.query(`update ia_attempt_items set served_at = now() - interval '2 minutes' where attempt_id = $1 and position = $2`, [q.attempt_id, q.position]);
      q = await ok(b.call('/api/ia/current'));
      continue;
    }
    const correct = await correctOf(q);
    const choice = action === 'bien' ? correct : (correct + 1) % q.options.length;
    q = await ok(b.call('/api/ia/answer', { method: 'POST', body: { attempt_id: q.attempt_id, position: q.position, choice } }));
  }
  return q;
}

before(async () => {
  fake = await startFakeSupabase();
  admin = await openBrowser(fake, 'jefa@plataform.com', { name: 'Jefa Admin' });
  dir = await openBrowser(fake, 'dora@plataform.com', { name: 'Dora Directora' });
  ana = await openBrowser(fake, 'ana@plataform.com', { name: 'Ana' });
  beto = await openBrowser(fake, 'beto@plataform.com', { name: 'Beto' });
  caro = await openBrowser(fake, 'caro@plataform.com', { name: 'Caro' });
  otra = await openBrowser(fake, 'otra@plataform.com', { name: 'Otra Área' });
  areas = await ok(admin.call('/api/areas'));
  for (const b of [dir, ana, beto, caro]) await ok(b.call('/api/me/area', { method: 'POST', body: { area_id: areaId('Comercial') } }));
  await ok(otra.call('/api/me/area', { method: 'POST', body: { area_id: areaId('Finanzas') } }));
  await ok(admin.call(`/api/admin/users/${dir.id}/org-role`, { method: 'POST', body: { org_role: 'director' } }));
  for (const b of [ana, beto, caro, otra]) await ok(admin.call(`/api/admin/users/${b.id}/org-role`, { method: 'POST', body: { org_role: 'analista' } }));
});
after(async () => { await fake?.close(); });

test('el banco trae 15 preguntas en borrador que solo la administración ve', async () => {
  const bank = await ok(admin.call('/api/ia/questions'));
  assert.equal(bank.length, 15);
  assert.ok(bank.every((q) => q.draft));
  assert.deepEqual(['facil', 'media', 'dificil'].map((d) => bank.filter((q) => q.difficulty === d).length), [5, 5, 5]);
  assert.equal((await ana.call('/api/ia/questions')).status, 403);
  assert.equal((await ana.call('/api/ia/questions', { method: 'POST', body: { difficulty: 'facil', prompt: 'x', options: ['a', 'b'], correct_index: 0 } })).status, 403);
  const bad = await admin.call('/api/ia/questions', { method: 'POST', body: { difficulty: 'facil', prompt: '¿Pregunta válida?', options: ['solo una'], correct_index: 0 } });
  assert.equal(bad.status, 400);
});

test('examen: 15 preguntas mezcladas sin respuesta visible, 100 puntos y nivel según el puntaje', async () => {
  const first = await ok(ana.call('/api/ia/start', { method: 'POST', body: {} }));
  assert.equal(first.status, 'question');
  assert.equal(first.total, 15);
  assert.equal(first.position, 1);
  assert.equal(first.correct_shown, undefined, 'la respuesta correcta no llega al navegador');
  assert.ok(first.remaining_ms > 55000 && first.remaining_ms <= 60000);
  const again = await ok(ana.call('/api/ia/start', { method: 'POST', body: {} }));
  assert.equal(again.position, 1, 'reiniciar no crea otro intento ni reinicia el tiempo');
  const order = (await fake.db.query('select difficulty from ia_attempt_items where attempt_id = $1 order by position', [first.attempt_id])).rows.map((r) => r.difficulty);
  assert.deepEqual([...new Set(order)].sort(), ['dificil', 'facil', 'media']);
  assert.deepEqual(['facil', 'media', 'dificil'].map((d) => order.filter((x) => x === d).length), [5, 5, 5]);

  const result = await takeExam(ana, () => 'bien');
  assert.equal(result.status, 'finished');
  assert.equal(result.score, 100);
  assert.equal(result.level, 'constructor');
  assert.deepEqual(result.by_difficulty.map((d) => d.possible), [25, 35, 40]);

  const low = await takeExam(beto, () => 'mal');
  assert.equal(low.score, 0); assert.equal(low.level, 'explorador');

  // Fáciles (25) y medias (35) bien; de las difíciles, una bien (8) y al resto se le acaba el tiempo → 68, Practicante.
  let hardSeen = 0;
  const mid = await takeExam(caro, (pos, q) => (q.difficulty !== 'dificil' ? 'bien' : (hardSeen++ === 0 ? 'bien' : 'tiempo')));
  assert.equal(mid.score, 68); assert.equal(mid.level, 'practicante'); assert.equal(mid.unanswered, 4);

  const me = await ok(ana.call('/api/me'));
  assert.equal(me.user.ia_level, 'constructor');
});

test('responder fuera de tiempo cuenta como no respondida', async () => {
  const q = await ok(otra.call('/api/ia/start', { method: 'POST', body: {} }));
  const correct = await correctOf(q);
  await fake.db.query(`update ia_attempt_items set served_at = now() - interval '70 seconds' where attempt_id = $1 and position = 1`, [q.attempt_id]);
  const next = await ok(otra.call('/api/ia/answer', { method: 'POST', body: { attempt_id: q.attempt_id, position: 1, choice: correct } }));
  assert.equal(next.position, 2);
  const row = await fake.db.query('select status, earned from ia_attempt_items where attempt_id = $1 and position = 1', [q.attempt_id]);
  assert.deepEqual(row.rows[0], { status: 'sin_respuesta', earned: 0 });
  await takeExam(otra, () => 'bien');
});

test('una sola ronda: no se repite salvo que la administración reinicie el examen', async () => {
  assert.equal((await ok(beto.call('/api/ia/me'))).can_start, false);
  assert.equal((await beto.call('/api/ia/start', { method: 'POST', body: {} })).status, 409);
  assert.equal((await beto.call(`/api/ia/reset/${beto.id}`, { method: 'POST', body: {} })).status, 403);
  await ok(admin.call(`/api/ia/reset/${beto.id}`, { method: 'POST', body: {} }));
  assert.equal((await ok(beto.call('/api/ia/me'))).can_start, true);
  assert.equal((await beto.call('/api/ia/evidences', { method: 'POST', body: { kind: 'tarea', title: 'x' } })).status, 404, 'las evidencias ya no existen');
  const again = await takeExam(beto, (pos, q) => (q.difficulty === 'facil' || q.difficulty === 'media' ? 'bien' : 'mal'));
  assert.equal(again.attempt_no, 1);
  assert.equal(again.score, 60);
  assert.equal(again.level, 'practicante');
});

test('mapa de calor: la administración ve todo; el director solo agregados de su área', async () => {
  const all = await ok(admin.call('/api/ia/heatmap'));
  const com = all.rows.find((r) => r.area === 'Comercial');
  assert.deepEqual([com.explorador, com.practicante, com.constructor, com.total], [0, 2, 1, 3]);
  assert.ok(all.rows.some((r) => r.area === 'Finanzas'));
  assert.equal(all.progress, undefined, 'una sola ronda: no hay comparación entre exámenes');

  const mine = await ok(dir.call(`/api/ia/heatmap?area=${areaId('Finanzas')}`));
  assert.deepEqual(mine.rows.map((r) => r.area), ['Comercial'], 'el director no puede pedir otra área');
  assert.equal(mine.rows[0].practicante, 2);

  assert.equal((await ana.call('/api/ia/heatmap')).status, 403);
  await ok(admin.call(`/api/admin/users/${dir.id}/area`, { method: 'POST', body: { area_id: areaId('Finanzas') } }));
  const small = await ok(dir.call('/api/ia/heatmap'));
  assert.equal(small.rows[0].hidden, true);
  assert.equal(small.rows[0].constructor, null, 'un grupo de 1 persona no se muestra');
  await ok(admin.call(`/api/admin/users/${dir.id}/area`, { method: 'POST', body: { area_id: areaId('Comercial') } }));
  await assert.rejects(fake.asUser(dir.id, 'select * from ia_attempts'), /permission denied/);
});

test('mentorías: solicitar, asignar un Constructor y verlo en la ruta', async () => {
  await ok(caro.call('/api/ia/mentorships', { method: 'POST', body: { note: 'Quiero automatizar reportes' } }));
  assert.equal((await caro.call('/api/ia/mentorships', { method: 'POST', body: {} })).status, 409);
  assert.equal((await ana.call('/api/ia/mentorships', { method: 'POST', body: {} })).status, 409, 'un Constructor no pide mentor');
  const { items, mentors } = await ok(admin.call('/api/ia/mentorships'));
  assert.deepEqual(mentors.map((x) => x.name).sort(), ['Ana', 'Otra Área']);
  assert.equal((await admin.call(`/api/ia/mentorships/${items[0].id}/assign`, { method: 'POST', body: { mentor_id: beto.id } })).status, 400);
  await ok(admin.call(`/api/ia/mentorships/${items[0].id}/assign`, { method: 'POST', body: { mentor_id: ana.id } }));
  assert.equal((await ok(caro.call('/api/ia/me'))).mentorship.mentor, 'Ana');
  assert.equal((await ok(ana.call('/api/ia/me'))).mentees[0].name, 'Caro');
});

test('Demo Days: inscripción para presentar y encuesta después de la sesión', async () => {
  const future = new Date(Date.now() + 7 * 864e5).toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  assert.equal((await ana.call('/api/ia/sessions', { method: 'POST', body: { kind: 'demo_day', title: 'X', starts_at: future } })).status, 403);
  const next = await ok(admin.call('/api/ia/sessions', { method: 'POST', body: { kind: 'demo_day', title: 'Demo Day noviembre', starts_at: future } }));
  const prev = await ok(admin.call('/api/ia/sessions', { method: 'POST', body: { kind: 'micro', title: 'Prompts que funcionan', starts_at: past } }));
  await ok(ana.call(`/api/ia/sessions/${next.id}/signup`, { method: 'POST', body: { pitch: 'Mi agente de cobranza' } }));
  assert.equal((await ana.call(`/api/ia/sessions/${prev.id}/signup`, { method: 'POST', body: { pitch: 'x' } })).status, 400);
  assert.equal((await ana.call(`/api/ia/sessions/${next.id}/feedback`, { method: 'POST', body: { rating: 5 } })).status, 409);
  await ok(beto.call(`/api/ia/sessions/${prev.id}/feedback`, { method: 'POST', body: { rating: 4, comment: 'Muy útil' } }));
  await ok(caro.call(`/api/ia/sessions/${prev.id}/feedback`, { method: 'POST', body: { rating: 5 } }));
  const list = await ok(admin.call('/api/ia/sessions'));
  const p = list.find((s) => s.id === prev.id);
  assert.equal(Number(p.avg_rating), 4.5);
  assert.equal(list.find((s) => s.id === next.id).presenters[0].pitch, 'Mi agente de cobranza');
  const learnerView = (await ok(beto.call('/api/ia/sessions'))).find((s) => s.id === prev.id);
  assert.equal(learnerView.my_rating, 4);
  assert.equal(learnerView.avg_rating, null, 'el promedio es solo para la administración');
});

test('indicadores sin usuarios de prueba y usuarios demo por nivel', async () => {
  await ok(admin.call('/api/ia/total', { method: 'POST', body: { total: 40 } }));
  for (const lvl of ['explorador', 'practicante', 'constructor']) await openBrowser(fake, `demo.${lvl}@plataform.com`, { name: `Demo ${lvl}` });
  const setup = await ok(admin.call('/api/ia/demo-setup', { method: 'POST', body: {} }));
  assert.equal(setup.ready.length, 3);
  const k = await ok(admin.call('/api/ia/kpis'));
  assert.equal(k.total_personal, 40);
  assert.equal(k.tested, 4, 'Ana, Beto, Caro y Otra; los demo no cuentan');
  const otraScore = (await fake.db.query('select score from ia_attempts where user_id = $1', [otra.id])).rows[0].score;
  assert.ok([92, 93, 95].includes(otraScore), 'Otra perdió una sola pregunta por tiempo');
  assert.equal(Number(k.avg_score), Math.round((100 + 60 + 68 + otraScore) / 4));
  assert.deepEqual(k.by_difficulty.map((d) => d.difficulty), ['facil', 'media', 'dificil']);
  assert.deepEqual([k.levels.constructor, k.levels.practicante, k.levels.explorador], [2, 2, 0]);
  const demoLevels = await fake.db.query(`select p.email, a.level from ia_attempts a join profiles p on p.id = a.user_id where p.is_demo order by a.score`);
  assert.deepEqual(demoLevels.rows.map((r) => r.level), ['explorador', 'practicante', 'constructor']);
  assert.equal((await ana.call('/api/ia/kpis')).status, 403);
});
