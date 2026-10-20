// Extracción de texto desde cualquier fuente: PDF, Word, Excel/CSV, PowerPoint,
// texto plano/Markdown, páginas web. Devuelve texto limpio listo para la IA.
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

export const MAX_SOURCE_CHARS = 400_000;

export const SUPPORTED = {
  '.pdf': 'pdf', '.docx': 'word', '.xlsx': 'excel', '.csv': 'csv', '.pptx': 'powerpoint',
  '.txt': 'texto', '.md': 'texto', '.json': 'texto', '.html': 'web', '.htm': 'web',
};

export async function extractFromFile({ buffer, filename }) {
  const ext = path.extname(filename).toLowerCase();
  const kind = SUPPORTED[ext];
  if (!kind) {
    throw Object.assign(new Error(`Formato ${ext || 'desconocido'} no soportado. Usa: ${Object.keys(SUPPORTED).join(', ')}`), { status: 415 });
  }
  let text;
  switch (kind) {
    case 'pdf': text = await pdfText(buffer); break;
    case 'word': text = (await mammoth.extractRawText({ buffer })).value; break;
    case 'excel': text = await excelText(buffer); break;
    case 'csv': text = buffer.toString('utf8'); break;
    case 'powerpoint': text = await pptxText(buffer); break;
    case 'web': text = htmlToText(buffer.toString('utf8')); break;
    default: text = buffer.toString('utf8');
  }
  return finish(kind, filename, text);
}

export async function extractFromUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error('La URL no es válida.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error('Solo se aceptan URLs http(s).'), { status: 400 });
  await assertPublicHost(parsed.hostname);
  // Sin seguir redirecciones automáticamente: un redirect podría apuntar a la red interna.
  const res = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status >= 300 && res.status < 400) {
    throw Object.assign(new Error(`La página redirige a ${res.headers.get('location')}. Pega esa URL directamente.`), { status: 400 });
  }
  if (!res.ok) throw Object.assign(new Error(`No se pudo leer la página (HTTP ${res.status}).`), { status: 502 });
  const type = res.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (type.includes('pdf')) return finish('pdf', parsed.href, await pdfText(buffer));
  const text = type.includes('html') ? htmlToText(buffer.toString('utf8')) : buffer.toString('utf8');
  return finish('web', parsed.href, text);
}

// Evita que la función de "leer URL" se use para consultar servicios internos (SSRF).
async function assertPublicHost(hostname) {
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addresses.length) throw Object.assign(new Error('No se encontró ese dominio.'), { status: 400 });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw Object.assign(new Error('Solo se pueden leer páginas públicas de internet.'), { status: 400 });
  }
}

export function isPrivateAddress(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function extractFromText(name, text) {
  return finish('texto', name || 'Texto pegado', text);
}

function finish(kind, name, raw) {
  const text = normalizeWhitespace(raw);
  if (text.length < 40) {
    throw Object.assign(new Error(`"${name}" no tiene texto suficiente. Si es un PDF escaneado, conviértelo a texto (OCR) primero.`), { status: 422 });
  }
  return { kind, name, text: text.slice(0, MAX_SOURCE_CHARS), truncated: text.length > MAX_SOURCE_CHARS };
}

async function pdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}

async function excelText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  wb.eachSheet((sheet) => {
    parts.push(`## Hoja: ${sheet.name}`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map(cellText);
      if (cells.some((c) => c !== '')) parts.push(cells.join(' | '));
    });
  });
  return parts.join('\n');
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

async function pptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const [i, f] of slides.entries()) {
    const xml = await zip.file(f).async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1]));
    parts.push(`## Diapositiva ${i + 1}\n${texts.join(' ')}`);
  }
  return parts.join('\n\n');
}

export function htmlToText(html) {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function normalizeWhitespace(s) {
  return s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
