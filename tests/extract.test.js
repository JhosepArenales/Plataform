import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromFile, htmlToText, isPrivateAddress } from '../server/services/extract.js';
import { makeDocx, makePptx, makeXlsx, makePdf, LONG_TEXT } from './helpers.js';

test('Word (.docx)', async () => {
  const r = await extractFromFile({ buffer: await makeDocx(LONG_TEXT), filename: 'Manual ñandú.docx' });
  assert.equal(r.kind, 'word');
  assert.match(r.text, /quince días hábiles/);
});

test('Excel (.xlsx) conserva hojas y columnas', async () => {
  const buf = await makeXlsx([['Paso', 'Responsable', 'Plazo'], ['Registrar solicitud', 'Mesa de ayuda', '1 día'], ['Aprobar', 'Supervisor', '5 días']]);
  const r = await extractFromFile({ buffer: buf, filename: 'procesos.xlsx' });
  assert.equal(r.kind, 'excel');
  assert.match(r.text, /Hoja: Procesos/);
  assert.match(r.text, /Registrar solicitud \| Mesa de ayuda \| 1 día/);
});

test('PowerPoint (.pptx) en orden de diapositivas', async () => {
  const r = await extractFromFile({ buffer: await makePptx(['Bienvenida a la empresa y al equipo', 'Nuestros valores &amp; cultura de servicio', 'Tercera diapositiva']), filename: 'deck.pptx' });
  assert.match(r.text, /Diapositiva 1\nBienvenida/);
  assert.match(r.text, /valores & cultura/);
  assert.ok(r.text.indexOf('Diapositiva 2') < r.text.indexOf('Diapositiva 3'));
});

test('PDF', async () => {
  const r = await extractFromFile({ buffer: makePdf('Politica de seguridad de la informacion para colaboradores nuevos'), filename: 'politica.pdf' });
  assert.equal(r.kind, 'pdf');
  assert.match(r.text, /Politica de seguridad/);
});

test('CSV, texto y HTML', async () => {
  assert.match((await extractFromFile({ buffer: Buffer.from('a,b\n1,2\n'.repeat(10)), filename: 'd.csv' })).text, /a,b/);
  const html = htmlToText('<p>Hola</p><script>alert(1)</script><p>mundo &amp; más</p>');
  assert.match(html, /Hola/);
  assert.match(html, /mundo & más/);
  assert.doesNotMatch(html, /alert/);
});

test('rechaza formatos no soportados y documentos vacíos', async () => {
  await assert.rejects(extractFromFile({ buffer: Buffer.from('x'), filename: 'a.exe' }), /no soportado/);
  await assert.rejects(extractFromFile({ buffer: Buffer.from('corto'), filename: 'a.txt' }), /texto suficiente/);
});

test('detección de direcciones privadas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});
