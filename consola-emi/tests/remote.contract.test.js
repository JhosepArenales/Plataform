// Contrato consola ↔ n8n con respuestas grabadas (fixtures) y casos de error 401/429/500/timeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'adapters', 'remote.js'));
const FX = require('./fixtures/n8n.json');
const { E, chat, ctx } = require('./helpers.js');

function res(status, body) { return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) }); }
function fakeFetch(seq) {
  const calls = [];
  const fn = (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const s = seq[Math.min(calls.length - 1, seq.length - 1)]; return typeof s === 'function' ? s() : res(s[0], s[1]); };
  fn.calls = calls;
  return fn;
}
const client = (f, extra = {}) => R.createClient({ fetch: f, timeoutMs: 50, retries: 1, ...extra });

test('client-lookup: request y mapeo de respuesta', async () => {
  const f = fakeFetch([[200, FX.client_lookup_ok]]);
  const r = await client(f).clientLookup().find('79378202');
  assert.equal(f.calls[0].url, '/api/proxy/emi-n8n/webhook/emi/client-lookup');
  assert.deepEqual(f.calls[0].body, { documento: '79378202' });
  assert.deepEqual(r, { estado: 'inversionista', nombre: 'Carlos', id: '123' });
});

test('operation-lookup: mapeo snake_case → modelo del motor', async () => {
  const f = fakeFetch([[200, FX.operation_lookup_ok]]);
  const r = await client(f).operationLookup().find('6543', 'Logística');
  assert.deepEqual(f.calls[0].body, { numero_operacion: '6543', empresa: 'Logística' });
  assert.equal(r.estado, 'prejuridico');
  assert.equal(r.empresa.razonSocial, 'Logística Ficticia del Caribe SAS');
  assert.equal(r.ultimaComunicacion.fecha, '2026-10-08');
  const nf = await client(fakeFetch([[200, FX.operation_lookup_not_found]])).operationLookup().find('1', 'x');
  assert.deepEqual(nf, { found: false });
});

test('escalate: created / existing', async () => {
  const c = client(fakeFetch([[200, FX.escalate_created], [200, FX.escalate_existing]])).escalationSink();
  assert.deepEqual(await c.escalate({ conversationId: 'c1', motivo: 'reclamo' }), { ticketId: '987654', created: true });
  assert.deepEqual(await c.escalate({ conversationId: 'c1', motivo: 'reclamo' }), { ticketId: '987654', created: false });
});

test('401: no reintenta y falla', async () => {
  const f = fakeFetch([[401, {}]]);
  await assert.rejects(client(f).clientLookup().find('1'), (e) => e.status === 401);
  assert.equal(f.calls.length, 1);
});

test('429 y 500: reintenta una vez con backoff', async () => {
  const f = fakeFetch([[429, {}], [200, FX.client_lookup_ok]]);
  assert.equal((await client(f).clientLookup().find('1')).estado, 'inversionista');
  assert.equal(f.calls.length, 2);
  const g = fakeFetch([[500, {}], [500, {}]]);
  await assert.rejects(client(g).clientLookup().find('1'), (e) => e.status === 500);
  assert.equal(g.calls.length, 2);
});

test('timeout: reintenta y luego falla', async () => {
  const f = fakeFetch([() => new Promise(() => {})]);
  await assert.rejects(client(f).clientLookup().find('1'), (e) => e.kind === 'timeout');
  assert.equal(f.calls.length, 2);
});

test('n8n responde {error}: se trata como falla', async () => {
  await assert.rejects(client(fakeFetch([[200, FX.upstream_error]])).clientLookup().find('1'), (e) => e.kind === 'upstream');
});

test('caché corta: misma consulta no vuelve a llamar dentro del TTL', async () => {
  const f = fakeFetch([[200, FX.client_lookup_ok]]);
  const c = client(f).clientLookup();
  await c.find('79378202'); await c.find('79378202');
  assert.equal(f.calls.length, 1);
  const g = fakeFetch([[200, FX.client_lookup_ok]]);
  const d = client(g, { cacheTtlMs: 0 }).clientLookup();
  await d.find('1'); await new Promise((r) => setTimeout(r, 2)); await d.find('1');
  assert.equal(g.calls.length, 2);
});

test('onCall registra cada consulta (para audit_log) sin el cuerpo', async () => {
  const log = [];
  await client(fakeFetch([[200, FX.client_lookup_ok]]), { onCall: (x) => log.push(x) }).clientLookup().find('1');
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, true);
  assert.equal(log[0].path, '/client-lookup');
  assert.ok(!('body' in log[0]));
});

test('integración motor + adaptador remoto caído: Emi no inventa', async () => {
  const c = client(fakeFetch([[503, {}]]));
  const cx = ctx({ adapters: { client: c.clientLookup(), operation: c.operationLookup(), escalation: c.escalationSink() } });
  const { last } = await chat(['hola', '3', '79378202'], cx);
  assert.match(last.replies[0], /No tengo información suficiente/);
  assert.equal(last.debug.origen, 'remoto');
});
