// Utilidades compartidas por los tests (no es un archivo de test).
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine', 'engine.js'));
const M = require(path.join(__dirname, '..', 'js', 'engine', 'mock.js'));
const B = require(path.join(__dirname, '..', 'js', 'data', 'faqs-base.js'));
const H = require(path.join(__dirname, '..', 'js', 'engine', 'holidays.js'));

const FAQS = B.BASE_DEFAULT.map((f) => ({ ...f, base_id: f.id, activa: true }));
// Martes 20 de octubre de 2026, 10:00 a.m. en Bogotá (día hábil, dentro del horario).
const OPEN_NOW = new Date('2026-10-20T15:00:00Z');

function ctx(over = {}) {
  return {
    config: {},
    faqs: FAQS,
    holidays: H.colombianHolidays(2026).concat(H.colombianHolidays(2027)).map((h) => h.fecha),
    now: OPEN_NOW,
    conversationId: 'conv-test',
    adapters: { client: M.clientLookup(), operation: M.operationLookup(), escalation: M.escalationSink() },
    ...over
  };
}

// Ejecuta una secuencia de mensajes y devuelve el último resultado (y todos).
async function chat(messages, c = ctx()) {
  let st = E.newState();
  const all = [];
  for (const m of messages) {
    const r = await E.respond(m, st, c);
    st = r.state;
    all.push(r);
  }
  return { last: all[all.length - 1], all, state: st };
}

module.exports = { E, M, B, H, FAQS, OPEN_NOW, ctx, chat };
