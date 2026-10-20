/* Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani").
 * Solo se usa para sembrar la tabla `holidays`; el motor recibe la lista de fechas
 * desde la base de datos, nunca la calcula en caliente. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiHolidays = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function utc(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

  // Domingo de Pascua (algoritmo anónimo gregoriano).
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return utc(y, month, day);
  }

  // Traslada al lunes siguiente si no cae en lunes.
  function nextMonday(d) {
    var dow = d.getUTCDay();
    return dow === 1 ? d : addDays(d, (8 - dow) % 7);
  }

  function colombianHolidays(year) {
    var e = easter(year);
    var list = [
      [utc(year, 1, 1), 'Año Nuevo'],
      [nextMonday(utc(year, 1, 6)), 'Día de los Reyes Magos'],
      [nextMonday(utc(year, 3, 19)), 'Día de San José'],
      [addDays(e, -3), 'Jueves Santo'],
      [addDays(e, -2), 'Viernes Santo'],
      [utc(year, 5, 1), 'Día del Trabajo'],
      [nextMonday(addDays(e, 39)), 'Ascensión del Señor'],
      [nextMonday(addDays(e, 60)), 'Corpus Christi'],
      [nextMonday(addDays(e, 68)), 'Sagrado Corazón'],
      [nextMonday(utc(year, 6, 29)), 'San Pedro y San Pablo'],
      [utc(year, 7, 20), 'Día de la Independencia'],
      [utc(year, 8, 7), 'Batalla de Boyacá'],
      [nextMonday(utc(year, 8, 15)), 'La Asunción de la Virgen'],
      [nextMonday(utc(year, 10, 12)), 'Día de la Raza'],
      [nextMonday(utc(year, 11, 1)), 'Todos los Santos'],
      [nextMonday(utc(year, 11, 11)), 'Independencia de Cartagena'],
      [utc(year, 12, 8), 'Inmaculada Concepción'],
      [utc(year, 12, 25), 'Navidad']
    ];
    return list
      .map(function (p) { return { fecha: iso(p[0]), nombre: p[1] }; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  }

  return { colombianHolidays: colombianHolidays, easter: function (y) { return iso(easter(y)); } };
});
