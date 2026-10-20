const test = require('node:test');
const assert = require('node:assert/strict');
const { E, chat } = require('./helpers.js');
const RE = E.RE;

test('RE_ASESOR detecta pedidos de asesor y no confunde "me asesora"', () => {
  for (const s of ['quiero hablar con un asesor', 'pásame con una persona', 'necesito un agente', 'asesor']) assert.ok(RE.ASESOR.test(s), s);
  for (const s of ['¿Mesfix me asesora sobre en qué invertir?', '¿Puedo agendar una reunión con un asesor comercial?']) assert.ok(!RE.ASESOR.test(s), s);
});

test('RE_RECLAMO', () => {
  for (const s of ['quiero poner una queja', 'esto es una estafa', 'me robaron la plata', 'radicar un PQR']) assert.ok(RE.RECLAMO.test(s), s);
  assert.ok(!RE.RECLAMO.test('cómo invierto'));
});

test('RE_SALUDO solo para saludos', () => {
  for (const s of ['hola', 'Buenos días', 'buenas tardes Emi!', 'qué tal']) assert.ok(RE.SALUDO.test(s), s);
  assert.ok(!RE.SALUDO.test('cómo invierto'));
});

test('RE_ACCESO_MERCADO', () => {
  assert.ok(RE.ACCESO_MERCADO.test('no puedo ver el mercado'));
  assert.ok(RE.ACCESO_MERCADO.test('cómo tengo acceso al mercado'));
  assert.ok(!RE.ACCESO_MERCADO.test('qué es el mercado de mesfix'));
});

test('RE_SIGNUP no captura "¿Qué necesito para registrarme?"', () => {
  assert.ok(RE.SIGNUP.test(E.normalize('quiero registrarme')));
  assert.ok(RE.SIGNUP.test(E.normalize('cómo me registro')));
  assert.ok(!RE.SIGNUP.test(E.normalize('¿Qué necesito para registrarme?')));
});

test('RE_OP_STRONG extrae el número de operación', () => {
  assert.equal('estado de la operación 6543'.match(RE.OP_STRONG)[1], '6543');
  assert.equal('operacion No. 13058'.match(RE.OP_STRONG)[1], '13058');
  assert.equal('operación #7981'.match(RE.OP_STRONG)[1], '7981');
});

test('RE_OP_ESTADO sin número y sin capturar preguntas generales de cobro', () => {
  assert.ok(RE.OP_ESTADO.test('cuál es el estado de mi operación'));
  assert.ok(RE.OP_ESTADO.test('cómo va mi inversión'));
  assert.ok(!RE.OP_ESTADO.test('¿Cuánto tiempo puede tomar un proceso que se encuentre en cobro jurídico?'));
});

test('saludo + pregunta responde la pregunta', async () => {
  const { last } = await chat(['hola, cuál es el monto mínimo para invertir']);
  assert.equal(last.debug.faqId, 61);
});

test('reclamo escala con motivo reclamo', async () => {
  const { last } = await chat(['esto es una estafa']);
  assert.equal(last.escalation.motivo, 'reclamo');
});

test('acceso al mercado responde FAQ 128 por regla', async () => {
  const { last } = await chat(['no puedo ver el mercado']);
  assert.equal(last.debug.faqId, 128);
  assert.equal(last.debug.tipo, 'regla');
});

test('regla de escalar asesor desactivada no crea ticket', async () => {
  const { ctx } = require('./helpers.js');
  const { last } = await chat(['quiero hablar con un asesor'], ctx({ config: { escalar: { pideAsesor: false, reclamo: true, bajaConfianza: true } } }));
  assert.equal(last.escalation, null);
});
