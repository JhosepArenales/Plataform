// Flujos de n8n: se ejecuta el JSON generado (el mismo que se importa) con Metabase/HubSpot simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { buildAll } = require(path.join(__dirname, '..', 'n8n', 'build.js'));
const { runWorkflow } = require('./n8n-sim.js');
const DEFAULT_CFG = require(path.join(__dirname, '..', 'n8n', 'src', 'config.js'));
const MB = require('./fixtures/metabase.json');
const HS = require('./fixtures/hubspot.json');

// Configuración de prueba con las columnas de los fixtures (las reales están POR_DEFINIR).
const CFG = JSON.parse(JSON.stringify(DEFAULT_CFG));
Object.assign(CFG.clientes, {
  columnaDocumento: 'Documento', columnaNombre: 'Nombre', columnaEmail: 'Email',
  reglas: [
    { estado: 'mora', columna: 'En mora', op: 'truthy' },
    { estado: 'inversionista+contratos_pendientes', columna: 'Contratos pendientes', op: 'truthy' },
    { estado: 'inversionista', columna: 'Inversiones', op: 'gt', valor: 0 }
  ]
});
Object.assign(CFG.operaciones, { columnaNumero: 'Operación', columnaNit: 'NIT pagador', columnaRazonSocial: 'Pagador', columnaEstado: 'Estado', columnaFechaPago: 'Fecha pago' });
Object.assign(CFG.hubspot, { ticketPipeline: '0', ticketEtapa: '1' });
const WF = buildAll(CFG);

function httpMock(routes) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    for (const [re, handler] of routes) if (re.test(req.url)) return typeof handler === 'function' ? handler(req) : JSON.parse(JSON.stringify(handler));
    throw Object.assign(new Error('sin ruta ' + req.url), { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
const fail = (status) => () => { throw Object.assign(new Error('HTTP ' + status), { status }); };

// ── client-lookup ──
const clientRoutes = [[/\/api\/card\/2346\/query$/, MB.clientes], [/contacts\/search$/, HS.contact]];
for (const [doc, estado] of [['79378202', 'inversionista'], ['1032416400', 'inversionista+contratos_pendientes'], ['79491944', 'mora'], ['900876543-1', 'prospecto'], ['11111111', 'no_encontrado']]) {
  test('client-lookup: ' + doc + ' → ' + estado, async () => {
    const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: doc }, http: httpMock(clientRoutes) });
    assert.equal(response.estado, estado);
  });
}

test('client-lookup: nombre, ref enmascarada y contacto de HubSpot', async () => {
  const http = httpMock(clientRoutes);
  const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: '79378202' }, http });
  assert.deepEqual(response, { estado: 'inversionista', nombre: 'Carlos', ref_masked: 'CC ***378202', hubspot_id: '555' });
  assert.equal(http.calls[0].url, 'https://bi.mesfix.com/api/card/2346/query');
  assert.equal(http.calls[1].body.filterGroups[0].filters[0].value, 'carlos@example.com');
});

test('client-lookup: sin email no consulta HubSpot', async () => {
  const http = httpMock(clientRoutes);
  const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: '79491944' }, http });
  assert.equal(http.calls.length, 1);
  assert.equal(response.hubspot_id, undefined);
});

test('client-lookup: si falla la búsqueda en HubSpot, igual responde el estado', async () => {
  const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: '79378202' }, http: httpMock([clientRoutes[0], [/contacts/, fail(500)]]) });
  assert.equal(response.estado, 'inversionista');
});

test('client-lookup: Metabase caído → upstream_unavailable', async () => {
  const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: '79378202' }, http: httpMock([[/card/, fail(503)]]) });
  assert.equal(response.error, 'upstream_unavailable');
});

test('client-lookup: documento inválido → bad_request sin llamar a Metabase', async () => {
  const http = httpMock(clientRoutes);
  const { response } = await runWorkflow(WF['emi-client-lookup'], { body: { documento: 'abc' }, http });
  assert.equal(response.error, 'bad_request');
  assert.equal(http.calls.length, 0);
});

test('client-lookup: con la configuración real (POR_DEFINIR) no opera', async () => {
  const http = httpMock(clientRoutes);
  const { response } = await runWorkflow(buildAll(DEFAULT_CFG)['emi-client-lookup'], { body: { documento: '79378202' }, http });
  assert.equal(response.error, 'not_configured');
  assert.ok(response.faltan.includes('clientes.columnaDocumento'));
  assert.equal(http.calls.length, 0);
});

test('client-lookup: con parámetro de Metabase configurado, filtra en Metabase', async () => {
  const cfg = JSON.parse(JSON.stringify(CFG)); cfg.metabase.parametroDocumento = 'documento';
  const http = httpMock(clientRoutes);
  await runWorkflow(buildAll(cfg)['emi-client-lookup'], { body: { documento: '79378202' }, http });
  assert.deepEqual(http.calls[0].body.parameters[0].target, ['variable', ['template-tag', 'documento']]);
  assert.equal(http.calls[0].body.parameters[0].value, '79378202');
});

// ── operation-lookup ──
const opRoutes = [[/\/api\/card\/3794\/query$/, MB.operaciones], [/emails\/search$/, HS.emails]];

test('operation-lookup: al día no consulta correos', async () => {
  const http = httpMock(opRoutes);
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '7981', empresa: 'Constructora Demo Andina' }, http });
  assert.equal(response.estado_cobro, 'al_dia');
  assert.equal(response.fecha_pago_estimada, '2026-11-30');
  assert.equal(http.calls.length, 1);
});

test('operation-lookup: prejurídico → último correo de ESA operación, resumido y enmascarado', async () => {
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '6543', empresa: '900333444' }, http: httpMock(opRoutes) });
  assert.equal(response.estado_cobro, 'prejuridico');
  assert.equal(response.empresa.nit, '900333444');
  const u = response.ultima_comunicacion;
  assert.equal(u.fecha, '2026-10-08', 'ignora el correo de otro remitente y el de la operación 13058');
  assert.match(u.resumen, /acuerdo de pago/);
  assert.ok(!u.resumen.includes('1032416400'), 'documento enmascarado');
  assert.ok(!/texto viejo|escribió/.test(u.resumen), 'sin citas de respuestas anteriores');
});

test('operation-lookup: jurídico', async () => {
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '13058', empresa: 'Logística Ficticia' }, http: httpMock(opRoutes) });
  assert.equal(response.estado_cobro, 'juridico');
  assert.equal(response.ultima_comunicacion.fecha, '2026-10-14');
});

test('operation-lookup: empresa que no coincide → found:false (no revela estado)', async () => {
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '6543', empresa: 'Constructora Demo' }, http: httpMock(opRoutes) });
  assert.deepEqual(response, { found: false });
});

test('operation-lookup: estado desconocido en Metabase → error, no se adivina', async () => {
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '5000', empresa: 'Rara' }, http: httpMock(opRoutes) });
  assert.equal(response.error, 'unknown_state');
});

test('operation-lookup: HubSpot caído en un caso en cobro → error (no afirma "sin comunicaciones")', async () => {
  const { response } = await runWorkflow(WF['emi-operation-lookup'], { body: { numero_operacion: '6543', empresa: '900333444' }, http: httpMock([opRoutes[0], [/emails/, fail(429)]]) });
  assert.equal(response.error, 'upstream_unavailable');
});

// ── escalate ──
const payload = { conversation_id: 'consola-12', motivo: 'reclamo', intencion: 'reclamo', confianza: null, fuera_horario: true,
  cliente: { estado: 'inversionista', ref: 'CC ***416400', id: '555' }, resumen: 'Usuario: me robaron, mi cédula 1032416400\nEmi: Lamento…' };

test('escalate: crea el ticket con pipeline, etapa, prioridad, asociación y marca de fuera de horario', async () => {
  const http = httpMock([[/tickets\/search$/, HS.ticket_none], [/tickets$/, HS.ticket_created]]);
  const { response } = await runWorkflow(WF['emi-escalate'], { body: payload, http });
  assert.deepEqual(response, { ticket_id: '1234', status: 'created' });
  const t = http.calls[1].body;
  assert.equal(t.properties.hs_pipeline, '0');
  assert.equal(t.properties.hs_pipeline_stage, '1');
  assert.equal(t.properties.hs_ticket_priority, 'HIGH');
  assert.equal(t.properties.emi_conversation_id, 'consola-12');
  assert.match(t.properties.content, /FUERA DE HORARIO/);
  assert.ok(!t.properties.content.includes('1032416400'));
  assert.deepEqual(t.associations[0], { to: { id: '555' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] });
  assert.equal(http.calls[0].body.filterGroups[0].filters[0].value, 'consola-12');
});

test('escalate: si ya existe ticket para la conversación, no crea otro', async () => {
  const http = httpMock([[/tickets\/search$/, HS.ticket_existing], [/tickets$/, HS.ticket_created]]);
  const { response } = await runWorkflow(WF['emi-escalate'], { body: payload, http });
  assert.deepEqual(response, { ticket_id: '987', status: 'existing' });
  assert.equal(http.calls.length, 1);
});

test('escalate: falla HubSpot → upstream_unavailable', async () => {
  const { response } = await runWorkflow(WF['emi-escalate'], { body: payload, http: httpMock([[/search/, HS.ticket_none], [/tickets$/, fail(500)]]) });
  assert.equal(response.error, 'upstream_unavailable');
});

test('escalate: sin pipeline configurado no crea nada', async () => {
  const http = httpMock([[/./, HS.ticket_none]]);
  const { response } = await runWorkflow(buildAll(DEFAULT_CFG)['emi-escalate'], { body: payload, http });
  assert.equal(response.error, 'not_configured');
  assert.equal(http.calls.length, 0);
});

// ── Estructura e higiene ──
test('los workflows en el repositorio están al día con build.js', () => {
  for (const [name, wf] of Object.entries(buildAll(DEFAULT_CFG))) {
    const disk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', name + '.json'), 'utf8'));
    assert.deepEqual(disk, JSON.parse(JSON.stringify(wf)), name + '.json desactualizado: corre node n8n/build.js');
  }
});

test('webhooks con autenticación por cabecera, sin secretos ni ejecuciones exitosas guardadas', () => {
  for (const wf of Object.values(buildAll(DEFAULT_CFG))) {
    const hook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    assert.equal(hook.parameters.authentication, 'headerAuth');
    assert.equal(hook.parameters.responseMode, 'responseNode');
    assert.equal(wf.settings.saveDataSuccessExecution, 'none');
    const src = JSON.stringify(wf);
    assert.ok(!/pat-(na|eu)\d-|Bearer [A-Za-z0-9]{20}|mb_[A-Za-z0-9]{20}/.test(src));
    for (const n of wf.nodes.filter((x) => x.credentials)) for (const c of Object.values(n.credentials)) assert.equal(c.id, '', 'credencial sin id: se elige al importar');
  }
});

test('todas las conexiones apuntan a nodos existentes', () => {
  for (const wf of Object.values(WF)) {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, c] of Object.entries(wf.connections)) {
      assert.ok(names.has(from));
      c.main.flat().forEach((x) => assert.ok(names.has(x.node), x.node));
    }
  }
});
