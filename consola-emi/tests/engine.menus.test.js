const test = require('node:test');
const assert = require('node:assert/strict');
const { E, chat } = require('./helpers.js');

test('saludo abre el menú principal con el nombre configurado', async () => {
  const { last } = await chat(['Hola']);
  assert.match(last.replies[0], /Soy Emi/);
  assert.match(last.replies[0], /1\. Registro/);
  assert.deepEqual(last.state.menuStack, ['inicio']);
});

test('alias "menú" abre el principal aunque haya un flujo abierto', async () => {
  const { last } = await chat(['hola', '3', 'menú']);
  assert.equal(last.state.pending, null);
  assert.deepEqual(last.state.menuStack, ['inicio']);
});

test('navegación a submenús y "volver al menú anterior"', async () => {
  const r = await chat(['hola', '1', '5']);
  assert.deepEqual(r.state.menuStack, ['inicio', 'registro', 'documentos']);
  const back = await chat(['hola', '1', '5', 'volver al menú anterior']);
  assert.deepEqual(back.state.menuStack, ['inicio', 'registro']);
  assert.match(back.last.replies[0], /¿Con qué parte del registro/);
  const nine = await chat(['hola', '1', '9']);
  assert.deepEqual(nine.state.menuStack, ['inicio']);
});

test('una opción de menú responde con la FAQ referenciada', async () => {
  const { last } = await chat(['hola', '2', '2']);
  assert.equal(last.debug.faqId, 61);
  assert.equal(last.debug.tipo, 'menu');
});

test('opción inexistente vuelve a mostrar el menú', async () => {
  const { last } = await chat(['hola', '8']);
  assert.equal(last.debug.intencion, 'menu_opcion_invalida');
  assert.match(last.replies[0], /Esa opción no está/);
});

test('opción 3 exige validar documento', async () => {
  const { last } = await chat(['hola', '3']);
  assert.equal(last.state.pending.type, 'doc');
});

test('opción 0 escala a un asesor', async () => {
  const { last } = await chat(['hola', '0']);
  assert.equal(last.escalation.motivo, 'pidio_asesor');
});

test('todas las FAQs referenciadas por los menús existen en la base', () => {
  const { FAQS } = require('./helpers.js');
  const ids = new Set(FAQS.map((f) => f.base_id));
  for (const [id, m] of Object.entries(E.MENUS)) {
    for (const o of m.opciones) {
      if (o.faq) assert.ok(ids.has(o.faq), id + '.' + o.key + ' → FAQ ' + o.faq);
      if (o.goto) assert.ok(E.MENUS[o.goto], id + '.' + o.key + ' → menú ' + o.goto);
    }
  }
});
