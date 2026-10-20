import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, sampleCourse } from './helpers.js';
import { openDatabase } from '../server/db.js';

let srv; let admin; let ventas; let tech;
const areaId = async (name) => (await srv.call('/api/areas', { token: admin.token })).data.find((a) => a.name === name).id;

before(async () => {
  srv = await startServer();
  admin = await srv.login('admin@e.com', 'Admin');
  ventas = await srv.login('ventas@e.com', 'Vera Ventas');
  tech = await srv.login('tech@e.com', 'Tito Tech');
});
after(() => srv.stop());

test('hay áreas por defecto y una persona nueva todavía no tiene área', async () => {
  const list = (await srv.call('/api/areas', { token: ventas.token })).data;
  assert.ok(list.find((a) => a.name === 'Comercial'));
  assert.equal(ventas.user.area_id, null);
});

test('la persona elige su área y ve solo los cursos de su área y los de toda la empresa', async () => {
  const comercial = await areaId('Comercial');
  const tecnologia = await areaId('Tecnología');
  const publish = async (title, area_ids) => {
    const c = (await srv.call('/api/courses', { token: admin.token, method: 'POST', body: { ...sampleCourse(), title, area_ids } })).data;
    await srv.call(`/api/courses/${c.id}/status`, { token: admin.token, method: 'POST', body: { status: 'published' } });
    return c;
  };
  const general = await publish('General', []);
  const deVentas = await publish('Ventas', [comercial]);
  const deTech = await publish('Soporte', [tecnologia]);
  const mixto = await publish('CRM', [comercial, tecnologia]);
  assert.deepEqual(deVentas.area_ids, [comercial]);

  assert.equal((await srv.call('/api/me/area', { token: ventas.token, method: 'POST', body: { area_id: 'no-existe' } })).status, 400);
  const r = await srv.call('/api/me/area', { token: ventas.token, method: 'POST', body: { area_id: comercial } });
  assert.equal(r.data.area.name, 'Comercial');
  await srv.call('/api/me/area', { token: tech.token, method: 'POST', body: { area_id: tecnologia } });

  const titles = async (tok) => (await srv.call('/api/courses', { token: tok })).data.map((c) => c.title).sort();
  assert.deepEqual(await titles(ventas.token), ['CRM', 'General', 'Ventas']);
  assert.deepEqual(await titles(tech.token), ['CRM', 'General', 'Soporte']);

  // Abrir por link directo un curso de otra área tampoco funciona.
  assert.equal((await srv.call(`/api/courses/${deTech.id}`, { token: ventas.token })).status, 404);
  assert.equal((await srv.call(`/api/courses/${general.id}`, { token: ventas.token })).status, 200);
  // La administración ve todo.
  assert.equal((await srv.call('/api/courses?all=1', { token: admin.token })).data.length >= 4, true);

  const me = (await srv.call('/api/me', { token: ventas.token })).data.user;
  assert.equal(me.area_name, 'Comercial');

  // Cambiar el público de un curso conserva la versión y se refleja al instante.
  const full = (await srv.call(`/api/courses/${mixto.id}`, { token: admin.token })).data;
  const upd = await srv.call(`/api/courses/${mixto.id}`, { token: admin.token, method: 'PUT', body: { ...full, area_ids: [tecnologia], change_note: 'Solo TI' } });
  assert.equal(upd.data.version, 2);
  assert.deepEqual(await titles(ventas.token), ['General', 'Ventas']);

  // Indicadores por área
  await srv.call(`/api/lessons/${deVentas.lessons[0].id}/complete`, { token: ventas.token, method: 'POST' });
  const m = (await srv.call('/api/admin/metrics', { token: admin.token })).data;
  const com = m.areas.find((a) => a.name === 'Comercial');
  assert.equal(com.people, 1);
  assert.equal(com.assigned_lessons, 6);
  assert.equal(com.avg_progress, 17); // 1 de 6 lecciones asignadas
  assert.equal(m.people_without_area, 1); // la administradora

  // Ranking del área
  const board = (await srv.call('/api/leaderboard?scope=area', { token: ventas.token })).data;
  assert.deepEqual(board.map((b) => b.name), ['Vera Ventas']);
});

test('gestión de áreas: crear, evitar duplicados y desactivar', async () => {
  const created = await srv.call('/api/areas', { token: admin.token, method: 'POST', body: { name: 'Logística', icon: '🚚' } });
  assert.equal(created.status, 201);
  const dup = await srv.call('/api/areas', { token: admin.token, method: 'POST', body: { name: 'logística' } });
  assert.equal(dup.status, 409);
  assert.equal((await srv.call('/api/areas', { token: ventas.token, method: 'POST', body: { name: 'X' } })).status, 403);
  await srv.call(`/api/areas/${created.data.id}`, { token: admin.token, method: 'PUT', body: { active: false } });
  assert.equal((await srv.call('/api/areas', { token: ventas.token })).data.some((a) => a.name === 'Logística'), false);
  assert.equal((await srv.call('/api/me/area', { token: ventas.token, method: 'POST', body: { area_id: created.data.id } })).status, 400);
});

test('la administración puede corregir el área de una persona', async () => {
  const fin = await areaId('Finanzas');
  assert.equal((await srv.call(`/api/admin/users/${tech.user.id}/area`, { token: admin.token, method: 'POST', body: { area_id: fin } })).status, 200);
  const users = (await srv.call('/api/admin/users', { token: admin.token })).data;
  assert.equal(users.find((u) => u.id === tech.user.id).area_id, fin);
});

test('una base creada antes de las áreas se migra sin perder datos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academia-mig-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL); INSERT INTO users VALUES ('u1','a@b.c','Ana','admin',1,'2026-01-01');");
  old.close();
  const db = openDatabase(file);
  const u = db.prepare('SELECT * FROM users').get();
  assert.equal(u.name, 'Ana');
  assert.equal(u.area_id, null);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM areas').get().n >= 6);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
