// Servidor local de desarrollo: inyecta el secreto del lado del servidor y solo deja pasar los webhooks de Emi.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { createServer } = require(path.join(__dirname, '..', 'tools', 'dev-server.js'));

function listen(srv) { return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port))); }

test('dev-server: proxy a n8n con secreto, filtro de rutas y archivos estáticos', async (t) => {
  const seen = [];
  const fakeN8n = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push({ url: req.url, secret: req.headers['x-emi-secret'], body: b });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"estado":"no_encontrado"}');
    });
  });
  const n8nPort = await listen(fakeN8n);
  const dev = createServer({ root: path.join(__dirname, '..'), n8nUrl: 'http://127.0.0.1:' + n8nPort, secret: 's3cr3t' });
  const port = await listen(dev);
  t.after(() => { fakeN8n.close(); dev.close(); });
  const base = 'http://127.0.0.1:' + port;

  const r = await fetch(base + '/api/proxy/emi-n8n/webhook/emi/client-lookup', { method: 'POST', body: '{"documento":"1"}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { estado: 'no_encontrado' });
  assert.deepEqual(seen[0], { url: '/webhook/emi/client-lookup', secret: 's3cr3t', body: '{"documento":"1"}' });

  assert.equal((await fetch(base + '/api/proxy/emi-n8n/rest/workflows', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/proxy/emi-n8n/webhook/emi/client-lookup')).status, 405);
  assert.equal((await fetch(base + '/api/db/config')).status, 404);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.ok(!(await html.text()).includes('s3cr3t'));
  assert.equal((await fetch(base + '/tools/dev-server.js')).status, 403);
  assert.notEqual((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status, 200);
  assert.equal(seen.length, 1);
});

test('dev-server: n8n caído → 502 n8n_inalcanzable', async (t) => {
  const dev = createServer({ root: path.join(__dirname, '..'), n8nUrl: 'http://127.0.0.1:1', secret: 'x', timeoutMs: 2000 });
  const port = await listen(dev);
  t.after(() => dev.close());
  const r = await fetch('http://127.0.0.1:' + port + '/api/proxy/emi-n8n/webhook/emi/escalate', { method: 'POST', body: '{}' });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, 'n8n_inalcanzable');
});
