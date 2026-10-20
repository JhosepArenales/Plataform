// Seguridad: ningún archivo que llega al navegador contiene secretos ni llama a HubSpot/Metabase directo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (['tests', 'node_modules', '.git', 'n8n', 'deploy'].includes(d.name)) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  }).filter((p) => /\.(html|js|css|json)$/.test(p));
}
const FILES = walk(ROOT);

test('hay archivos de frontend para revisar', () => assert.ok(FILES.length >= 8));

test('sin tokens ni claves en el frontend', () => {
  const patterns = [/pat-(na|eu)\d-[0-9a-f-]{20,}/i, /Bearer\s+[A-Za-z0-9._-]{20,}/, /mb_[A-Za-z0-9+/=]{20,}/, /HUBSPOT_PRIVATE_APP_TOKEN\s*[:=]\s*['"][^'"]+/, /x-api-key['"]?\s*:\s*['"][^'"]{10,}/i];
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of patterns) assert.ok(!re.test(src), path.relative(ROOT, f) + ' contiene ' + re);
  }
});

test('el frontend no llama a HubSpot ni a Metabase directamente', () => {
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/api\.hubapi\.com/.test(src), path.relative(ROOT, f));
    assert.ok(!/bi\.mesfix\.com\/api/.test(src), path.relative(ROOT, f));
  }
});

test('las llamadas remotas pasan por el proxy del Deployer', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'adapters', 'remote.js'), 'utf8');
  assert.match(src, /\/api\/proxy\/emi-n8n/);
});

test('la plantilla de credenciales no trae secretos reales', () => {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy', 'credentials.template.json'), 'utf8'));
  for (const v of t.variables) assert.equal(v.value, '', v.key + ' debe ir vacío en el repositorio');
  for (const c of t.connections) assert.match(c.authValue, /^\$\{[A-Z0-9_]+\}$/);
});
