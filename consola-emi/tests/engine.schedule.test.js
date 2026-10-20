const test = require('node:test');
const assert = require('node:assert/strict');
const { E, H, chat, ctx } = require('./helpers.js');

const HOR = E.defaults().horario;
const FEST = H.colombianHolidays(2026).concat(H.colombianHolidays(2027)).map((h) => h.fecha);
// Hora de Bogotá → Date (UTC-5).
const bog = (s) => new Date(new Date(s + 'Z').getTime() + 5 * 3600000);

test('festivos 2026 de Colombia (Ley Emiliani)', () => {
  const f = H.colombianHolidays(2026).map((h) => h.fecha);
  for (const d of ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
    '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25']) {
    assert.ok(f.includes(d), d);
  }
  assert.equal(f.length, 18);
});

test('festivos 2027: Pascua 28 de marzo', () => {
  assert.equal(H.easter(2027), '2027-03-28');
  const f = H.colombianHolidays(2027).map((h) => h.fecha);
  for (const d of ['2027-03-25', '2027-03-26', '2027-05-10', '2027-05-31', '2027-06-07']) assert.ok(f.includes(d), d);
});

test('isOpen: día hábil dentro y fuera de horario', () => {
  assert.equal(E.isOpen(bog('2026-10-20T10:00:00'), HOR, FEST), true);
  assert.equal(E.isOpen(bog('2026-10-20T07:59:00'), HOR, FEST), false);
  assert.equal(E.isOpen(bog('2026-10-20T18:00:00'), HOR, FEST), false);
});

test('isOpen: fin de semana y festivo', () => {
  assert.equal(E.isOpen(bog('2026-10-24T10:00:00'), HOR, FEST), false); // sábado
  assert.equal(E.isOpen(bog('2026-11-02T10:00:00'), HOR, FEST), false); // festivo
  assert.equal(E.isOpen(bog('2026-11-02T10:00:00'), { ...HOR, atenderFestivos: true }, FEST), true);
});

test('nextOpenText', () => {
  assert.equal(E.nextOpenText(bog('2026-10-20T06:00:00'), HOR, FEST), 'hoy a partir de las 8:00 a.m.');
  assert.equal(E.nextOpenText(bog('2026-10-20T19:00:00'), HOR, FEST), 'mañana a partir de las 8:00 a.m.');
  assert.equal(E.nextOpenText(bog('2026-10-23T19:00:00'), HOR, FEST), 'el lunes 26 de octubre a partir de las 8:00 a.m.');
  // Viernes 30 oct → lunes 2 nov festivo → martes 3
  assert.equal(E.nextOpenText(bog('2026-10-30T19:00:00'), HOR, FEST), 'el martes 3 de noviembre a partir de las 8:00 a.m.');
});

test('fuera de horario: crea el ticket igual, marcado, y lo informa', async () => {
  const { last } = await chat(['quiero hablar con un asesor'], ctx({ now: bog('2026-10-24T11:00:00') }));
  assert.equal(last.escalation.fueraHorario, true);
  assert.ok(last.escalation.ticketId);
  assert.match(last.replies[0], /lunes a viernes de 8:00 a\.m\. a 6:00 p\.m\./);
  assert.match(last.replies[0], /el lunes 26 de octubre/);
});
