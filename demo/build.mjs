// Empaqueta la interfaz real (public/) con el backend simulado (demo/) en un
// único HTML que funciona sin servidor: `npm run build:demo [salida.html]`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'demo', 'dist', 'academia-demo.html'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Librerías de lectura de archivos (mismas versiones probadas).
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

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
  ['demo/mock-backend.js', {}],
  ['public/js/ui.js', { 'function videoEmbed(': 'function videoEmbedReal(' }],
  ['public/js/api.js', { 'function uploadWithProgress(': 'function uploadWithProgressReal(' }],
  ['public/js/views/learner.js', {}],
  ['public/js/views/game.js', { 'function renderHost(': 'function renderHostBase(' }],
  ['public/js/views/admin.js', {}],
  ['demo/demo-ui.js', {}],
  ['public/js/app.js', {}],
].map(([file, renames]) => `// ---- ${file} ----\n${unmodule(read(file), renames)}`).join('\n\n');

const html = `<title>Demo Academia Plataform</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<style>
${read('public/css/app.css')}
${read('demo/demo.css')}
</style>
${CDN.map((u) => `<script src="${u}"></script>`).join('\n')}
<script>if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '${CDN[1]}';</script>
<header id="nav" class="topbar"></header>
<main id="main" tabindex="-1"></main>
<script>
(() => {
${scripts}
})();
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Demo generada: ${out} (${Math.round(html.length / 1024)} KB)`);
