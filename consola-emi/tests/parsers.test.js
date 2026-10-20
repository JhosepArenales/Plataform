const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require(path.join(__dirname, '..', 'js', 'lib', 'parsers.js'));

test('CSV con ";" y comillas', () => {
  const csv = 'Pregunta;Respuesta;Categoría;Palabras clave\n"¿Qué es X?";"Es ""algo"";\nde varias líneas";Otro;x, equis\n';
  const r = P.csvToFaqs(csv);
  assert.equal(r.faqs.length, 1);
  assert.equal(r.faqs[0].respuesta, 'Es "algo";\nde varias líneas');
  assert.equal(r.faqs[0].keywords, 'x, equis');
});

test('CSV: categoría desconocida cae en Otro y filas incompletas se reportan', () => {
  const r = P.csvToFaqs('pregunta,respuesta,categoria\n¿A?,B,Inventada\n¿C?,,Otro\n');
  assert.equal(r.faqs[0].categoria, 'Otro');
  assert.equal(r.errors.length, 1);
});

test('CSV: acepta categoría sin tilde', () => {
  assert.equal(P.matchCategoria('producto e inversion'), 'Producto e inversión');
});

test('TXT: pares P:/R: y preguntas con "?"', () => {
  const r = P.textToFaqs('P: ¿Hola?\nR: Respuesta uno\n\n¿Cómo pago?\nCon PSE.\nO con FIC.');
  assert.equal(r.faqs.length, 2);
  assert.equal(r.faqs[1].respuesta, 'Con PSE. O con FIC.');
});

test('DOCX XML → texto', () => {
  const xml = '<w:body><w:p><w:r><w:t>¿Qué es</w:t></w:r><w:r><w:t xml:space="preserve"> un FIC?</w:t></w:r></w:p><w:p><w:r><w:t>Un fondo &amp; más</w:t></w:r></w:p></w:body>';
  assert.equal(P.docxXmlToText(xml), '¿Qué es un FIC?\nUn fondo & más');
});

test('XLSX XML → filas → FAQs', () => {
  const shared = '<sst><si><t>Pregunta</t></si><si><t>Respuesta</t></si><si><t>¿A?</t></si><si><t>B</t></si></sst>';
  const sheet = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData>';
  const r = P.rowsToFaqs(P.xlsxToRows(shared, sheet));
  assert.deepEqual(r.faqs.map((f) => [f.pregunta, f.respuesta]), [['¿A?', 'B']]);
});

test('ZIP real (deflate) se lee con DecompressionStream', async () => {
  const zlib = require('zlib');
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from('<w:p><w:t>Hola</w:t></w:p>');
  const comp = zlib.deflateRawSync(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, name, comp]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(body.length, 16);
  const zip = Buffer.concat([body, cd, name, eocd]);
  const files = await P.readZip(zip);
  assert.equal(new TextDecoder().decode(files['word/document.xml']), '<w:p><w:t>Hola</w:t></w:p>');
});

test('exportar → validar importación (ida y vuelta)', () => {
  const exp = P.buildExport({ config: { threshold: 0.35, horario: { inicio: '08:00', fin: '18:00', dias: [1] } }, faqs: [{ pregunta: '¿A?', respuesta: 'B', categoria: 'Otro' }], holidays: [{ fecha: '2026-12-25', nombre: 'Navidad' }] });
  const v = P.validateImport(JSON.parse(JSON.stringify(exp)));
  assert.equal(v.ok, true, v.errors.join('; '));
});

test('importación inválida da errores legibles', () => {
  const v = P.validateImport({ schema: 'otro', version: 9, config: { threshold: 3 }, faqs: [{ pregunta: '', categoria: 'X' }], holidays: [{ fecha: '25/12' }] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 5);
});
