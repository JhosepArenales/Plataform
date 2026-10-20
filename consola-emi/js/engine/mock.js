/* Datos y adaptadores simulados. Se usan en el Playground (modo Mock) y en los tests.
 * Todos los nombres, NIT y expedientes son ficticios. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiMock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEMO_DOCS = {
    '79378202': { estado: 'inversionista', nombre: 'Carlos' },
    '1032416400': { estado: 'inversionista+contratos_pendientes', nombre: 'Laura' },
    '79491944': { estado: 'mora', nombre: 'Andrés' },
    '900876543': { estado: 'prospecto', nombre: 'Comercializadora Ejemplo SAS' }
  };

  var EMPRESAS = {
    '900111222': { razonSocial: 'Constructora Demo Andina SAS', tipoSocietario: 'Sociedad por Acciones Simplificada' },
    '900333444': { razonSocial: 'Logística Ficticia del Caribe SAS', tipoSocietario: 'Sociedad por Acciones Simplificada' }
  };

  // Una misma empresa (900333444) tiene dos operaciones, cada una con sus comunicados.
  var DEMO_OPS = {
    '7981': {
      nit: '900111222', estado: 'al_dia', fechaPagoEstimada: '2026-11-30',
      comunicaciones: []
    },
    '6543': {
      nit: '900333444', estado: 'prejuridico',
      comunicaciones: [
        { fecha: '2026-09-02', asunto: 'Actualización estado del proceso – operación 6543', resumen: 'La empresa pagadora presenta mora. Iniciamos gestión de cobro prejurídico con requerimientos escritos y llamadas.' },
        { fecha: '2026-10-08', asunto: 'Actualización | Acuerdo de pago en revisión – operación 6543', resumen: 'La pagadora presentó una propuesta de acuerdo de pago que está siendo evaluada por el área jurídica. Te informaremos la decisión.' }
      ],
      expediente: null
    },
    '13058': {
      nit: '900333444', estado: 'juridico',
      comunicaciones: [
        { fecha: '2026-07-15', asunto: 'Actualización estado del proceso – operación 13058', resumen: 'Se radicó la demanda ejecutiva a través de PTG Abogados.' },
        { fecha: '2026-10-14', asunto: 'Actualización | Admisión en proceso de reorganización – operación 13058', resumen: 'La pagadora fue admitida en proceso de reorganización ante la Superintendencia de Sociedades. La acreencia fue presentada dentro del proceso.' }
      ],
      expediente: { numero: '2026-01-000123', tipoProceso: 'Reorganización (Ley 1116 de 2006)' }
    }
  };

  function normalizeName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(s\.?\s?a\.?\s?s\.?|sas|s\.?a\.?|ltda)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ¿Lo que escribió el usuario identifica a la empresa? Acepta NIT (con o sin DV) o parte de la razón social.
  function matchesEmpresa(input, nit) {
    var digits = String(input || '').split('-')[0].replace(/\D/g, '');
    if (digits.length >= 6) return digits === nit;
    var q = normalizeName(input);
    if (q.length < 4) return false;
    return normalizeName(EMPRESAS[nit].razonSocial).indexOf(q) !== -1;
  }

  function clientLookup() {
    return {
      source: 'mock',
      find: function (documento) {
        var hit = DEMO_DOCS[documento];
        return Promise.resolve(hit ? { estado: hit.estado, nombre: hit.nombre } : { estado: 'no_encontrado' });
      }
    };
  }

  function operationLookup() {
    return {
      source: 'mock',
      find: function (numero, empresaInput) {
        var op = DEMO_OPS[numero];
        if (!op || !matchesEmpresa(empresaInput, op.nit)) return Promise.resolve({ found: false });
        var emp = EMPRESAS[op.nit];
        var last = op.comunicaciones.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; })[0] || null;
        return Promise.resolve({
          found: true,
          numero: numero,
          estado: op.estado,
          empresa: { razonSocial: emp.razonSocial, nit: op.nit, tipoSocietario: emp.tipoSocietario },
          fechaPagoEstimada: op.fechaPagoEstimada || null,
          ultimaComunicacion: last,
          expediente: op.expediente
        });
      }
    };
  }

  function escalationSink() {
    var created = {};
    return {
      source: 'mock',
      escalate: function (payload) {
        var id = 'MOCK-' + payload.conversationId;
        var existed = !!created[id];
        created[id] = true;
        return Promise.resolve({ ticketId: id, created: !existed });
      }
    };
  }

  return {
    DEMO_DOCS: DEMO_DOCS, DEMO_OPS: DEMO_OPS, EMPRESAS: EMPRESAS,
    clientLookup: clientLookup, operationLookup: operationLookup, escalationSink: escalationSink,
    matchesEmpresa: matchesEmpresa
  };
});
