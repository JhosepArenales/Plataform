import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveGames } from '../server/services/live-game.js';
import { startServer, sampleCourse } from './helpers.js';

const QUESTIONS = [
  { prompt: 'Q1', options: ['a', 'b', 'c', 'd'], correct_index: 2, explanation: 'porque c', time_limit_sec: 20 },
  { prompt: 'Q2', options: ['x', 'y'], correct_index: 0, explanation: '', time_limit_sec: 10 },
];

test('partida completa: lobby, respuestas, puntaje por rapidez, ranking y podio', () => {
  let t = 0;
  const finished = [];
  const games = createLiveGames({ clock: () => t, onFinished: (r) => finished.push(r) });
  const { pin, hostKey } = games.create({ hostUserId: 'h', title: 'Demo', questions: QUESTIONS });
  const views = { host: [], ana: [], beto: [] };
  const ana = games.join(pin, { nickname: 'Ana', userId: 'u1' });
  const beto = games.join(pin, { nickname: 'Beto' });
  assert.throws(() => games.join(pin, { nickname: 'ana' }), /en uso/);
  games.subscribe(pin, { role: 'host', hostKey }, (v) => views.host.push(v));
  games.subscribe(pin, { role: 'player', ...ana }, (v) => views.ana.push(v));
  games.subscribe(pin, { role: 'player', ...beto }, (v) => views.beto.push(v));
  assert.throws(() => games.subscribe(pin, { role: 'host', hostKey: 'mala' }, () => {}), /Solo quien/);
  assert.throws(() => games.start(pin, 'mala'), /Solo quien/);

  games.start(pin, hostKey);
  const q = views.ana.at(-1);
  assert.equal(q.phase, 'question');
  assert.equal(q.question.correct_index, undefined, 'el jugador no ve la respuesta durante la pregunta');

  t = 2000; games.answer(pin, { ...ana, choice: 2 }); // rápida y correcta
  assert.throws(() => games.answer(pin, { ...ana, choice: 2 }), /Ya respondiste/);
  t = 18000; games.answer(pin, { ...beto, choice: 1 }); // todos respondieron → revela
  const rev = views.host.at(-1);
  assert.equal(rev.phase, 'reveal');
  assert.deepEqual(rev.distribution, [0, 1, 1, 0]);
  assert.equal(views.ana.at(-1).me.last_correct, true);
  assert.equal(views.ana.at(-1).me.last_gain, 950); // 1000 * (1 - 0.1/2)
  assert.equal(views.beto.at(-1).me.last_correct, false);

  games.next(pin, hostKey); // ranking
  assert.equal(views.host.at(-1).phase, 'leaderboard');
  assert.equal(views.host.at(-1).ranking[0].name, 'Ana');
  games.next(pin, hostKey); // pregunta 2
  t = 19000; games.answer(pin, { ...ana, choice: 0 });
  t = 20000; games.answer(pin, { ...beto, choice: 0 });
  // racha: Ana suma +100
  assert.equal(views.ana.at(-1).me.last_gain, Math.round(1000 * (1 - 0.1 / 2)) + 100);
  games.next(pin, hostKey); games.next(pin, hostKey);
  assert.equal(views.host.at(-1).phase, 'finished');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].ranking[0].userId, 'u1');
  assert.throws(() => games.answer(pin, { ...beto, choice: 0 }), /terminó/);
});

test('el tiempo agotado revela automáticamente', async () => {
  const games = createLiveGames();
  const { pin, hostKey } = games.create({ hostUserId: 'h', title: 'T', questions: [{ ...QUESTIONS[0], time_limit_sec: 0 }] });
  const p = games.join(pin, { nickname: 'Solo' });
  const views = [];
  games.subscribe(pin, { role: 'player', ...p }, (v) => views.push(v));
  games.start(pin, hostKey);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(views.at(-1).phase, 'reveal');
  assert.equal(views.at(-1).me.last_correct, null);
});

test('juego vía HTTP con SSE y XP para jugadores con sesión', async () => {
  const srv = await startServer();
  try {
    const admin = await srv.login('host@empresa.com', 'Host');
    const learner = await srv.login('p@empresa.com', 'Pepa');
    const course = (await srv.call('/api/courses', { token: admin.token, method: 'POST', body: sampleCourse() })).data;
    assert.equal((await srv.call('/api/games', { token: learner.token, method: 'POST', body: { course_id: course.id } })).status, 403);
    const g = (await srv.call('/api/games', { token: admin.token, method: 'POST', body: { course_id: course.id } })).data;
    assert.equal(g.question_count, 2);
    const p = (await srv.call(`/api/games/${g.pin}/join`, { token: learner.token, method: 'POST', body: { nickname: 'Pepa' } })).data;

    const ctrl = new AbortController();
    const res = await fetch(`${srv.base}/api/games/${g.pin}/events?role=player&playerId=${p.playerId}&playerKey=${p.playerKey}`, { signal: ctrl.signal });
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /"phase":"lobby"/);

    const ctl = (a) => srv.call(`/api/games/${g.pin}/${a}`, { method: 'POST', body: { hostKey: g.hostKey } });
    await ctl('start');
    await srv.call(`/api/games/${g.pin}/answer`, { method: 'POST', body: { playerId: p.playerId, playerKey: p.playerKey, choice: 0 } });
    await ctl('next'); await ctl('next');
    await srv.call(`/api/games/${g.pin}/answer`, { method: 'POST', body: { playerId: p.playerId, playerKey: p.playerKey, choice: 0 } });
    await ctl('next'); await ctl('next');
    ctrl.abort();

    const me = (await srv.call('/api/me', { token: learner.token })).data.stats;
    assert.equal(me.xp, 40); // jugó (10) + podio #1 (30)
    assert.ok(me.badges.find((b) => b.id === 'game').earned);
    assert.equal((await srv.call('/api/games/000000/join', { method: 'POST', body: { nickname: 'x' } })).status, 404);
  } finally { await srv.stop(); }
});

test('lista de partidas abiertas: solo con facilitador presente, por área y sin terminadas', async () => {
  let t = 0;
  const games = createLiveGames({ clock: () => t });
  const a = games.create({ hostUserId: 'h1', hostName: 'Ana', title: 'General', questions: QUESTIONS });
  const b = games.create({ hostUserId: 'h2', hostName: 'Beto', title: 'Solo Comercial', questions: QUESTIONS, areaIds: ['com'] });
  const unsubA = games.subscribe(a.pin, { role: 'host', hostKey: a.hostKey }, () => {});
  games.subscribe(b.pin, { role: 'host', hostKey: b.hostKey }, () => {});
  const titles = (opts) => games.listOpen(opts).map((g) => g.title).sort();
  assert.deepEqual(titles({ areaId: 'tec' }), ['General']);
  assert.deepEqual(titles({ areaId: 'com' }), ['General', 'Solo Comercial']);
  assert.deepEqual(titles({ seeAll: true }), ['General', 'Solo Comercial']);
  assert.equal(games.listOpen({ userId: 'h1' }).find((g) => g.title === 'General').mine, true);
  assert.equal(games.listOpen({}).find((g) => g.title === 'General').host_name, 'Ana');

  // El facilitador cierra su pantalla: sigue listada durante el margen y luego desaparece.
  unsubA(); t += 30_000;
  assert.deepEqual(titles({ areaId: 'tec' }), ['General']);
  t += 40_000;
  assert.deepEqual(titles({ areaId: 'tec' }), []);

  // Recuperar el control: solo quien la creó (o administración).
  assert.throws(() => games.resume(a.pin, { userId: 'otro', isAdmin: false }), /Solo quien/);
  assert.equal(games.resume(a.pin, { userId: 'h1', isAdmin: false }).hostKey, a.hostKey);

  // Terminada: no se lista.
  games.join(b.pin, { nickname: 'P' });
  games.end(b.pin, b.hostKey);
  assert.deepEqual(titles({ seeAll: true }), []);
});

test('GET /api/games respeta el área de quien consulta', async () => {
  const srv = await startServer();
  try {
    const admin = await srv.login('host@e.com', 'Hilda Host');
    const ventas = await srv.login('v@e.com', 'Vale');
    const areas = (await srv.call('/api/areas', { token: admin.token })).data;
    const com = areas.find((a) => a.name === 'Comercial').id;
    const tec = areas.find((a) => a.name === 'Tecnología').id;
    await srv.call('/api/me/area', { token: ventas.token, method: 'POST', body: { area_id: tec } });
    const course = (await srv.call('/api/courses', { token: admin.token, method: 'POST', body: { ...sampleCourse(), area_ids: [com] } })).data;
    const g = (await srv.call('/api/games', { token: admin.token, method: 'POST', body: { course_id: course.id } })).data;
    // Recién creada (facilitador abriendo su pantalla): visible para administración, no para Tecnología.
    assert.equal((await srv.call('/api/games', { token: admin.token })).data[0].host_name, 'Hilda Host');
    assert.equal((await srv.call('/api/games', { token: ventas.token })).data.length, 0);
    await srv.call('/api/me/area', { token: ventas.token, method: 'POST', body: { area_id: com } });
    const list = (await srv.call('/api/games', { token: ventas.token })).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].pin, g.pin);
    assert.equal((await srv.call(`/api/games/${g.pin}/resume`, { token: ventas.token, method: 'POST' })).status, 403);
    assert.equal((await srv.call(`/api/games/${g.pin}/resume`, { token: admin.token, method: 'POST' })).data.hostKey, g.hostKey);
    assert.equal((await srv.call('/api/games')).status, 401);
  } finally { await srv.stop(); }
});
