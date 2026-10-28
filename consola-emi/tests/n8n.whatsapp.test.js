// Canal WhatsApp (Evolution API → n8n → Emi → Evolution + histórico en HubSpot).
// Se ejecuta el JSON real del flujo; el motor llama a los flujos emi/* también simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildAll } = require(path.join(__dirname, '..', 'n8n', 'build.js'));
const { runWorkflow } = require('./n8n-sim.js');
const WA = require(path.join(__dirname, '..', 'n8n', 'src', 'wa.js'))();
const DEFAULT_CFG = require(path.join(__dirname, '..', 'n8n', 'src', 'config.js'));
const EVO = require('./fixtures/evolution.json');
const MB = require('./fixtures/metabase.json');
const HS = require('./fixtures/hubspot.json');

const CFG = JSON.parse(JSON.stringify(DEFAULT_CFG));
Object.assign(CFG.whatsapp, { evolutionUrl: 'https://evo.test', webhookToken: 'tok123', emiSecret: 's3cr3t' });
Object.assign(CFG.clientes, { columnaDocumento: 'Documento', columnaNombre: 'Nombre', columnaEmail: 'Email', reglas: [
  { estado: 'mora', columna: 'En mora', op: 'truthy' }, { estado: 'inversionista+contratos_pendientes', columna: 'Contratos pendientes', op: 'truthy' },
  { estado: 'inversionista', columna: 'Inversiones', op: 'gt', valor: 0 }] });
Object.assign(CFG.operaciones, { columnaNumero: 'Operación', columnaNit: 'NIT pagador', columnaRazonSocial: 'Pagador', columnaEstado: 'Estado', columnaFechaPago: 'Fecha pago' });
Object.assign(CFG.hubspot, { ticketPipeline: '0', ticketEtapa: '1' });
const WF = buildAll(CFG);

const msg = (text, extra = {}) => {
  const b = JSON.parse(JSON.stringify(EVO.texto));
  b.data.message.conversation = text;
  Object.assign(b.data.key, extra);
  return b;
};

// Entorno simulado: HubSpot (contactos, comunicaciones, tickets), Evolution y los flujos emi/*.
function env({ contacto = true, evolutionFalla = false } = {}) {
  const log = { evolution: [], comms: [], contactsCreated: [], tickets: {}, secretos: [] };
  const hubspotAndEvo = async (q) => {
    if (/contacts\/search$/.test(q.url) && q.node === 'HubSpot · buscar contacto' && q.body.filterGroups.length === 5) return contacto ? { results: [{ id: '777' }] } : { results: [] };
    if (/contacts\/search$/.test(q.url)) return HS.contact;
    if (/crm\/v3\/objects\/contacts$/.test(q.url)) { log.contactsCreated.push(q.body); return { id: '888' }; }
    if (/communications\/batch\/create$/.test(q.url)) { log.comms.push(...q.body.inputs); return { results: [] }; }
    if (/evo\.test\/message\/sendText\/emi$/.test(q.url)) { if (evolutionFalla) throw Object.assign(new Error('down'), { status: 500 }); log.evolution.push(q.body); return { key: { id: 'X' } }; }
    if (/2346/.test(q.url)) return MB.clientes;
    if (/3794/.test(q.url)) return MB.operaciones;
    if (/emails\/search/.test(q.url)) return HS.emails;
    if (/tickets\/search/.test(q.url)) { const id = log.tickets[q.body.filterGroups[0].filters[0].value]; return { results: id ? [{ id }] : [] }; }
    if (/tickets$/.test(q.url)) { const id = 'T' + (Object.keys(log.tickets).length + 1); log.tickets[q.body.properties.emi_conversation_id] = id; log.lastTicket = q.body; return { id }; }
    throw Object.assign(new Error('sin ruta ' + q.url), { status: 404 });
  };
  // this.helpers.httpRequest del nodo "Emi responde" → flujos emi/* de verdad.
  const helpersHttp = async (o) => {
    log.secretos.push(o.headers['X-Emi-Secret']);
    const name = 'emi-' + o.url.split('/').pop();
    assert.equal(o.url, 'https://n8n.plataform.com/webhook/emi/' + o.url.split('/').pop());
    const { response } = await runWorkflow(WF[name], { body: o.body, http: hubspotAndEvo });
    return { statusCode: 200, body: response };
  };
  const store = {};
  const send = (body) => runWorkflow(WF['emi-whatsapp'], { body, http: hubspotAndEvo, staticData: store, helpersHttp });
  return { log, store, send };
}

test('parseEvolution: texto, extendido con @lid, grupo, imagen, otros eventos', () => {
  const t = WA.parseEvolution(msg('Hola'));
  assert.deepEqual([t.phone, t.text, t.fromMe, t.pushName], ['573202550525', 'Hola', false, 'Carlos']);
  assert.equal(WA.parseEvolution(EVO.extendido).phone, '573001112233');
  assert.equal(WA.parseEvolution(EVO.grupo).ignore, 'grupo_o_difusion');
  assert.equal(WA.parseEvolution(EVO.imagen).tipo, 'imageMessage');
  assert.match(WA.parseEvolution(EVO.estado).ignore, /^evento/);
});

test('whatsapp: saludo → Emi responde por Evolution y todo queda en HubSpot', async () => {
  const e = env();
  const { trace } = await e.send(msg('Hola'));
  assert.ok(trace.includes('Evolution · enviar'));
  assert.equal(e.log.evolution.length, 1);
  assert.equal(e.log.evolution[0].number, '573202550525');
  assert.match(e.log.evolution[0].text, /Soy Emi/);
  assert.ok(e.log.evolution[0].text.endsWith(WA.MARK), 'lleva la marca invisible');
  assert.deepEqual(e.log.comms.map((c) => c.properties.hs_communication_body.split(':')[0]), ['Cliente', 'Emi']);
  assert.equal(e.log.comms[0].properties.hs_communication_channel_type, 'WHATS_APP');
  assert.equal(e.log.comms[0].associations[0].to.id, '777');
});

test('whatsapp: la conversación mantiene estado entre mensajes (menú → validar documento)', async () => {
  const e = env();
  await e.send(msg('Hola'));
  await e.send(msg('3'));
  await e.send(msg('1032416400'));
  const last = e.log.evolution.at(-1).text;
  assert.match(last, /contratos pendientes/);
  const logged = e.log.comms.map((c) => c.properties.hs_communication_body).join('\n');
  assert.ok(!logged.includes('1032416400') && logged.includes('Cliente: ***6400'), 'cédula enmascarada en HubSpot');
  assert.ok(e.log.secretos.every((s) => s === 's3cr3t'), 'las consultas llevan el secreto');
});

test('whatsapp: operación en cobro con último correo, vía los flujos emi/*', async () => {
  const e = env();
  await e.send(msg('estado de la operación 6543'));
  await e.send(msg('900333444'));
  assert.match(e.log.evolution.at(-1).text, /cobro prejurídico/);
  assert.match(e.log.evolution.at(-1).text, /acuerdo de pago/);
});

test('whatsapp: escalamiento crea ticket asociado al contacto, con el canal, y Emi se silencia', async () => {
  const e = env();
  await e.send(msg('quiero hablar con un asesor'));
  const t = e.log.lastTicket;
  assert.ok(t, 'se creó ticket');
  assert.match(t.properties.emi_conversation_id, /^wa-573202550525-/);
  assert.match(t.properties.content, /Canal: WhatsApp \+57 320 \*\*\* 0525/);
  assert.equal(t.associations[0].to.id, '777');
  assert.ok(e.log.comms.some((c) => /Escalado a asesor · ticket T1/.test(c.properties.hs_communication_body)));
  const antes = e.log.evolution.length;
  await e.send(msg('¿hay alguien?'));
  assert.equal(e.log.evolution.length, antes, 'no responde mientras atiende el asesor');
  assert.ok(e.log.comms.at(-1).properties.hs_communication_body.startsWith('Cliente: ¿hay alguien?'), 'pero sí registra en HubSpot');
  await e.send(msg('menú'));
  assert.equal(e.log.evolution.length, antes + 1, '"menú" reactiva a Emi');
});

test('whatsapp: mensaje del asesor desde el teléfono → se registra y Emi se silencia; el eco de Emi se ignora', async () => {
  const e = env();
  await e.send(msg('Hola'));
  const eco = e.log.evolution[0].text;
  const r = await e.send(msg(eco, { fromMe: true }));
  assert.ok(!r.trace.includes('HubSpot · buscar contacto'), 'eco ignorado');
  await e.send(msg('Hola Carlos, soy Luz, te ayudo', { fromMe: true }));
  assert.ok(e.log.comms.at(-1).properties.hs_communication_body.startsWith('Asesor: Hola Carlos'));
  const n = e.log.evolution.length;
  await e.send(msg('gracias'));
  assert.equal(e.log.evolution.length, n);
});

test('whatsapp: número desconocido → crea el contacto en HubSpot y asocia el histórico', async () => {
  const e = env({ contacto: false });
  await e.send(msg('Hola'));
  assert.equal(e.log.contactsCreated[0].properties.phone, '+573202550525');
  assert.equal(e.log.contactsCreated[0].properties.firstname, 'Carlos');
  assert.equal(e.log.comms[0].associations[0].to.id, '888');
});

test('whatsapp: imagen sin texto → pide escribir', async () => {
  const e = env();
  await e.send(EVO.imagen);
  assert.match(e.log.evolution[0].text, /solo puedo leer mensajes de texto/);
});

test('whatsapp: grupos y otros eventos no hacen nada', async () => {
  const e = env();
  await e.send(EVO.grupo);
  await e.send(EVO.estado);
  assert.equal(e.log.evolution.length + e.log.comms.length, 0);
});

test('whatsapp: si Evolution falla, el histórico lo registra', async () => {
  const e = env({ evolutionFalla: true });
  await e.send(msg('Hola'));
  assert.ok(e.log.comms.some((c) => /No se pudieron enviar 1 mensaje/.test(c.properties.hs_communication_body)));
});

test('whatsapp: con la configuración real (POR_DEFINIR) no responde ni registra', async () => {
  const log = [];
  const r = await runWorkflow(buildAll(DEFAULT_CFG)['emi-whatsapp'], { body: msg('Hola'), http: async (q) => { log.push(q); return {}; }, staticData: {} });
  assert.equal(log.length, 0);
  assert.ok(r.trace.includes('Interpretar mensaje'));
});

test('whatsapp: sesión nueva tras 24 h sin mensajes', () => {
  const store = {}, cfg = DEFAULT_CFG.whatsapp, t0 = new Date('2026-10-28T15:00:00Z');
  const a = WA.getConv(store, '573', t0, cfg);
  const b = WA.getConv(store, '573', new Date(t0.getTime() + 3600000), cfg);
  assert.equal(a.sessionId, b.sessionId);
  const c = WA.getConv(store, '573', new Date(t0.getTime() + 25 * 3600000), cfg);
  assert.notEqual(a.sessionId, c.sessionId);
});
