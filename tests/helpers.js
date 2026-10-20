import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { createApp } from '../server/app.js';

// Las pruebas nunca llaman a la API real de IA (costo y no determinismo).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

export async function startServer(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'academia-test-'));
  const { app, close } = createApp({ dataDir, dbFile: ':memory:', ...options });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (pathname, { token, method = 'GET', body, form } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  const login = async (email, name) => (await call('/api/auth/login', { method: 'POST', body: { email, name } })).data;
  return {
    base, call, login,
    stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export const LONG_TEXT = `Manual de bienvenida

Nuestra empresa atiende clientes en todo el país. La atención al cliente es prioritaria y cada solicitud debe responderse dentro de veinticuatro horas hábiles. Todo colaborador registra las solicitudes en el sistema de seguimiento para mantener trazabilidad completa.

Política de vacaciones:
Cada colaborador dispone de quince días hábiles de vacaciones anuales. Las solicitudes deben enviarse con anticipación mínima de quince días mediante el formulario oficial. La aprobación corresponde al supervisor inmediato, quien responde en un plazo máximo de cinco días.

Seguridad de la información:
Las contraseñas son personales e intransferibles. Ningún colaborador comparte credenciales por correo electrónico. Los incidentes de seguridad se reportan inmediatamente al equipo de tecnología mediante el canal oficial de soporte. La información confidencial nunca se almacena en dispositivos personales.

Gastos y reembolsos:
Los reembolsos requieren comprobantes originales escaneados. El colaborador presenta la rendición mensual antes del quinto día hábil. Finanzas procesa los reembolsos aprobados en la siguiente quincena del calendario contable.`;

export function sampleCourse() {
  return {
    title: 'Bienvenida', description: 'Primeros pasos', category: 'Inducción', cover_emoji: '👋',
    lessons: [
      { type: 'video', title: 'Mensaje del CEO', video_url: 'https://youtu.be/dQw4w9WgXcQ', duration_min: 3, content: '' },
      { type: 'reading', title: 'Nuestra cultura', content: '## Valores\n- Cliente primero', duration_min: 4 },
      { type: 'quiz', title: 'Repaso', questions: [
        { prompt: '¿Quién va primero?', options: ['El cliente', 'El jefe', 'Nadie', 'Yo'], correct_index: 0, explanation: 'Valor central.' },
        { prompt: '¿Plazo de respuesta?', options: ['24 horas', '1 semana'], correct_index: 0, explanation: '' },
      ] },
    ],
  };
}

export async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paras = text.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function makePptx(slides) {
  const zip = new JSZip();
  slides.forEach((t, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:a="a" xmlns:p="p"><a:t>${t}</a:t></p:sld>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function makeXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Procesos');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// PDF mínimo válido con una línea de texto (offsets de xref calculados).
export function makePdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
