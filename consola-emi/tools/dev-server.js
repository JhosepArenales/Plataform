#!/usr/bin/env node
/* Servidor local para probar la consola contra n8n ANTES de publicar.
 * Hace lo mismo que el proxy del Deployer: reenvía /api/proxy/emi-n8n/* a n8n agregando
 * X-Emi-Secret del lado del servidor (el secreto nunca llega al navegador).
 *
 * Uso:  N8N_URL=https://n8n.tu-dominio.com EMI_SECRET=xxxx node tools/dev-server.js
 *       y abre http://localhost:8765
 * Solo para desarrollo: no se publica con la consola. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PREFIX = '/api/proxy/emi-n8n/';

function createServer(opts) {
  const root = path.resolve(opts.root);
  const base = String(opts.n8nUrl || '').replace(/\/+$/, '');
  const log = opts.log || (() => {});

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith(PREFIX)) {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      if (!base || !opts.secret) {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'dev_server_sin_configurar', detalle: 'Define N8N_URL y EMI_SECRET' }));
        return;
      }
      const rest = url.pathname.slice(PREFIX.length);
      // Solo los webhooks de Emi: el proxy no sirve para llamar otra cosa en n8n.
      if (!/^webhook(-test)?\/emi\/[a-z-]+$/.test(rest)) { res.writeHead(403).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const started = Date.now();
      try {
        const r = await fetch(base + '/' + rest, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Emi-Secret': opts.secret },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(opts.timeoutMs || 20000)
        });
        const body = Buffer.from(await r.arrayBuffer());
        log(`n8n ${rest} → ${r.status} (${Date.now() - started} ms)`);
        res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }).end(body);
      } catch (e) {
        log(`n8n ${rest} → error ${e.name}: ${e.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'n8n_inalcanzable', detalle: e.name }));
      }
      return;
    }

    // Sin /api/db en local: la consola usa su modo local (datos en el navegador).
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }

    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || /[\\/](tests|tools|n8n|deploy|\.git)[\\/]/.test(file.slice(root.length))) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = +process.env.PORT || 8765;
  const n8nUrl = process.env.N8N_URL, secret = process.env.EMI_SECRET;
  if (!n8nUrl || !secret) console.warn('⚠  Falta N8N_URL o EMI_SECRET: el modo Remoto responderá error.');
  createServer({ root: path.join(__dirname, '..'), n8nUrl, secret, log: (m) => console.log(new Date().toLocaleTimeString('es-CO'), m) })
    .listen(port, '127.0.0.1', () => console.log(`Consola de Emi en http://localhost:${port}  ·  n8n: ${n8nUrl || '(sin configurar)'}`));
}
