const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require(path.join(__dirname, '..', 'n8n', 'src', 'lib.js'))();

test('metabaseRows: formato /query y /query/json, claves normalizadas', () => {
  const a = L.metabaseRows({ data: { cols: [{ name: 'doc', display_name: 'Número Documento' }], rows: [['1']] } });
  assert.equal(a[0].numero_documento, '1');
  assert.equal(a[0].doc, '1');
  const b = L.metabaseRows([{ 'Número Documento': '2' }]);
  assert.equal(b[0].numero_documento, '2');
});

test('matchEmpresa: NIT con o sin DV, nombre parcial sin sufijo societario', () => {
  assert.ok(L.matchEmpresa('900333444-1', '900333444', 'X'));
  assert.ok(L.matchEmpresa('logistica ficticia', '1', 'Logística Ficticia del Caribe S.A.S.'));
  assert.ok(!L.matchEmpresa('SAS', '1', 'Logística Ficticia SAS'));
  assert.ok(!L.matchEmpresa('900333445', '900333444', 'X'));
});

test('summarize: corta en palabra y agrega …', () => {
  const s = L.summarize('palabra '.repeat(80), 50);
  assert.ok(s.length <= 51);
  assert.ok(s.endsWith('…'));
});

test('missingConfig detecta POR_DEFINIR anidados', () => {
  assert.deepEqual(L.missingConfig({ x: { a: 'POR_DEFINIR', b: [{ c: 'POR_DEFINIR' }] } }, 'x'), ['x.a', 'x.b.0.c']);
});

test('isHttpError', () => {
  assert.ok(L.isHttpError({ error: { message: 'x' } }));
  assert.ok(!L.isHttpError({ results: [] }));
  assert.ok(!L.isHttpError({ data: { rows: [] } }));
});

test('ticketCreateBody sin cliente no asocia y con owner lo asigna', () => {
  const b = L.ticketCreateBody({ conversation_id: 'c', motivo: 'baja_confianza' }, { hubspot: { ticketPipeline: '0', ticketEtapa: '1', ticketOwnerId: 77, propiedadConversacion: 'emi_conversation_id' } });
  assert.equal(b.associations, undefined);
  assert.equal(b.properties.hubspot_owner_id, '77');
  assert.equal(b.properties.hs_ticket_priority, 'MEDIUM');
  assert.match(b.properties.subject, /Emi no supo responder/);
});
