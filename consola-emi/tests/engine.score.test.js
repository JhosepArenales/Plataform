const test = require('node:test');
const assert = require('node:assert/strict');
const { E, FAQS, ctx } = require('./helpers.js');

const faq = { pregunta: '¿Cuál es el monto mínimo para invertir?', keywords: 'monto mínimo, cuánto necesito para empezar', categoria: 'Requisitos y documentos' };

test('score: coincidencia exacta da 1 (tope)', () => {
  assert.equal(E.score('¿Cuál es el monto mínimo para invertir?', faq), 1);
});

test('score: fórmula 0.55·recall + 0.32·max(dice) + 0.13·dice(pregunta)', () => {
  const q = 'monto para empezar';
  const qs = new Set(E.tokens(q).map(E.stem));
  const doc = new Set(E.tokens(faq.pregunta).concat(E.tokens(faq.keywords)).map(E.stem));
  const recall = [...qs].filter((w) => doc.has(w)).length / qs.size;
  const dP = E.dice(q, faq.pregunta);
  const dK = Math.max(...faq.keywords.split(',').map((k) => E.dice(q, k)));
  const expected = Math.min(1, 0.55 * recall + 0.32 * Math.max(dP, dK) + 0.13 * dP);
  assert.ok(Math.abs(E.score(q, faq) - expected) < 1e-9);
});

test('score: +0.06 si coincide la categoría', () => {
  const q = 'cuánto necesito';
  const a = E.score(q, faq), b = E.score(q, faq, 'Requisitos y documentos');
  assert.ok(Math.abs(b - Math.min(1, a + 0.06)) < 1e-9);
});

test('score: solo palabras vacías da 0', () => {
  assert.equal(E.score('de la el', faq), 0);
});

test('dice tolera errores de tipeo', () => {
  assert.ok(E.dice('rentavilidad', 'rentabilidad') > 0.7);
});

test('umbral por defecto 0.35', () => assert.equal(E.defaults().threshold, 0.35));

test('debajo del umbral: no responde, registra gap y ofrece asesor', async () => {
  const r = await E.respond('me gusta el fútbol', E.newState(), ctx());
  assert.equal(r.debug.tipo, 'gap');
  assert.ok(r.gap && r.gap.score < 0.35);
  assert.equal(r.state.pending.type, 'ofrece_asesor');
  assert.match(r.replies[0], /No tengo información suficiente/);
});

test('subir el umbral convierte una respuesta en gap', async () => {
  const q = 'cuanto se demora sacar plata del fic a mi banco';
  const ok = await E.respond(q, E.newState(), ctx());
  assert.equal(ok.debug.tipo, 'faq');
  const hi = await E.respond(q, E.newState(), ctx({ config: { threshold: 0.99 } }));
  assert.equal(hi.debug.tipo, 'gap');
});

test('FAQs inactivas no se usan', async () => {
  const faqs = FAQS.map((f) => (f.base_id === 61 ? { ...f, activa: false } : f));
  const r = await E.respond('cual es el monto minimo para invertir', E.newState(), ctx({ faqs }));
  assert.notEqual(r.debug.faqId, 61);
});
