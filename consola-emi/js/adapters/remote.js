/* Adaptadores remotos: hablan con los webhooks de n8n a través del proxy del Deployer
 * (`/api/proxy/emi-n8n/...`). El navegador nunca ve el token de HubSpot ni la API key de Metabase:
 * viven en n8n, y el secreto del webhook lo inyecta el proxy en el servidor.
 * Contrato de cada webhook: ver n8n/README.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiRemote = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEFAULTS = { base: '/api/proxy/emi-n8n/webhook/emi', timeoutMs: 8000, retries: 1, cacheTtlMs: 60000 };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function createClient(opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(null) : null);
    var cache = {};
    var onCall = opts.onCall || function () {};

    function post(path, body, useCache) {
      var key = path + '|' + JSON.stringify(body);
      var hit = cache[key];
      if (useCache && hit && Date.now() - hit.at < opts.cacheTtlMs) return Promise.resolve(hit.value);
      var attempt = 0;
      var started = Date.now();

      function once() {
        attempt++;
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer;
        var timeout = new Promise(function (_, rej) {
          timer = setTimeout(function () { if (ctrl) ctrl.abort(); rej({ kind: 'timeout' }); }, opts.timeoutMs);
        });
        var req = fetchFn(opts.base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
          if (res.status === 429 || res.status >= 500) throw { kind: 'retryable', status: res.status };
          if (!res.ok) throw { kind: 'fatal', status: res.status };
          return res.json();
        });
        return Promise.race([req, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (e) {
          clearTimeout(timer);
          var err = e && e.kind ? e : { kind: 'retryable', status: 0 };
          // Reintenta con backoff solo errores transitorios (429, 5xx, red, timeout).
          if ((err.kind === 'retryable' || err.kind === 'timeout') && attempt <= opts.retries) {
            return sleep(300 * Math.pow(2, attempt - 1)).then(once);
          }
          throw err;
        });
      }

      return once().then(function (value) {
        if (value && value.error) throw { kind: 'upstream', status: 200, detail: value.error };
        if (useCache) cache[key] = { at: Date.now(), value: value };
        onCall({ path: path, ok: true, ms: Date.now() - started, attempts: attempt });
        return value;
      }, function (err) {
        onCall({ path: path, ok: false, ms: Date.now() - started, attempts: attempt, status: err.status || null, kind: err.kind });
        throw err;
      });
    }

    return {
      clientLookup: function () {
        return {
          source: 'remoto',
          find: function (documento) {
            return post('/client-lookup', { documento: documento }, true).then(function (r) {
              return { estado: r.estado, nombre: r.nombre || null, id: r.hubspot_id || r.id || null };
            });
          }
        };
      },
      operationLookup: function () {
        return {
          source: 'remoto',
          find: function (numero, empresa) {
            return post('/operation-lookup', { numero_operacion: numero, empresa: empresa }, true).then(function (r) {
              if (!r.found) return { found: false };
              return {
                found: true,
                numero: r.numero_operacion || numero,
                estado: r.estado_cobro,
                empresa: { razonSocial: r.empresa && r.empresa.razon_social, nit: r.empresa && r.empresa.nit, tipoSocietario: r.empresa && r.empresa.tipo_societario },
                fechaPagoEstimada: r.fecha_pago_estimada || null,
                ultimaComunicacion: r.ultima_comunicacion || null,
                expediente: r.expediente ? { numero: r.expediente.numero, tipoProceso: r.expediente.tipo_proceso } : null
              };
            });
          }
        };
      },
      escalationSink: function () {
        return {
          source: 'remoto',
          escalate: function (p) {
            return post('/escalate', {
              conversation_id: p.conversationId, motivo: p.motivo, intencion: p.intencion, confianza: p.confianza,
              fuera_horario: p.fueraHorario, cliente: p.cliente, resumen: p.resumen
            }, false).then(function (r) { return { ticketId: r.ticket_id, created: r.status === 'created' }; });
          }
        };
      }
    };
  }

  return { createClient: createClient, DEFAULTS: DEFAULTS };
});
