// Regresión: 30 preguntas reales con su resultado esperado (FAQ N° o intención).
// Si un cambio en el motor o en la base mueve alguno de estos resultados, el test lo detecta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, ctx } = require('./helpers.js');

const CASES = [
  ['mi firma electronica salio fallida', { faq: 1 }],
  ['¿Cómo cambio mi correo?', { faq: 2 }],
  ['se me bloqueo el usuario', { faq: 3 }],
  ['que actividad pongo en el rut para invertir', { faq: 7 }],
  ['como fondeo el fic', { faq: 19 }],
  ['cuanto se demora sacar plata del fic a mi banco', { faq: 22 }],
  ['como retiro mi dinero', { faq: 23 }],
  ['cancelar una transaccion pse', { faq: 29 }],
  ['como subo la certificacion bancaria', { faq: 32 }],
  ['como saco el certificado tributario', { faq: 36 }],
  ['que es un fic', { faq: 44 }],
  ['¿Qué es Mesfix?', { faq: 57 }],
  ['que rentabilidad ofrecen', { faq: 59 }],
  ['cual es el monto minimo para invertir', { faq: 61 }],
  ['mesfix cobra comision', { faq: 66 }],
  ['que pasa si la empresa no paga', { faq: 78 }],
  ['puedo diversificar', { faq: 80 }],
  ['que es un remate', { faq: 86 }],
  ['el link de pago no funciona', { faq: 89 }],
  ['como firmo los contratos', { faq: 98 }],
  ['como descargo el certificado anual', { faq: 100 }],
  ['que es el confirming', { faq: 112 }],
  ['como vendo mis facturas', { faq: 113 }],
  ['que es un endoso', { faq: 125 }],
  ['cuales son los horarios de atencion', { faq: 56 }],
  ['y si la pagadora quiebra', { faq: 127 }],
  ['como consulto el saldo de mi fic', { faq: 131 }],
  ['etapas del cobro prejuridico y juridico', { faq: 133 }],
  ['quiero hablar con un asesor', { intencion: 'pide_asesor' }],
  ['cual es la capital de francia', { intencion: 'sin_respuesta' }]
];

test('el set de regresión tiene 30 casos', () => assert.equal(CASES.length, 30));

for (const [q, exp] of CASES) {
  test('regresión: ' + q, async () => {
    const r = await E.respond(q, E.newState(), ctx());
    if (exp.faq) {
      assert.equal(r.debug.faqId, exp.faq, 'candidatos: ' + JSON.stringify(r.debug.candidatos));
      assert.ok(r.debug.confianza >= 0.35);
    } else {
      assert.equal(r.debug.intencion, exp.intencion);
    }
  });
}
