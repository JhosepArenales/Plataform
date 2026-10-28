#!/usr/bin/env node
/* Genera los flujos importables de n8n (n8n/workflows/*.json) a partir de src/config.js y src/lib.js.
 * Uso: node n8n/build.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const strip = (f) => fs.readFileSync(f, 'utf8').split('\nif (typeof module')[0].trim();
const LIB_SRC = strip(path.join(__dirname, 'src', 'lib.js'));
const WA_SRC = strip(path.join(__dirname, 'src', 'wa.js'));
// Motor de Emi completo (los mismos archivos de la consola), aislado para que sus envoltorios UMD
// se registren en un objeto local y no dependan de module/require del entorno de n8n.
const ROOT = path.join(__dirname, '..');
const ENGINE_FILES = ['js/engine/menus.js', 'js/engine/engine.js', 'js/engine/holidays.js', 'js/data/faqs-base.js', 'js/adapters/remote.js'];
const ENGINE_BUNDLE = 'const __EMI = (function () {\n  var module, exports, define, require;\n  var self = {};\n' +
  ENGINE_FILES.map((f) => '// ── ' + f + ' ──\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\n  return self;\n})();';

function uid(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const HEADER = [
  LIB_SRC,
  'const L = emiLib();',
  "const CFG = $('Config').first().json;",
  "const BODY = $('Webhook').first().json.body || {};"
].join('\n');

function code(wf, name, body, pos, extra) {
  return { id: uid(wf + name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode: HEADER + (extra ? '\n' + extra : '') + '\n\n// ── ' + name + ' ──\n' + body.trim() + '\n' } };
}
function webhook(wf, p, pos) {
  return {
    id: uid(wf + 'Webhook'), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos, webhookId: uid(wf + 'hook'),
    parameters: { httpMethod: 'POST', path: p, authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: { id: '', name: 'Emi · secreto del webhook' } }
  };
}
function config(wf, cfg, pos) {
  return {
    id: uid(wf + 'Config'), name: 'Config', type: 'n8n-nodes-base.code', typeVersion: 2, position: pos,
    parameters: { jsCode: '// Configuración de Emi (generada desde n8n/src/config.js). Editar aquí o allá y regenerar.\nreturn [{ json: ' + JSON.stringify(cfg, null, 2) + ' }];\n' }
  };
}
function ifNode(wf, name, expr, pos) {
  return {
    id: uid(wf + name), name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ id: uid(wf + name + 'c'), leftValue: '={{ ' + expr + ' }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      },
      options: {}
    }
  };
}
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000, onError: 'continueRegularOutput' };
function metabase(wf, name, cardKey, pos) {
  return Object.assign({
    id: uid(wf + name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos,
    parameters: {
      method: 'POST',
      url: "={{ $('Config').first().json.metabase.baseUrl + '/api/card/' + $('Config').first().json.metabase." + cardKey + " + '/query' }}",
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.metabaseBody) }}',
      options: { timeout: 15000 }
    },
    credentials: { httpHeaderAuth: { id: '', name: 'Metabase · API key (x-api-key)' } }
  }, RETRY);
}
function hubspot(wf, name, url, bodyExpr, pos) {
  return Object.assign({
    id: uid(wf + name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos,
    parameters: {
      method: 'POST', url, authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify(' + bodyExpr + ') }}', options: { timeout: 8000 }
    },
    credentials: { hubspotAppToken: { id: '', name: 'HubSpot · Emi (Private App)' } }
  }, RETRY);
}
function respond(wf, pos) {
  return { id: uid(wf + 'Responder'), name: 'Responder', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: pos, parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json.respuesta) }}', options: {} } };
}
function link(conns, from, to, out = 0) {
  conns[from] = conns[from] || { main: [] };
  while (conns[from].main.length <= out) conns[from].main.push([]);
  conns[from].main[out].push({ node: to, type: 'main', index: 0 });
}
function workflow(name, nodes, edges) {
  const connections = {};
  edges.forEach((e) => link(connections, e[0], e[1], e[2] || 0));
  return {
    name, nodes, connections, active: false,
    // Datos personales: no guardar ejecuciones exitosas (llevan documentos); las fallidas sí, para depurar.
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: true, timezone: 'America/Bogota' },
    tags: [], pinData: {}
  };
}

// Cada flujo recibe solo la sección de configuración que usa.
function pick(cfg, keys) { const o = {}; keys.forEach((k) => { o[k] = cfg[k]; }); return o; }

function buildClientLookup(cfg) {
  const W = 'client';
  return workflow('Emi · client-lookup', [
    webhook(W, 'emi/client-lookup', [0, 300]),
    config(W, pick(cfg, ['metabase', 'clientes']), [220, 300]),
    code(W, 'Preparar', `
const faltan = L.missingConfig(CFG, 'clientes');
if (faltan.length) return [{ json: { ok: false, respuesta: { error: 'not_configured', faltan } } }];
const v = L.validate('client', BODY);
if (!v.ok) return [{ json: { ok: false, respuesta: v } }];
return [{ json: { ok: true, documento: v.documento, metabaseBody: L.cardBody(CFG.metabase.parametroDocumento, v.documento) } }];`, [440, 300]),
    ifNode(W, '¿Válido?', '$json.ok', [660, 300]),
    metabase(W, 'Metabase · 2346 clientes', 'cardClientes', [880, 200]),
    code(W, 'Clasificar cliente', `
const items = $input.all().map((i) => i.json);
const resp = items.length === 1 ? items[0] : items;
if (L.isHttpError(resp)) return [{ json: { buscarContacto: false, respuesta: { error: 'upstream_unavailable', fuente: 'metabase' } } }];
const doc = $('Preparar').first().json.documento;
const c = L.classifyClient(L.metabaseRows(resp), doc, CFG);
const respuesta = { estado: c.estado, nombre: c.nombre || null, ref_masked: L.maskDoc(doc) };
return [{ json: { buscarContacto: !!c.email, contactBody: c.email ? L.contactSearchBody(c.email) : null, respuesta } }];`, [1100, 200]),
    ifNode(W, '¿Tiene email?', '$json.buscarContacto', [1320, 200]),
    hubspot(W, 'HubSpot · buscar contacto', 'https://api.hubapi.com/crm/v3/objects/contacts/search', '$json.contactBody', [1540, 100]),
    code(W, 'Respuesta cliente', `
const respuesta = Object.assign({}, $('Clasificar cliente').first().json.respuesta);
const j = $input.first().json;
// El contacto de HubSpot es opcional: si la búsqueda falla, la respuesta sigue sin hubspot_id.
if (j && Array.isArray(j.results) && j.results[0]) respuesta.hubspot_id = String(j.results[0].id);
return [{ json: { respuesta } }];`, [1760, 200]),
    respond(W, [1980, 300])
  ], [
    ['Webhook', 'Config'], ['Config', 'Preparar'], ['Preparar', '¿Válido?'],
    ['¿Válido?', 'Metabase · 2346 clientes', 0], ['¿Válido?', 'Responder', 1],
    ['Metabase · 2346 clientes', 'Clasificar cliente'], ['Clasificar cliente', '¿Tiene email?'],
    ['¿Tiene email?', 'HubSpot · buscar contacto', 0], ['¿Tiene email?', 'Respuesta cliente', 1],
    ['HubSpot · buscar contacto', 'Respuesta cliente'], ['Respuesta cliente', 'Responder']
  ]);
}

function buildOperationLookup(cfg) {
  const W = 'operation';
  return workflow('Emi · operation-lookup', [
    webhook(W, 'emi/operation-lookup', [0, 300]),
    config(W, pick(cfg, ['metabase', 'operaciones', 'hubspot']), [220, 300]),
    code(W, 'Preparar', `
const faltan = L.missingConfig(CFG, 'operaciones');
if (faltan.length) return [{ json: { ok: false, respuesta: { error: 'not_configured', faltan } } }];
const v = L.validate('operation', BODY);
if (!v.ok) return [{ json: { ok: false, respuesta: v } }];
return [{ json: { ok: true, numero: v.numero, empresa: v.empresa, metabaseBody: L.cardBody(CFG.metabase.parametroOperacion, v.numero) } }];`, [440, 300]),
    ifNode(W, '¿Válido?', '$json.ok', [660, 300]),
    metabase(W, 'Metabase · 3794 operaciones', 'cardOperaciones', [880, 200]),
    code(W, 'Buscar operación', `
const items = $input.all().map((i) => i.json);
const resp = items.length === 1 ? items[0] : items;
if (L.isHttpError(resp)) return [{ json: { buscarCorreos: false, respuesta: { error: 'upstream_unavailable', fuente: 'metabase' } } }];
const p = $('Preparar').first().json;
const op = L.findOperation(L.metabaseRows(resp), p.numero, p.empresa, CFG);
if (op.error || !op.found) return [{ json: { buscarCorreos: false, respuesta: op } }];
if (op.estado_cobro === 'al_dia') return [{ json: { buscarCorreos: false, respuesta: Object.assign(op, { ultima_comunicacion: null }) } }];
return [{ json: { buscarCorreos: true, emailBody: L.emailSearchBody(CFG), respuesta: op } }];`, [1100, 200]),
    ifNode(W, '¿Buscar correos?', '$json.buscarCorreos', [1320, 200]),
    hubspot(W, 'HubSpot · correos enviados', 'https://api.hubapi.com/crm/v3/objects/emails/search', '$json.emailBody', [1540, 100]),
    code(W, 'Respuesta operación', `
const prev = $('Buscar operación').first().json;
let respuesta = prev.respuesta;
if (prev.buscarCorreos) {
  const j = $input.first().json;
  // Sin correos no se puede afirmar cuál fue la última comunicación: Emi debe ofrecer asesor.
  if (L.isHttpError(j)) respuesta = { error: 'upstream_unavailable', fuente: 'hubspot' };
  else respuesta = Object.assign({}, respuesta, { ultima_comunicacion: L.pickLastCommunication(j.results, respuesta, CFG) });
}
return [{ json: { respuesta } }];`, [1760, 200]),
    respond(W, [1980, 300])
  ], [
    ['Webhook', 'Config'], ['Config', 'Preparar'], ['Preparar', '¿Válido?'],
    ['¿Válido?', 'Metabase · 3794 operaciones', 0], ['¿Válido?', 'Responder', 1],
    ['Metabase · 3794 operaciones', 'Buscar operación'], ['Buscar operación', '¿Buscar correos?'],
    ['¿Buscar correos?', 'HubSpot · correos enviados', 0], ['¿Buscar correos?', 'Respuesta operación', 1],
    ['HubSpot · correos enviados', 'Respuesta operación'], ['Respuesta operación', 'Responder']
  ]);
}

function buildEscalate(cfg) {
  const W = 'escalate';
  return workflow('Emi · escalate', [
    webhook(W, 'emi/escalate', [0, 300]),
    config(W, pick(cfg, ['hubspot']), [220, 300]),
    code(W, 'Preparar', `
const faltan = L.missingConfig(CFG, 'hubspot');
if (faltan.length) return [{ json: { ok: false, respuesta: { error: 'not_configured', faltan } } }];
const v = L.validate('escalate', BODY);
if (!v.ok) return [{ json: { ok: false, respuesta: v } }];
return [{ json: { ok: true, searchBody: L.ticketSearchBody(BODY.conversation_id, CFG) } }];`, [440, 300]),
    ifNode(W, '¿Válido?', '$json.ok', [660, 300]),
    hubspot(W, 'HubSpot · buscar ticket', 'https://api.hubapi.com/crm/v3/objects/tickets/search', '$json.searchBody', [880, 200]),
    code(W, '¿Ya existe?', `
const j = $input.first().json;
if (L.isHttpError(j)) return [{ json: { crear: false, respuesta: { error: 'upstream_unavailable', fuente: 'hubspot' } } }];
// Una conversación = un ticket: si ya hay uno con este conversation_id, se devuelve ese.
if (Array.isArray(j.results) && j.results[0]) return [{ json: { crear: false, respuesta: { ticket_id: String(j.results[0].id), status: 'existing' } } }];
return [{ json: { crear: true, ticketBody: L.ticketCreateBody(BODY, CFG) } }];`, [1100, 200]),
    ifNode(W, '¿Crear?', '$json.crear', [1320, 200]),
    hubspot(W, 'HubSpot · crear ticket', 'https://api.hubapi.com/crm/v3/objects/tickets', '$json.ticketBody', [1540, 100]),
    code(W, 'Respuesta ticket', `
const j = $input.first().json;
if (L.isHttpError(j) || !j.id) return [{ json: { respuesta: { error: 'upstream_unavailable', fuente: 'hubspot' } } }];
return [{ json: { respuesta: { ticket_id: String(j.id), status: 'created' } } }];`, [1760, 100]),
    respond(W, [1980, 300])
  ], [
    ['Webhook', 'Config'], ['Config', 'Preparar'], ['Preparar', '¿Válido?'],
    ['¿Válido?', 'HubSpot · buscar ticket', 0], ['¿Válido?', 'Responder', 1],
    ['HubSpot · buscar ticket', '¿Ya existe?'], ['¿Ya existe?', '¿Crear?'],
    ['¿Crear?', 'HubSpot · crear ticket', 0], ['¿Crear?', 'Responder', 1],
    ['HubSpot · crear ticket', 'Respuesta ticket'], ['Respuesta ticket', 'Responder']
  ]);
}

function buildWhatsapp(cfg) {
  const W = 'whatsapp';
  const WAX = WA_SRC;
  const hook = webhook(W, 'emi/whatsapp-' + cfg.whatsapp.webhookToken, [0, 300]);
  // Evolution no envía cabeceras de autenticación: el token secreto va en la ruta. Se responde 200 al instante.
  hook.parameters.authentication = 'none';
  hook.parameters.responseMode = 'onReceived';
  delete hook.credentials;
  const evo = Object.assign({
    id: uid(W + 'Evolution'), name: 'Evolution · enviar', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2420, 200],
    parameters: {
      method: 'POST', url: '={{ $json.url }}', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 15000 }
    },
    credentials: { httpHeaderAuth: { id: '', name: 'Evolution · API key (apikey)' } }
  }, RETRY);
  return workflow('Emi · whatsapp (Evolution API)', [
    hook,
    config(W, pick(cfg, ['whatsapp', 'emi']), [220, 300]),
    code(W, 'Interpretar mensaje', `
const WA = emiWa();
const faltan = L.missingConfig(CFG, 'whatsapp');
if (faltan.length) return [{ json: { seguir: false, motivo: 'not_configured', faltan } }];
const msg = WA.parseEvolution(BODY);
if (msg.ignore) return [{ json: { seguir: false, motivo: msg.ignore } }];
const store = $getWorkflowStaticData('global');
const now = new Date();
const conv = WA.getConv(store, msg.phone, now, CFG.whatsapp);
const decision = WA.decide(conv, msg, now, CFG.whatsapp);
if (decision.accion === 'ignorar') return [{ json: { seguir: false, motivo: decision.motivo } }];
conv.lastAt = now.getTime();
return [{ json: { seguir: true, msg, decision, searchBody: WA.contactSearchBody(msg.phone) } }];`, [440, 300], WAX),
    ifNode(W, '¿Seguir?', '$json.seguir', [660, 300]),
    hubspot(W, 'HubSpot · buscar contacto', 'https://api.hubapi.com/crm/v3/objects/contacts/search', '$json.searchBody', [880, 200]),
    code(W, '¿Crear contacto?', `
const WA = emiWa();
const j = $input.first().json;
const msg = $('Interpretar mensaje').first().json.msg;
if (L.isHttpError(j)) return [{ json: { contactId: null, crear: false, aviso: 'busqueda_fallo' } }];
if (Array.isArray(j.results) && j.results[0]) return [{ json: { contactId: String(j.results[0].id), crear: false } }];
return [{ json: { contactId: null, crear: !!CFG.whatsapp.crearContacto, createBody: WA.contactCreateBody(msg.phone, msg.pushName) } }];`, [1100, 200], WAX),
    ifNode(W, '¿Crear?', '$json.crear', [1320, 200]),
    hubspot(W, 'HubSpot · crear contacto', 'https://api.hubapi.com/crm/v3/objects/contacts', '$json.createBody', [1540, 100]),
    code(W, 'Contacto listo', `
const j = $input.first().json;
// Llega desde "¿Crear contacto?" (ya trae contactId) o desde "HubSpot · crear contacto" (trae id o error).
if (j.contactId !== undefined) return [{ json: { contactId: j.contactId } }];
return [{ json: { contactId: L.isHttpError(j) || !j.id ? null : String(j.id) } }];`, [1760, 200]),
    code(W, 'Emi responde', `
const WA = emiWa();
const E = __EMI.EmiEngine, B = __EMI.EmiBase, H = __EMI.EmiHolidays, R = __EMI.EmiRemote;
const C = CFG.whatsapp;
const prev = $('Interpretar mensaje').first().json;
const msg = prev.msg, dec = prev.decision;
const contactId = $('Contacto listo').first().json.contactId || null;
const now = new Date();
const store = $getWorkflowStaticData('global');
const conv = WA.getConv(store, msg.phone, now, C);
const registro = [{ autor: dec.autor || 'Cliente', text: msg.text || '[' + msg.tipo + ']', ts: msg.ts }];
let replies = [];
if (dec.accion === 'responder') {
  conv.engineState = conv.engineState || E.newState();
  const helpers = this.helpers;
  // Las consultas reutilizan los webhooks emi/* (Metabase, HubSpot), con el mismo secreto.
  const client = R.createClient({
    base: C.emiWebhookBase.replace(/\\/+$/, '') + '/webhook/emi', timeoutMs: 8000, retries: 1,
    fetch: async (url, init) => {
      const r = await helpers.httpRequest({ method: 'POST', url, headers: { 'Content-Type': 'application/json', 'X-Emi-Secret': C.emiSecret },
        body: JSON.parse(init.body), json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 8000 });
      return { status: r.statusCode, ok: r.statusCode >= 200 && r.statusCode < 300, json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body) };
    }
  });
  const sink = client.escalationSink();
  const adapters = {
    client: client.clientLookup(), operation: client.operationLookup(),
    escalation: { source: 'remoto', escalate: (p) => sink.escalate(Object.assign({}, p, {
      conversationId: conv.sessionId,
      cliente: Object.assign({}, p.cliente || {}, contactId && !(p.cliente && p.cliente.id) ? { id: contactId } : {}),
      resumen: 'Canal: WhatsApp ' + WA.maskPhone(msg.phone) + '\\n' + p.resumen
    })) }
  };
  const y = now.getFullYear();
  const holidays = H.colombianHolidays(y).concat(H.colombianHolidays(y + 1)).map((h) => h.fecha);
  const faqs = B.BASE_DEFAULT.map((f) => Object.assign({}, f, { base_id: f.id, activa: true }));
  let res;
  if (!msg.text) res = { replies: ['Por ahora solo puedo leer mensajes de texto 🙏. Escríbeme tu consulta, por favor.'], state: conv.engineState, escalation: null };
  else res = await E.respond(msg.text, conv.engineState, { config: CFG.emi, faqs, holidays, now, conversationId: conv.sessionId, adapters });
  conv.engineState = res.state;
  replies = res.replies;
  if (res.escalation && res.escalation.ticketId) conv.humanUntil = now.getTime() + C.silencioHoras * 3600000;
  WA.rememberBot(conv, replies, now);
  const nombre = (CFG.emi && CFG.emi.nombre) || 'Emi';
  replies.forEach((r, i) => registro.push({ autor: nombre, text: r, ts: new Date(now.getTime() + i + 1).toISOString() }));
  if (res.escalation) registro.push({ autor: 'Sistema', text: res.escalation.ticketId ? 'Escalado a asesor · ticket ' + res.escalation.ticketId + ' · motivo: ' + res.escalation.motivo : 'No se pudo crear el ticket de escalamiento', ts: new Date(now.getTime() + 50).toISOString() });
}
conv.lastAt = now.getTime();
WA.prune(store, now, C.diasRetencionEstado);
return [{ json: { phone: msg.phone, envios: WA.sendItems(C, msg.phone, replies), registro, contactId } }];`, [1980, 300], WAX + '\n' + ENGINE_BUNDLE),
    code(W, 'Preparar envíos', `
const envios = $input.first().json.envios || [];
if (!envios.length) return [{ json: { sinEnvios: true } }];
return envios.map((e) => ({ json: e }));`, [2200, 300]),
    ifNode(W, '¿Hay envíos?', '$json.sinEnvios !== true', [2420, 400]),
    evo,
    code(W, 'Armar registro', `
const WA = emiWa();
const base = $('Emi responde').first().json;
const registro = base.registro.slice();
const fallos = $input.all().filter((i) => i.json && i.json.error !== undefined && i.json.key === undefined).length;
if (fallos) registro.push({ autor: 'Sistema', text: 'No se pudieron enviar ' + fallos + ' mensaje(s) por WhatsApp (Evolution API).', ts: new Date().toISOString() });
return [{ json: { commBody: WA.communicationsBody(registro, base.contactId, CFG.whatsapp) } }];`, [2640, 300], WAX),
    hubspot(W, 'HubSpot · registrar conversación', 'https://api.hubapi.com/crm/v3/objects/communications/batch/create', '$json.commBody', [2860, 300])
  ], [
    ['Webhook', 'Config'], ['Config', 'Interpretar mensaje'], ['Interpretar mensaje', '¿Seguir?'],
    ['¿Seguir?', 'HubSpot · buscar contacto', 0],
    ['HubSpot · buscar contacto', '¿Crear contacto?'], ['¿Crear contacto?', '¿Crear?'],
    ['¿Crear?', 'HubSpot · crear contacto', 0], ['¿Crear?', 'Contacto listo', 1],
    ['HubSpot · crear contacto', 'Contacto listo'], ['Contacto listo', 'Emi responde'],
    ['Emi responde', 'Preparar envíos'], ['Preparar envíos', '¿Hay envíos?'],
    ['¿Hay envíos?', 'Evolution · enviar', 0], ['¿Hay envíos?', 'Armar registro', 1],
    ['Evolution · enviar', 'Armar registro'], ['Armar registro', 'HubSpot · registrar conversación']
  ]);
}

function buildAll(cfg) {
  return { 'emi-client-lookup': buildClientLookup(cfg), 'emi-operation-lookup': buildOperationLookup(cfg), 'emi-escalate': buildEscalate(cfg), 'emi-whatsapp': buildWhatsapp(cfg) };
}

module.exports = { buildAll };

if (require.main === module) {
  const out = path.join(__dirname, 'workflows');
  fs.mkdirSync(out, { recursive: true });
  const all = buildAll(require('./src/config.js'));
  for (const [name, wf] of Object.entries(all)) {
    fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(wf, null, 2) + '\n');
    console.log('✓ n8n/workflows/' + name + '.json (' + wf.nodes.length + ' nodos)');
  }
}
