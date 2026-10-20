/* Capa de datos.
 * Producción: CRUD generado por el Plataform Deployer en /api/db/<tabla> (MySQL).
 * Desarrollo local (sin servidor): la misma interfaz sobre localStorage, con aviso visible.
 * En *.apps.plataform.com nunca se usa el modo local. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var BOOL = { faqs: ['activa'], conversations: ['escalated'], feedback: ['util'] };
  var TABLES = ['faqs', 'faq_versions', 'config', 'conversations', 'messages', 'gaps', 'feedback', 'documents', 'audit_log', 'holidays'];

  function toBool(v) { return v === true || v === 1 || v === '1' || v === 'true'; }
  function normRow(table, r) {
    (BOOL[table] || []).forEach(function (k) { if (k in r) r[k] = toBool(r[k]); });
    return r;
  }
  function asList(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    if (body && Array.isArray(body.rows)) return body.rows;
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }
  function nowSql() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

  function ApiStore(fetchFn, base) {
    base = base || '/api/db';
    function call(method, path, body) {
      return fetchFn(base + path, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin'
      }).then(function (res) {
        if (res.status === 409) throw { kind: 'duplicate', status: 409 };
        if (!res.ok) throw { kind: 'http', status: res.status };
        return res.status === 204 ? null : res.json().catch(function () { return null; });
      });
    }
    return {
      mode: 'api',
      list: function (t) { return call('GET', '/' + t).then(function (b) { return asList(b).map(function (r) { return normRow(t, r); }); }); },
      create: function (t, row) { return call('POST', '/' + t, row).then(function (b) { var r = (b && (b.data || b.row)) || b || {}; return normRow(t, Object.assign({}, row, r)); }); },
      update: function (t, id, row) { return call('PUT', '/' + t + '/' + id, row).then(function () { return normRow(t, Object.assign({ id: id }, row)); }); },
      remove: function (t, id) { return call('DELETE', '/' + t + '/' + id); }
    };
  }

  function LocalStore(storage, key) {
    key = key || 'emi_console_dev_v1';
    function load() { try { return JSON.parse(storage.getItem(key)) || {}; } catch (e) { return {}; } }
    function save(db) { try { storage.setItem(key, JSON.stringify(db)); } catch (e) { /* almacenamiento lleno o bloqueado */ } }
    function tbl(db, t) { db[t] = db[t] || { seq: 0, rows: [] }; return db[t]; }
    return {
      mode: 'local',
      list: function (t) { var db = load(); return Promise.resolve(tbl(db, t).rows.map(function (r) { return normRow(t, Object.assign({}, r)); })); },
      create: function (t, row) {
        var db = load(), T = tbl(db, t);
        var r = Object.assign({}, row, { id: ++T.seq });
        if (t === 'audit_log' && !r.owner_email) r.owner_email = 'dev@local';
        T.rows.push(r); save(db); return Promise.resolve(Object.assign({}, r));
      },
      update: function (t, id, row) {
        var db = load(), T = tbl(db, t);
        T.rows = T.rows.map(function (r) { return r.id === id ? Object.assign({}, r, row, { id: id }) : r; });
        save(db); return Promise.resolve(Object.assign({ id: id }, row));
      },
      remove: function (t, id) { var db = load(), T = tbl(db, t); T.rows = T.rows.filter(function (r) { return r.id !== id; }); save(db); return Promise.resolve(null); },
      reset: function () { try { storage.removeItem(key); } catch (e) { /* ignore */ } }
    };
  }

  // Detecta el modo: en el dominio de producción siempre API; en otro entorno, API si responde.
  function connect(opts) {
    opts = opts || {};
    var fetchFn = opts.fetch || fetch.bind(null);
    var host = opts.hostname || (typeof location !== 'undefined' ? location.hostname : '');
    var api = ApiStore(fetchFn);
    if (/\.apps\.plataform\.com$/.test(host)) return Promise.resolve(api);
    return fetchFn('/api/db/config', { credentials: 'same-origin' }).then(function (r) {
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (r.ok && ct.indexOf('json') !== -1) return api;
      throw new Error('sin api');
    }).catch(function () { return LocalStore(opts.storage || localStorage); });
  }

  return { connect: connect, ApiStore: ApiStore, LocalStore: LocalStore, TABLES: TABLES, nowSql: nowSql, toBool: toBool };
});
