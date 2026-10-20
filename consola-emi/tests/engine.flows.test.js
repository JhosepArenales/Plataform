const test = require('node:test');
const assert = require('node:assert/strict');
const { E, M, chat, ctx } = require('./helpers.js');

const VALIDAR = ['hola', '3'];

test('cliente inversionista', async () => {
  const { last } = await chat([...VALIDAR, '79.378.202']);
  assert.equal(last.state.cliente.estado, 'inversionista');
  assert.equal(last.state.cliente.ref, 'CC ***378202');
  assert.match(last.replies[0], /Estado de una operación/);
});

test('cliente inversionista con contratos pendientes', async () => {
  const { last } = await chat([...VALIDAR, '1032416400']);
  assert.equal(last.state.cliente.estado, 'inversionista+contratos_pendientes');
  assert.match(last.replies[0], /contratos pendientes por firmar/);
});

test('cliente en mora ofrece asesor', async () => {
  const { last } = await chat([...VALIDAR, '79491944']);
  assert.equal(last.state.cliente.estado, 'mora');
  assert.equal(last.state.pending.type, 'ofrece_asesor');
  const r = await E.respond('sí', last.state, ctx());
  assert.equal(r.escalation.motivo, 'cliente_mora');
});

test('prospecto (NIT con dígito de verificación) va al registro', async () => {
  const { last } = await chat([...VALIDAR, '900876543-1']);
  assert.equal(last.state.cliente.estado, 'prospecto');
  assert.equal(last.state.cliente.ref, 'NIT ***876543');
  assert.equal(last.state.menuStack.at(-1), 'registro');
});

test('documento no encontrado', async () => {
  const { last } = await chat([...VALIDAR, '1111111']);
  assert.equal(last.state.cliente.estado, 'no_encontrado');
  assert.equal(last.state.menuStack.at(-1), 'no_encontrado');
});

test('el documento completo nunca aparece en el historial ni en debug', async () => {
  const { last } = await chat([...VALIDAR, '1032416400']);
  assert.ok(!JSON.stringify(last.state).includes('1032416400'));
  assert.ok(!JSON.stringify(last.debug).includes('1032416400'));
});

test('operación al día', async () => {
  const { last } = await chat(['estado de la operación 7981', '900111222']);
  assert.equal(last.debug.resultado, 'al_dia');
  assert.match(last.replies[0], /está al día/);
});

test('operación en prejurídico: muestra la última comunicación filtrada por la operación', async () => {
  const { last } = await chat(['operación 6543', 'Logística Ficticia']);
  assert.equal(last.debug.resultado, 'prejuridico');
  assert.match(last.replies[0], /8 de octubre de 2026/);
  assert.match(last.replies[0], /Acuerdo de pago en revisión/);
  assert.ok(!/reorganización/.test(last.replies[0]), 'no mezcla comunicados de la operación 13058');
  assert.match(last.replies[0], /¿Esto resuelve tu inquietud/);
});

test('operación en jurídico + pedir actualización muestra el expediente', async () => {
  const { last } = await chat(['operación 13058', '900333444', 'consulta si hay actualización']);
  assert.match(last.replies[0], /Expediente: 2026-01-000123/);
  assert.match(last.replies[0], /Reorganización/);
  assert.match(last.replies[0], /Tipo societario/);
});

test('operación con empresa equivocada no revela el estado', async () => {
  const { last } = await chat(['operación 6543', 'Constructora Demo Andina']);
  assert.ok(!/cobro/.test(last.replies[0]));
  assert.equal(last.state.pending.type, 'op_empresa');
});

test('"esto resuelve" cierra el flujo sin escalar', async () => {
  const { last } = await chat(['operación 6543', '900333444', 'sí, gracias']);
  assert.equal(last.escalation, null);
  assert.equal(last.state.pending, null);
});

test('una conversación = un ticket', async () => {
  const sink = M.escalationSink();
  let calls = 0;
  const spy = { source: 'mock', escalate: (p) => { calls++; return sink.escalate(p); } };
  const c = ctx({ adapters: { ...ctx().adapters, escalation: spy } });
  const { all } = await chat(['quiero hablar con un asesor', 'es una estafa', 'quiero hablar con un asesor'], c);
  assert.equal(calls, 1);
  assert.equal(all[0].escalation.created, true);
  assert.equal(all[2].escalation.ticketId, all[0].escalation.ticketId);
});

test('el payload de escalamiento lleva motivo, intención, horario y resumen enmascarado', async () => {
  let got = null;
  const c = ctx({ adapters: { ...ctx().adapters, escalation: { escalate: (p) => { got = p; return Promise.resolve({ ticketId: 'T1', created: true }); } } } });
  await chat(['hola', '3', '1032416400', 'quiero hablar con un asesor'], c);
  assert.equal(got.motivo, 'pidio_asesor');
  assert.equal(got.intencion, 'pide_asesor');
  assert.equal(got.fueraHorario, false);
  assert.equal(got.cliente.ref, 'CC ***416400');
  assert.ok(got.resumen.includes('Usuario:'));
  assert.ok(!got.resumen.includes('1032416400'));
});

const failing = { source: 'remoto', find: () => Promise.reject(new Error('503')) };

test('si falla la consulta de cliente, Emi no inventa y ofrece asesor', async () => {
  const c = ctx({ adapters: { ...ctx().adapters, client: failing } });
  const { last } = await chat([...VALIDAR, '79378202'], c);
  assert.equal(last.state.cliente, null);
  assert.match(last.replies[0], /No tengo información suficiente/);
  assert.equal(last.state.pending.type, 'ofrece_asesor');
});

test('si falla la consulta de operación, Emi no inventa un estado', async () => {
  const c = ctx({ adapters: { ...ctx().adapters, operation: failing } });
  const { last } = await chat(['operación 6543', '900333444'], c);
  assert.ok(!/cobro|al día/.test(last.replies[0]));
  assert.match(last.replies[0], /No tengo información suficiente/);
});

test('si falla la creación del ticket, da el contacto de respaldo', async () => {
  const c = ctx({ adapters: { ...ctx().adapters, escalation: { escalate: () => Promise.reject(new Error('x')) } } });
  const { last } = await chat(['quiero hablar con un asesor'], c);
  assert.equal(last.escalation.error, true);
  assert.match(last.replies[0], /321 751 7944/);
});

test('personalidad: trato de usted y sin emojis', async () => {
  const c = ctx({ config: { trato: 'usted', emojis: 'ninguno' } });
  const { last } = await chat(['hola', '3'], c);
  assert.match(last.replies[0], /Escríbame su número de documento/);
  const s = await chat(['hola'], c);
  assert.ok(!/👋/.test(s.last.replies[0]));
});

test('maskDoc', () => {
  assert.equal(E.maskDoc('1032416400'), 'CC ***416400');
  assert.equal(E.maskDoc('900876543'), 'NIT ***876543');
  assert.equal(E.maskText('mi cédula es 1.032.416.400'), 'mi cédula es CC ***416400');
});
