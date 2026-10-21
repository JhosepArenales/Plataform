// Reglas y utilidades compartidas por los backends que corren en el navegador
// (demo con datos simulados y versión con Supabase): validación de cursos,
// niveles e insignias, lectura de archivos y generación en modo básico.
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));
const LESSON_TYPES = new Set(['video', 'reading', 'quiz']);
// areaExists: el backend indica si un id de área es válido.
function normalizeTree(tree, areaExists = () => true) {
  if (!tree?.title?.trim()) throw httpError(400, 'El curso necesita un título.');
  const lessons = (tree.lessons ?? []).map((l, i) => {
    if (!LESSON_TYPES.has(l.type)) throw httpError(400, `Lección ${i + 1}: tipo inválido.`);
    if (!l.title?.trim()) throw httpError(400, `Lección ${i + 1}: falta el título.`);
    const questions = l.type === 'quiz' ? (l.questions ?? []).map((q, j) => {
      const options = (q.options ?? []).map((o) => String(o).trim()).filter(Boolean);
      if (!q.prompt?.trim() || options.length < 2 || options.length > 4) throw httpError(400, `Lección "${l.title}", pregunta ${j + 1}: necesita enunciado y entre 2 y 4 opciones.`);
      const correct = Number(q.correct_index);
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw httpError(400, `Lección "${l.title}", pregunta ${j + 1}: marca la respuesta correcta.`);
      return { prompt: q.prompt.trim(), options, correct_index: correct, explanation: q.explanation ?? '', time_limit_sec: clampInt(Number(q.time_limit_sec) || 20, 5, 120) };
    }) : [];
    return {
      id: l.id || null, type: l.type, title: l.title.trim(), content: l.content ?? '',
      video_url: l.type === 'video' ? (l.video_url || null) : null, duration_min: clampInt(Number(l.duration_min) || 5, 1, 600), questions,
    };
  });
  const rawAreas = Array.isArray(tree.area_ids) ? tree.area_ids : (tree.areas ?? []).map((a) => a.id);
  const area_ids = [...new Set(rawAreas.map(String))];
  if (area_ids.some((id) => !areaExists(id))) throw httpError(400, 'Una de las áreas elegidas no existe.');
  return { title: tree.title.trim(), description: tree.description ?? '', category: tree.category?.trim() || 'General', cover_emoji: tree.cover_emoji || '📘', lessons, area_ids };
}

const XP = { lesson: 10, quizCorrect: 5, quizPerfect: 20, courseCompleted: 50, gamePodium: 30, gamePlayed: 10 };
const LEVELS = [{ min: 0, name: 'Explorador' }, { min: 100, name: 'Aprendiz' }, { min: 300, name: 'Practicante' }, { min: 700, name: 'Experto' }, { min: 1500, name: 'Maestro' }];
function levelFor(xp) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (xp >= l.min) idx = i; });
  return { level: idx + 1, name: LEVELS[idx].name, xp, next_at: LEVELS[idx + 1]?.min ?? null };
}
// Nivel e insignias a partir de los conteos de cada persona (igual en todos los backends).
function statsFrom({ xp, lessons, perfect, courses, games, recent }) {
  return {
    ...levelFor(xp), lessons_done: lessons, courses_done: courses,
    badges: [
      { id: 'first', icon: '🚀', name: 'Primer paso', desc: 'Completa tu primera lección', earned: lessons >= 1 },
      { id: 'ten', icon: '📚', name: 'Constante', desc: 'Completa 10 lecciones', earned: lessons >= 10 },
      { id: 'perfect', icon: '🎯', name: 'Puntería', desc: 'Saca 100% en un quiz', earned: perfect >= 1 },
      { id: 'course', icon: '🏅', name: 'Graduado', desc: 'Termina un curso completo', earned: courses >= 1 },
      { id: 'game', icon: '🎮', name: 'Competidor', desc: 'Juega una partida en vivo', earned: games >= 1 },
    ],
    recent,
  };
}

// ---------- Extracción de texto en el navegador ----------
const SUPPORTED = { '.pdf': 'pdf', '.docx': 'word', '.xlsx': 'excel', '.xls': 'excel', '.csv': 'csv', '.pptx': 'powerpoint', '.txt': 'texto', '.md': 'texto', '.json': 'texto', '.html': 'web', '.htm': 'web' };
const MAX_SOURCE_CHARS = 400000;

async function extractFile(file) {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const kind = SUPPORTED[ext];
  if (!kind) throw httpError(415, `Formato ${ext || 'desconocido'} no soportado. Usa PDF, Word, Excel, PowerPoint o texto.`);
  const buf = await file.arrayBuffer();
  let text;
  if (kind === 'pdf') {
    if (!window.pdfjsLib) throw httpError(415, 'En esta versión publicada los PDF no se leen automáticamente. Abre el PDF, copia el texto y usa "Agregar texto", o súbelo como Word.');
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    text = pages.join('\n\n');
  } else if (ext === '.xls') {
    throw httpError(415, 'El formato .xls antiguo no se puede leer. Guárdalo como .xlsx o .csv y vuelve a subirlo.');
  } else if (kind === 'word' || kind === 'excel' || kind === 'powerpoint') {
    const zip = await readZip(buf).catch(() => { throw httpError(422, `"${file.name}" no parece un archivo de Office válido.`); });
    text = kind === 'word' ? docxText(zip) : kind === 'excel' ? xlsxText(zip) : pptxText(zip);
  } else {
    text = new TextDecoder().decode(buf);
    if (kind === 'web') text = htmlToText(text);
  }
  return finishExtraction(kind, file.name, text);
}

// Office (docx/xlsx/pptx) son ZIP con XML: se leen con la descompresión nativa del
// navegador, sin librerías externas.
async function readZip(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    files[name] = method === 0 ? data : method === 8 ? new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : null;
  }
  return { read: (name) => (files[name] ? utf8.decode(files[name]) : null), names: Object.keys(files) };
}
const xmlTexts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => decodeEntities(m[1]));
const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]);
function docxText(zip) {
  const xml = zip.read('word/document.xml');
  if (!xml) throw httpError(422, 'El documento de Word no tiene contenido legible.');
  return xml.split(/<\/w:p>/).map((par) => xmlTexts(par, 'w:t').join('')).join('\n');
}
function pptxText(zip) {
  return zip.names.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort(byNumber)
    .map((f, i) => `## Diapositiva ${i + 1}\n${xmlTexts(zip.read(f), 'a:t').join(' ')}`).join('\n\n');
}
function xlsxText(zip) {
  const shared = (zip.read('xl/sharedStrings.xml') ?? '').split(/<\/si>/).slice(0, -1).map((si) => xmlTexts(si, 't').join(''));
  const rels = Object.fromEntries([...(zip.read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const sheets = [...(zip.read('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)].map((m, i) => ({
    name: decodeEntities(m[0].match(/name="([^"]*)"/)?.[1] ?? `Hoja ${i + 1}`),
    path: `xl/${(rels[m[0].match(/r:id="([^"]+)"/)?.[1]] ?? `worksheets/sheet${i + 1}.xml`).replace(/^\/?xl\//, '')}`,
  }));
  return sheets.map(({ name, path }) => {
    const rows = (zip.read(path) ?? '').split(/<\/row>/).map((row) => [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, body = '']) => {
      const t = attrs.match(/\bt="([^"]+)"/)?.[1];
      if (t === 'inlineStr') return xmlTexts(body, 't').join('');
      const v = body.match(/<v>([^<]*)<\/v>/)?.[1] ?? '';
      return t === 's' ? shared[Number(v)] ?? '' : decodeEntities(v);
    }).filter(Boolean).join(' | ')).filter(Boolean);
    return `## Hoja: ${name}\n${rows.join('\n')}`;
  }).join('\n\n');
}
function finishExtraction(kind, name, raw) {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  if (text.length < 40) throw httpError(422, `"${name}" no tiene texto suficiente. Si es un PDF escaneado, conviértelo a texto (OCR) primero.`);
  return { kind, name, text: text.slice(0, MAX_SOURCE_CHARS), truncated: text.length > MAX_SOURCE_CHARS };
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function htmlToText(html) {
  return decodeEntities(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
}
// Modo básico sin IA (mismo algoritmo que server/services/ai.js).
function basicCourseFromSources(sources, lessonCount = 6) {
  const fullText = sources.map((s) => s.extracted_text).join('\n\n');
  const sections = splitSections(fullText, lessonCount);
  const vocab = keywords(fullText);
  const lessons = [];
  sections.forEach((sec, i) => {
    lessons.push({ id: null, type: 'reading', title: sec.title, video_url: null, content: `## ${sec.title}\n\n${sec.body}`, duration_min: Math.max(2, Math.round(sec.body.split(/\s+/).length / 180)), questions: [] });
    if ((i + 1) % 2 === 0 || i === sections.length - 1) {
      const qs = clozeQuestions(sections.slice(Math.max(0, i - 1), i + 1).map((s) => s.body).join('\n'), vocab, 3);
      if (qs.length) lessons.push({ id: null, type: 'quiz', title: `Repaso: ${sec.title}`, content: '', video_url: null, duration_min: 3, questions: qs });
    }
  });
  const first = sources[0]?.name?.replace(/\.[a-z0-9]+$/i, '') ?? 'Nuevo curso';
  return { title: `Inducción: ${first}`.slice(0, 120), description: `Curso generado automáticamente a partir de ${sources.length} documento(s). Revísalo antes de publicarlo.`, category: 'Inducción', cover_emoji: '📘', lessons, change_summary: 'Borrador generado en modo básico (sin IA).' };
}
function splitSections(text, target) {
  const headingRe = /^(#{1,3}\s+.+|[A-ZÁÉÍÓÚÑ0-9][^.!?]{2,70}:?|\d+(\.\d+)*[.)]\s+.{3,80})$/;
  const sections = [];
  let current = { title: 'Introducción', body: [] };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (headingRe.test(line) && line.split(/\s+/).length <= 10 && current.body.join(' ').length > 300) { sections.push(current); current = { title: line.replace(/^#+\s*/, '').replace(/:$/, ''), body: [] }; }
    else current.body.push(line);
  }
  sections.push(current);
  let merged = sections.map((s) => ({ title: s.title.slice(0, 80), body: s.body.join('\n') })).filter((s) => s.body.length > 80);
  if (!merged.length) merged = [{ title: 'Contenido', body: text }];
  while (merged.length > target) {
    let idx = 0;
    merged.forEach((s, i) => { if (i < merged.length - 1 && s.body.length + merged[i + 1].body.length < merged[idx].body.length + merged[idx + 1].body.length) idx = i; });
    merged.splice(idx, 2, { title: merged[idx].title, body: `${merged[idx].body}\n\n${merged[idx + 1].body}` });
  }
  return merged.map((s, i) => ({ title: s.title || `Parte ${i + 1}`, body: s.body.slice(0, 6000) }));
}
const STOP = new Set('sobre entre cuando donde desde hasta porque también tienen pueden deben debemos cualquier través durante mediante algunas algunos nuestra nuestro nuestros nuestras siempre ademas además mismo misma otros otras todas todos cada parte forma según hacia tiene puede debe estos estas aquel aquella'.split(' '));
function keywords(text) {
  const freq = new Map();
  for (const w of text.toLowerCase().match(/[a-záéíóúñü]{7,}/g) ?? []) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([w]) => w);
}
function clozeQuestions(text, vocab, n) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 50 && s.length < 260 && /[.!?]$/.test(s));
  const out = [];
  const used = new Set();
  for (const s of sentences) {
    if (out.length >= n) break;
    const words = (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü]{7,}/g) ?? []).filter((w) => vocab.includes(w.toLowerCase()) && !used.has(w.toLowerCase()));
    if (!words.length) continue;
    const answer = words.sort((a, b) => b.length - a.length)[0];
    const distractors = vocab.filter((w) => w !== answer.toLowerCase() && Math.abs(w.length - answer.length) <= 4).slice(out.length * 3, out.length * 3 + 3);
    if (distractors.length < 3) continue;
    used.add(answer.toLowerCase());
    const options = [answer.toLowerCase(), ...distractors];
    const shift = (s.length + out.length) % 4;
    const rotated = options.slice(shift).concat(options.slice(0, shift));
    out.push({ prompt: `Completa la frase: "${s.replace(answer, '_____')}"`, options: rotated, correct_index: rotated.indexOf(answer.toLowerCase()), explanation: `La frase original dice: "${s}"`, time_limit_sec: 20 });
  }
  return out;
}
