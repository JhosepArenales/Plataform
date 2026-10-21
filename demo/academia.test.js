// Pruebas de la demo publicada: ejecutan el backend simulado TAL COMO va dentro de
// index.html (no una copia), en un entorno de navegador mínimo. Solo módulos de Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ---- demo/lib/content.js ----');
const end = html.indexOf('// ---- public/js/ui.js ----');
assert.ok(start > 0 && end > start, 'index.html debe contener el backend simulado');
const backendSource = html.slice(start, end);

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}

// Cada prueba arranca con datos de ejemplo nuevos y sin temporizadores colgando.
function boot() {
  const timers = new Set();
  const window = { localStorage: memoryStorage(), sessionStorage: memoryStorage(), fetch: async () => { throw new Error('sin red'); } };
  const ctx = vm.createContext({
    window, crypto: globalThis.crypto, Response, URL, URLSearchParams, TextDecoder, FormData, Event, console,
    setTimeout: (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; },
    clearTimeout: (t) => { timers.delete(t); clearTimeout(t); },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; },
    clearInterval: (t) => { timers.delete(t); clearInterval(t); },
  });
  vm.runInContext(backendSource, ctx);
  const call = async (p, { token, method = 'GET', body } = {}) => {
    const res = await window.fetch(p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const stop = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } };
  return { call, demo: vm.runInContext('demo', ctx), stop };
}

test('los datos de ejemplo traen áreas y cursos publicados', async () => {
  const { call, demo, stop } = boot();
  try {
    const { token } = demo.loginAs('ana.gomez@plataform.com');
    const areas = (await call('/api/areas', { token })).data;
    assert.equal(areas.length, 6);
    const courses = (await call('/api/courses?all=1', { token })).data;
    assert.ok(courses.length >= 8);
    assert.ok(courses.every((c) => c.status === 'published'));
  } finally { stop(); }
});

test('cada persona ve solo los cursos de su área y los de toda la empresa', async () => {
  const { call, demo, stop } = boot();
  try {
    const { token } = demo.loginAs('andrea.torres@plataform.com', { resetArea: true });
    const areas = (await call('/api/areas', { token })).data;
    const id = (n) => areas.find((a) => a.name === n).id;
    const titles = async () => (await call('/api/courses', { token })).data.map((c) => c.title);

    await call('/api/me/area', { token, method: 'POST', body: { area_id: id('Comercial') } });
    const com = await titles();
    assert.ok(com.includes('Técnicas de negociación'));
    assert.ok(com.includes('Bienvenida a Plataform'));
    assert.ok(!com.includes('Mesa de ayuda y tickets'));

    await call('/api/me/area', { token, method: 'POST', body: { area_id: id('Tecnología') } });
    const tec = await titles();
    assert.ok(tec.includes('Mesa de ayuda y tickets'));
    assert.ok(!tec.includes('Técnicas de negociación'));

    const admin = demo.loginAs('ana.gomez@plataform.com').token;
    const all = (await call('/api/courses?all=1', { token: admin })).data;
    const otherArea = all.find((c) => c.title === 'Técnicas de negociación');
    assert.equal((await call(`/api/courses/${otherArea.id}`, { token })).status, 404);
  } finally { stop(); }
});

test('el quiz se corrige sin enviar las respuestas al navegador y suma XP', async () => {
  const { call, demo, stop } = boot();
  try {
    const admin = demo.loginAs('ana.gomez@plataform.com').token;
    const learner = demo.loginAs('andrea.torres@plataform.com').token;
    const areas = (await call('/api/areas', { token: learner })).data;
    await call('/api/me/area', { token: learner, method: 'POST', body: { area_id: areas[0].id } });
    const listed = (await call('/api/courses', { token: learner })).data.find((c) => c.title === 'Seguridad de la información');
    const course = (await call(`/api/courses/${listed.id}`, { token: learner })).data;
    const quiz = course.lessons.find((l) => l.type === 'quiz');
    assert.equal(quiz.questions[0].correct_index, undefined);

    const full = (await call(`/api/courses/${listed.id}`, { token: admin })).data;
    const answers = full.lessons.find((l) => l.id === quiz.id).questions.map((q) => q.correct_index);
    const r = (await call(`/api/lessons/${quiz.id}/quiz`, { token: learner, method: 'POST', body: { answers } })).data;
    assert.equal(r.score, r.total);
    assert.equal(r.passed, true);
    assert.ok(r.gained > 0);
  } finally { stop(); }
});

test('una persona sin rol de administración no puede crear cursos', async () => {
  const { call, demo, stop } = boot();
  try {
    const { token } = demo.loginAs('luis.perez@plataform.com');
    const r = await call('/api/courses', { token, method: 'POST', body: { title: 'X', lessons: [] } });
    assert.equal(r.status, 403);
    assert.equal((await call('/api/admin/metrics', { token })).status, 403);
  } finally { stop(); }
});

test('la lista de partidas abiertas respeta el área', async () => {
  const { call, demo, stop } = boot();
  try {
    const comercial = demo.loginAs('luis.perez@plataform.com').token;
    const titles = (await call('/api/games', { token: comercial })).data.map((g) => g.title);
    assert.ok(titles.includes('Técnicas de negociación'));

    const tec = demo.loginAs('valentina.cruz@plataform.com').token;
    const tecTitles = (await call('/api/games', { token: tec })).data.map((g) => g.title);
    assert.ok(tecTitles.includes('Bienvenida a Plataform'));
    assert.ok(!tecTitles.includes('Técnicas de negociación'));
  } finally { stop(); }
});
