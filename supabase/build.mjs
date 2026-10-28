// Empaqueta la Academia con Supabase como base de datos en un único index.html
// para publicar en Netlify (u otro hosting estático): `npm run build:supabase`.
// Salida: supabase/dist/index.html y supabase/dist/academia-supabase.zip
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const outDir = path.join(ROOT, 'supabase', 'dist');

const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
];
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Convierte un módulo ES en código de script: sin import/export.
function unmodule(src, renames = {}) {
  let s = src.replace(/^import\s.*?from\s+['"].*?['"];?\s*$/gm, '').replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
  for (const [from, to] of Object.entries(renames)) {
    if (!s.includes(from)) throw new Error(`No se encontró "${from}" para renombrar`);
    s = s.replace(from, to);
  }
  return s;
}

const scripts = [
  ['supabase/config.js', {}],
  ['demo/lib/content.js', {}],
  ['supabase/backend.js', {}],
  ['public/js/ui.js', {}],
  ['public/js/api.js', { 'function uploadWithProgress(': 'function uploadWithProgressReal(' }],
  ['public/js/views/learner.js', { 'function renderLogin(': 'function renderLoginBase(' }],
  ['public/js/views/game.js', {}],
  ['public/js/views/admin.js', {}],
  ['supabase/ui.js', {}],
  ['supabase/ia.js', {}],
  ['public/js/app.js', {}],
].map(([file, renames]) => `// ---- ${file} ----\n${unmodule(read(file), renames)}`).join('\n\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#9900FF">
<title>Academia Plataform</title>
<style>
${read('public/css/app.css')}
${read('supabase/ia.css')}
</style>
${LIBS.map((u) => `<script src="${u}"></script>`).join('\n')}
<script>if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDF_WORKER}';</script>
</head>
<body>
<header id="nav" class="topbar"></header>
<main id="main" tabindex="-1"></main>
<script>
(() => {
if (!window.supabase) {
  document.getElementById('main').innerHTML = '<div class="card empty-state"><h2>No se pudo cargar la Academia</h2><p>Revisa tu conexión a internet y recarga la página.</p></div>';
  return;
}
${scripts}
})();
</script>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
const zip = path.join(outDir, 'academia-supabase.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-q', '-j', zip, path.join(outDir, 'index.html')]);
console.log(`Academia con Supabase: ${path.join(outDir, 'index.html')} (${Math.round(html.length / 1024)} KB) → ${zip}`);
