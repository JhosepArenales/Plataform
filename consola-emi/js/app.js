/* Consola de Emi — interfaz.
 * Toda la lógica de respuesta vive en js/engine (módulo puro); aquí solo se orquesta UI ↔ motor ↔ datos. */
(function () {
  'use strict';
  var E = window.EmiEngine, P = window.EmiParsers, S = window.EmiStore, H = window.EmiHolidays;
  var MK = window.EmiMock, R = window.EmiRemote, B = window.EmiBase;
  var CATS = E.CATEGORIAS;

  var app = {
    store: null, cfg: E.defaults(), cfgVersion: 0,
    faqs: [], gaps: [], holidays: [], convs: [], msgs: [], docs: [], feedback: [], audit: [], versions: null,
    view: 'playground', mode: 'mock', conv: null, selectedMsg: null, busy: false,
    kb: { q: '', cat: '', act: '' }, playInput: ''
  };

  // ───────────── Utilidades ─────────────
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function waFormat(s) {
    return esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+[^\s<.,;)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function now() { return S.nowSql(); }
  function hhmm(sql) { var d = sql ? new Date(String(sql).replace(' ', 'T') + (String(sql).indexOf('Z') === -1 && sql.length === 19 ? 'Z' : '')) : new Date(); return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); }
  function fmtDate(sql) { if (!sql) return ''; var d = new Date(String(sql).replace(' ', 'T') + (String(sql).length === 19 ? 'Z' : '')); return isNaN(d) ? sql : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); }
  function pct(x) { return isFinite(x) ? Math.round(x * 100) + ' %' : '—'; }
  function toast(msg, err) {
    var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
    $('#toast').appendChild(el); setTimeout(function () { el.remove(); }, err ? 6000 : 3200);
  }
  function fail(e, what) { console.error(e); toast('No se pudo ' + what + (e && e.status ? ' (HTTP ' + e.status + ')' : '') + '.', true); }
  function activeFaqs() { return app.faqs.filter(function (f) { return f.activa !== false; }); }
  function holidayDates() { return app.holidays.map(function (h) { return h.fecha; }); }

  function modal(title, body, actions) {
    var root = $('#modal-root');
    root.onclick = null;
    root.innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header><h2>' + esc(title) + '</h2><button class="btn ghost" data-close aria-label="Cerrar">✕</button></header>' +
      '<div class="body">' + body + '</div><footer></footer></div></div>';
    var foot = $('footer', root);
    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    (actions || [{ label: 'Cerrar' }]).forEach(function (a) {
      var b = document.createElement('button'); b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
      b.onclick = function () { if (!a.onClick) return close(); Promise.resolve(a.onClick($('.modal', root))).then(function (keep) { if (keep !== false) close(); }); };
      foot.appendChild(b);
    });
    $('[data-close]', root).onclick = close;
    $('.modal-back', root).addEventListener('mousedown', function (e) { if (e.target.classList.contains('modal-back')) close(); });
    return { el: $('.modal', root), close: close };
  }

  function audit(accion, objeto, detalle, resultado) {
    var row = { accion: accion, objeto: objeto, resultado: resultado || 'ok', detalle: E.maskText(typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {})).slice(0, 4000), created_at: now() };
    return app.store.create('audit_log', row).then(function (r) { app.audit.push(r); }).catch(function (e) { console.warn('audit', e); });
  }

  // ───────────── Datos ─────────────
  function latestConfig(rows) {
    var best = null;
    rows.forEach(function (r) { if (!best || (+r.version) > (+best.version)) best = r; });
    return best;
  }

  function load() {
    var T = ['faqs', 'config', 'gaps', 'holidays', 'conversations', 'messages', 'documents', 'feedback', 'audit_log'];
    return Promise.all(T.map(function (t) { return app.store.list(t).catch(function (e) { console.warn('list ' + t, e); return []; }); })).then(function (r) {
      app.faqs = r[0].sort(function (a, b) { return (a.base_id || 9999) - (b.base_id || 9999) || a.id - b.id; });
      var c = latestConfig(r[1]);
      if (c) { try { app.cfg = E.withDefaults(JSON.parse(c.payload)); app.cfgVersion = +c.version; } catch (e) { console.warn('config inválida', e); } }
      app.gaps = r[2]; app.holidays = r[3].sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      app.convs = r[4]; app.msgs = r[5]; app.docs = r[6]; app.feedback = r[7]; app.audit = r[8];
    });
  }

  // Carga inicial: FAQs base, festivos 2026–2027 y configuración v1 si las tablas están vacías.
  function seed() {
    var jobs = Promise.resolve();
    if (!app.faqs.length) {
      jobs = jobs.then(function () {
        toast('Cargando las ' + B.BASE_DEFAULT.length + ' FAQs base…');
        return B.BASE_DEFAULT.reduce(function (p, f) {
          return p.then(function () {
            return app.store.create('faqs', { base_id: f.id, pregunta: f.pregunta, respuesta: f.respuesta, categoria: f.categoria, keywords: f.keywords, fuente: B.BASE_SOURCE, activa: true, version: 1, updated_at: now() })
              .then(function (row) { app.faqs.push(row); });
          });
        }, Promise.resolve()).then(function () { return audit('seed_faqs', 'faqs', { version: B.BASE_VERSION, total: B.BASE_DEFAULT.length }); });
      });
    }
    if (!app.holidays.length) {
      jobs = jobs.then(function () {
        var list = H.colombianHolidays(2026).concat(H.colombianHolidays(2027));
        return list.reduce(function (p, h) { return p.then(function () { return app.store.create('holidays', h).then(function (r) { app.holidays.push(r); }).catch(function () {}); }); }, Promise.resolve())
          .then(function () { return audit('seed_holidays', 'holidays', { años: [2026, 2027], total: list.length }); });
      });
    }
    if (!app.cfgVersion) {
      jobs = jobs.then(function () {
        return app.store.create('config', { version: 1, payload: JSON.stringify(app.cfg), changed_at: now() }).then(function () { app.cfgVersion = 1; });
      });
    }
    return jobs;
  }

  function saveConfig(next, label) {
    var prev = app.cfg;
    var changed = Object.keys(next).filter(function (k) { return JSON.stringify(next[k]) !== JSON.stringify(prev[k]); });
    if (!changed.length) { toast('Sin cambios.'); return Promise.resolve(); }
    var v = app.cfgVersion + 1;
    return app.store.create('config', { version: v, payload: JSON.stringify(next), changed_at: now() }).then(function () {
      app.cfg = E.withDefaults(next); app.cfgVersion = v;
      var diff = {}; changed.forEach(function (k) { diff[k] = { antes: prev[k], despues: next[k] }; });
      audit('config_update', 'config', { version: v, seccion: label, cambios: diff });
      toast('Guardado · configuración v' + v);
      render();
    }).catch(function (e) { fail(e, 'guardar la configuración'); });
  }

  function saveFaq(f, data, accion) {
    var snapshot = JSON.stringify({ pregunta: f.pregunta, respuesta: f.respuesta, categoria: f.categoria, keywords: f.keywords, activa: f.activa, fuente: f.fuente });
    var version = (+f.version || 1) + 1;
    var row = Object.assign({}, data, { version: version, updated_at: now() });
    return app.store.create('faq_versions', { faq_id: f.id, version: +f.version || 1, snapshot: snapshot, changed_at: now() })
      .then(function () { return app.store.update('faqs', f.id, row); })
      .then(function () {
        Object.assign(f, row); app.versions = null;
        audit(accion || 'faq_update', 'faq:' + f.id, { base_id: f.base_id, campos: Object.keys(data) });
      });
  }

  function createFaq(data, fuente) {
    var row = { base_id: null, pregunta: data.pregunta.trim(), respuesta: data.respuesta.trim(), categoria: data.categoria || 'Otro', keywords: (data.keywords || '').trim(), fuente: fuente || 'Consola', activa: true, version: 1, updated_at: now() };
    return app.store.create('faqs', row).then(function (r) { app.faqs.push(r); audit('faq_create', 'faq:' + r.id, { fuente: row.fuente }); return r; });
  }

  function isDuplicate(pregunta) {
    var n = E.normalize(pregunta);
    return app.faqs.some(function (f) { return E.normalize(f.pregunta) === n; });
  }

  // ───────────── Adaptadores (Mock / Remoto) ─────────────
  var mockAdapters = { client: MK.clientLookup(), operation: MK.operationLookup(), escalation: MK.escalationSink() };
  var remote = R.createClient({
    onCall: function (c) { audit('consulta_n8n', c.path, { ok: c.ok, ms: c.ms, intentos: c.attempts, status: c.status || null }, c.ok ? 'ok' : 'error'); }
  });
  var remoteAdapters = { client: remote.clientLookup(), operation: remote.operationLookup(), escalation: remote.escalationSink() };
  function adapters() { return app.mode === 'remoto' ? remoteAdapters : mockAdapters; }

  // ───────────── Navegación ─────────────
  var NAV = [
    ['Operación', [['playground', 'Playground'], ['panel', 'Panel']]],
    ['Conocimiento', [['kb', 'Base de conocimiento'], ['docs', 'Documentos'], ['gaps', 'Preguntas sin respuesta']]],
    ['Ajustes', [['personalidad', 'Personalidad'], ['mensajes', 'Mensajes clave'], ['horario', 'Horario'], ['escalamiento', 'Escalamiento'], ['whatsapp', 'WhatsApp'], ['tema', 'Tema'], ['exportar', 'Exportar / Importar']]]
  ];
  var TITLES = {
    playground: ['Playground', 'Prueba a Emi como si fuera WhatsApp'], panel: ['Panel', 'Métricas calculadas desde las conversaciones'],
    kb: ['Base de conocimiento', 'Preguntas frecuentes que Emi usa para responder'], docs: ['Documentos', 'Carga archivos para alimentar la base'],
    gaps: ['Preguntas sin respuesta', 'Lo que Emi no supo responder'], personalidad: ['Personalidad', 'Cómo habla Emi'],
    mensajes: ['Mensajes clave', 'Textos fijos de Emi'], horario: ['Horario', 'Atención y festivos de Colombia'],
    escalamiento: ['Escalamiento', 'Cuándo pasa a un asesor'], whatsapp: ['WhatsApp', 'Canal de producción'],
    tema: ['Tema', 'Apariencia de la consola'], exportar: ['Exportar / Importar', 'Respaldo y auditoría']
  };

  function renderNav() {
    var open = app.gaps.filter(function (g) { return g.estado === 'abierta'; }).length;
    var pend = app.docs.filter(function (d) { return d.estado === 'pendiente'; }).length;
    $('#nav').innerHTML = NAV.map(function (g) {
      return '<div class="nav-group"><span>' + g[0] + '</span>' + g[1].map(function (it) {
        var c = it[0] === 'gaps' && open ? '<span class="count">' + open + '</span>' : it[0] === 'docs' && pend ? '<span class="count">' + pend + '</span>' : '';
        return '<button class="nav-item' + (app.view === it[0] ? ' active' : '') + '" data-nav="' + it[0] + '"' + (app.view === it[0] ? ' aria-current="page"' : '') + '>' + it[1] + c + '</button>';
      }).join('') + '</div>';
    }).join('');
  }

  function go(view) {
    app.view = view;
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* sin historial */ }
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    renderNav();
    var t = TITLES[app.view] || ['', ''];
    $('#view-title').textContent = t[0];
    $('#view-sub').textContent = t[1];
    $('#topbar-actions').innerHTML = '<span class="badge ' + (app.store && app.store.mode === 'api' ? 'ok' : 'warn') + '">' + (app.store && app.store.mode === 'api' ? 'Base de datos' : 'Modo local') + '</span>' +
      '<span class="badge">Config v' + app.cfgVersion + '</span><span class="badge">' + activeFaqs().length + ' FAQs activas</span>';
    var V = VIEWS[app.view] || VIEWS.playground;
    var root = $('#view');
    root.onclick = null; root.onchange = null;
    root.innerHTML = V.html();
    if (V.mount) V.mount($('#view'));
  }

  // ───────────── Vistas ─────────────
  var VIEWS = {};

  // Playground
  function newConversation() {
    app.conv = { dbId: null, state: E.newState(), items: [], mode: app.mode };
    app.selectedMsg = null;
  }

  function ensureConvRow() {
    if (app.conv.dbId) return Promise.resolve(app.conv.dbId);
    var row = { channel: 'playground', mode: app.mode, client_ref_masked: null, escalated: false, escalation_reason: null, ticket_id: null, started_at: now(), last_at: now() };
    return app.store.create('conversations', row).then(function (r) { app.conv.dbId = r.id; app.convs.push(r); return r.id; });
  }

  function sendMessage(text) {
    text = String(text || '').trim();
    if (!text || app.busy) return;
    app.busy = true;
    var conv = app.conv;
    var masked = E.maskText(text);
    conv.items.push({ role: 'user', text: text, at: now() });
    paintChat(true);
    ensureConvRow().then(function (cid) {
      app.store.create('messages', { conversation_id: cid, role: 'user', text: masked, created_at: now() }).then(function (r) { app.msgs.push(r); }).catch(function () {});
      return E.respond(text, conv.state, {
        config: app.cfg, faqs: activeFaqs(), holidays: holidayDates(), now: new Date(),
        conversationId: 'consola-' + cid, adapters: adapters()
      }).then(function (res) { return { cid: cid, res: res }; });
    }).then(function (x) {
      var res = x.res, cid = x.cid;
      conv.state = res.state;
      var delay = Math.min(900, 250 + res.replies.join(' ').length * 2);
      return new Promise(function (ok) { setTimeout(ok, delay); }).then(function () {
        var faq = res.debug.faqId ? app.faqs.filter(function (f) { return (f.base_id || f.id) === res.debug.faqId; })[0] : null;
        var saves = res.replies.map(function (r, i) {
          var item = { role: 'bot', text: r, at: now(), debug: i === res.replies.length - 1 ? res.debug : null, msgId: null };
          conv.items.push(item);
          return app.store.create('messages', {
            conversation_id: cid, role: 'bot', text: E.maskText(r), intent: res.debug.intencion, tipo: res.debug.tipo,
            faq_id: res.debug.faqId, categoria: faq ? faq.categoria : null, confidence: res.debug.confianza, latency_ms: res.debug.latencyMs, created_at: now()
          }).then(function (row) { item.msgId = row.id; app.msgs.push(row); }).catch(function () {});
        });
        if (res.debug) app.selectedMsg = conv.items.length - 1;
        if (res.gap) {
          saves.push(app.store.create('gaps', { pregunta: res.gap.pregunta, score: res.gap.score, faq_sugerida: res.gap.faqSugerida, estado: 'abierta', faq_id: null, conversation_id: cid, created_at: now() })
            .then(function (g) { app.gaps.push(g); renderNav(); }).catch(function () {}));
        }
        var convRow = app.convs.filter(function (c) { return c.id === cid; })[0];
        var upd = { last_at: now() };
        if (res.state.cliente && res.state.cliente.ref) upd.client_ref_masked = res.state.cliente.ref;
        if (res.escalation && res.escalation.ticketId && !(convRow && convRow.escalated)) {
          upd.escalated = true; upd.escalation_reason = res.escalation.motivo; upd.ticket_id = String(res.escalation.ticketId);
          audit('escalamiento', 'conversation:' + cid, res.escalation);
          conv.items.push({ role: 'sys', text: 'Escalado a asesor · ticket ' + res.escalation.ticketId + (res.escalation.fueraHorario ? ' · contactar el próximo día hábil' : '') + (app.mode === 'mock' ? ' (simulado)' : '') });
        }
        if (convRow) Object.assign(convRow, upd);
        saves.push(app.store.update('conversations', cid, Object.assign({}, convRow || {}, upd)).catch(function () {}));
        return Promise.all(saves);
      });
    }).catch(function (e) {
      console.error(e);
      conv.items.push({ role: 'sys', text: 'Error interno del motor: ' + (e && e.message || e) });
    }).then(function () {
      app.busy = false;
      if (app.view === 'playground' && app.conv === conv) { paintChat(false); paintDebug(); }
    });
  }

  function paintChat(typing) {
    var el = $('#chat'); if (!el) return;
    el.innerHTML = (app.conv.items.length ? '' : '<div class="msg sys">Escribe un mensaje o usa una sugerencia. Modo: <b>' + (app.mode === 'mock' ? 'Mock (datos de prueba)' : 'Remoto (n8n)') + '</b></div>') +
      app.conv.items.map(function (m, i) {
        if (m.role === 'sys') return '<div class="msg sys">' + esc(m.text) + '</div>';
        if (m.role === 'user') return '<div class="msg out">' + esc(m.text) + '<span class="time">' + hhmm(m.at) + ' ✓✓</span></div>';
        var fbRow = m.msgId ? app.feedback.filter(function (f) { return f.message_id === m.msgId; })[0] : null;
        var fb = m.msgId ? '<span class="fb"><button data-fb="1" data-i="' + i + '" class="' + (fbRow && fbRow.util ? 'on' : '') + '" title="Respuesta útil" aria-label="Respuesta útil">👍</button><button data-fb="0" data-i="' + i + '" class="' + (fbRow && !fbRow.util ? 'on' : '') + '" title="Respuesta no útil" aria-label="Respuesta no útil">👎</button></span>' : '';
        return '<div class="msg in' + (m.debug ? ' clickable' : '') + (app.selectedMsg === i ? ' selected' : '') + '" data-i="' + i + '">' + waFormat(m.text) + '<span class="time">' + fb + hhmm(m.at) + '</span></div>';
      }).join('') + (typing ? '<div class="typing" aria-label="Emi está escribiendo"><i></i><i></i><i></i></div>' : '');
    el.scrollTop = el.scrollHeight;
  }

  function paintDebug() {
    var el = $('#debug'); if (!el) return;
    var m = app.selectedMsg != null ? app.conv.items[app.selectedMsg] : null;
    var d = m && m.debug;
    if (!d) { el.innerHTML = '<p class="muted small">Selecciona una respuesta de Emi para ver cómo la decidió.</p>'; return; }
    var esc_ = d.escalamiento;
    var conf = d.confianza == null ? '—' : (+d.confianza).toFixed(3);
    var confCls = d.confianza == null ? '' : d.confianza >= 0.6 ? 'ok' : d.confianza >= app.cfg.threshold ? 'warn' : 'danger';
    el.innerHTML = '<dl class="kv">' +
      '<dt>Intención</dt><dd>' + esc(d.intencion || '—') + '</dd>' +
      '<dt>Tipo</dt><dd>' + esc(d.tipo || '—') + '</dd>' +
      '<dt>FAQ fuente</dt><dd>' + (d.faqId ? '#' + d.faqId + ' · ' + esc(d.faqPregunta || '') : '—') + '</dd>' +
      '<dt>Origen</dt><dd>' + esc(d.origen || '—') + (d.error ? ' <span class="badge danger">' + esc(d.error) + '</span>' : '') + (d.detalle ? '<div class="small" style="color:var(--danger)">' + esc(d.detalle) + '</div>' : '') + '</dd>' +
      '<dt>Confianza</dt><dd><span class="badge ' + confCls + '">' + conf + '</span> <span class="muted">umbral ' + app.cfg.threshold + '</span></dd>' +
      '<dt>Escalamiento</dt><dd>' + (esc_ ? esc(esc_.motivo) + ' · ticket ' + esc(esc_.ticketId || ('error' + (esc_.detalle ? ': ' + esc_.detalle : ''))) + (esc_.created ? ' (nuevo)' : ' (existente)') + (esc_.fueraHorario ? ' · fuera de horario' : '') : 'no') + '</dd>' +
      '<dt>Cliente</dt><dd>' + (d.cliente ? esc(d.cliente.ref + ' · ' + d.cliente.estado) : '—') + '</dd>' +
      '<dt>Latencia</dt><dd>' + (d.latencyMs != null ? d.latencyMs + ' ms' : '—') + '</dd>' +
      '</dl>' +
      (d.candidatos && d.candidatos.length ? '<h3 style="margin:14px 0 6px">Candidatos</h3><table><tbody>' + d.candidatos.map(function (c) {
        var f = app.faqs.filter(function (x) { return (x.base_id || x.id) === c.id; })[0];
        return '<tr><td class="mono">#' + c.id + '</td><td class="small">' + esc(f ? f.pregunta : '') + '</td><td class="mono">' + c.score.toFixed(3) + '</td></tr>';
      }).join('') + '</tbody></table>' : '');
  }

  VIEWS.playground = {
    html: function () {
      if (!app.conv) newConversation();
      var sug = ['Hola', 'menú', '¿Cuál es el monto mínimo para invertir?', 'Estado de la operación 6543', 'Quiero hablar con un asesor', 'Tengo una queja'];
      return '<div class="play"><div class="phone">' +
        '<div class="phone-head"><span class="avatar">' + esc(app.cfg.nombre.charAt(0)) + '</span><div><b>' + esc(app.cfg.nombre) + ' · Mesfix</b><small>' + (E.isOpen(new Date(), app.cfg.horario, holidayDates()) ? 'En horario de atención' : 'Fuera de horario · ' + esc(E.nextOpenText(new Date(), app.cfg.horario, holidayDates()))) + '</small></div></div>' +
        '<div class="chat" id="chat"></div>' +
        '<div class="chips">' + sug.map(function (s) { return '<button class="chip" data-say="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<form class="composer" id="composer"><input type="text" id="msg" placeholder="Escribe un mensaje" autocomplete="off" aria-label="Mensaje" value="' + esc(app.playInput) + '"><button class="btn primary" type="submit">Enviar</button></form>' +
        '</div><div class="side">' +
        '<div class="card"><div class="card-head"><h3>Fuente de datos</h3></div><div class="seg" role="group" aria-label="Fuente de datos">' +
        '<button data-mode="mock" class="' + (app.mode === 'mock' ? 'on' : '') + '">Mock</button><button data-mode="remoto" class="' + (app.mode === 'remoto' ? 'on' : '') + '">Remoto (n8n)</button></div>' +
        '<p class="small muted" style="margin:10px 0 0">' + (app.mode === 'mock' ? 'Documentos: 79378202 · 1032416400 · 79491944 · 900876543.<br>Operaciones: 7981 (NIT 900111222) · 6543 y 13058 (NIT 900333444).' : 'Consulta Metabase/HubSpot a través de los webhooks de n8n. Si n8n aún no está configurado, Emi responderá que no tiene información suficiente.') + '</p>' +
        '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="new-conv">Nueva conversación</button>' + (app.mode === 'remoto' ? '<button class="btn sm" data-act="ping">Probar conexión n8n</button>' : '') + '</div>' +
        (app.mode === 'remoto' ? '<div id="ping" class="small" style="margin-top:10px"></div><p class="small" style="margin:8px 0 0;color:var(--warn)">En modo Remoto un escalamiento crea un ticket real en HubSpot.</p>' : '') + '</div>' +
        '<div class="card"><h3>Debug de la respuesta</h3><div id="debug"></div></div></div></div>';
    },
    mount: function (root) {
      paintChat(false); paintDebug();
      var input = $('#msg', root);
      input.focus();
      input.oninput = function () { app.playInput = input.value; };
      $('#composer', root).onsubmit = function (e) { e.preventDefault(); var v = input.value; input.value = ''; app.playInput = ''; sendMessage(v); };
      root.onclick = function (e) {
        var t = e.target.closest('[data-say],[data-mode],[data-act],[data-fb],.msg.in');
        if (!t) return;
        if (t.dataset.say) return sendMessage(t.dataset.say);
        if (t.dataset.mode) { if (app.mode !== t.dataset.mode) { app.mode = t.dataset.mode; newConversation(); render(); } return; }
        if (t.dataset.act === 'new-conv') { newConversation(); render(); return; }
        if (t.dataset.act === 'ping') { pingN8n(); return; }
        if (t.dataset.fb) {
          e.stopPropagation();
          var item = app.conv.items[+t.dataset.i];
          if (!item || !item.msgId || app.feedback.some(function (f) { return f.message_id === item.msgId; })) return;
          app.store.create('feedback', { message_id: item.msgId, util: t.dataset.fb === '1', comentario: null, created_at: now() })
            .then(function (r) { app.feedback.push(r); paintChat(false); }).catch(function (er) { fail(er, 'guardar el feedback'); });
          return;
        }
        if (t.classList.contains('msg')) { var i = +t.dataset.i; if (app.conv.items[i] && app.conv.items[i].debug) { app.selectedMsg = i; paintChat(false); paintDebug(); } }
      };
    }
  };

  // Diagnóstico: llama a los webhooks de consulta (no al de tickets) y muestra la respuesta tal cual.
  function pingN8n() {
    var el = $('#ping'); if (!el) return;
    var checks = [
      ['client-lookup', { documento: '1000000' }],
      ['operation-lookup', { numero_operacion: '1', empresa: 'prueba de conexion' }]
    ];
    el.innerHTML = '<span class="muted">Probando…</span>';
    Promise.all(checks.map(function (c) {
      var t0 = Date.now();
      return fetch(R.DEFAULTS.base + '/' + c[0], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c[1]) })
        .then(function (r) { return r.text().then(function (txt) { return { name: c[0], status: r.status, body: txt, ms: Date.now() - t0 }; }); })
        .catch(function (e) { return { name: c[0], status: 0, body: String(e.message || e), ms: Date.now() - t0 }; });
    })).then(function (rs) {
      el.innerHTML = rs.map(function (r) {
        var j = null; try { j = JSON.parse(r.body); } catch (e) { /* no es JSON */ }
        var ok = r.status === 200 && j && !j.error;
        var cfg = r.status === 200 && j && j.error === 'not_configured';
        var label = ok ? ['ok', 'Conectado'] : cfg ? ['warn', 'Conectado · falta configurar'] : r.status === 403 ? ['danger', 'Secreto incorrecto (403)'] : r.status === 404 ? ['danger', 'Flujo no activo o ruta errada (404)'] : r.status === 502 ? ['danger', 'n8n inalcanzable'] : ['danger', 'Error ' + r.status];
        return '<div style="margin-bottom:8px"><b class="mono">' + r.name + '</b> <span class="badge ' + label[0] + '">' + label[1] + '</span> <span class="muted">' + r.ms + ' ms</span>' +
          '<div class="mono" style="word-break:break-word;color:var(--ink-3)">' + esc(r.body.slice(0, 300)) + '</div></div>';
      }).join('');
      audit('ping_n8n', 'n8n', rs.map(function (r) { return { flujo: r.name, status: r.status, ms: r.ms }; }));
    });
  }

  // Panel
  function p95(list) { if (!list.length) return null; var s = list.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; }
  VIEWS.panel = {
    html: function () {
      var convs = app.convs, total = convs.length;
      var esc_ = convs.filter(function (c) { return c.escalated; }).length;
      var userMsgs = app.msgs.filter(function (m) { return m.role === 'user'; }).length;
      var bot = app.msgs.filter(function (m) { return m.role === 'bot'; });
      var gapsN = app.gaps.length;
      var lat = bot.map(function (m) { return +m.latency_ms; }).filter(function (x) { return isFinite(x) && x >= 0; });
      var p = p95(lat);
      var faqAns = bot.filter(function (m) { return m.tipo === 'faq' && m.confidence != null; });
      var avgConf = faqAns.length ? faqAns.reduce(function (a, m) { return a + (+m.confidence); }, 0) / faqAns.length : null;
      var fbOk = app.feedback.filter(function (f) { return f.util; }).length;
      var n8n = app.audit.filter(function (a) { return a.accion === 'consulta_n8n'; });
      var n8nOk = n8n.filter(function (a) { return a.resultado === 'ok'; }).length;
      var tickets = {}; convs.forEach(function (c) { if (c.ticket_id) tickets[c.ticket_id] = (tickets[c.ticket_id] || 0) + 1; });
      var dupConvs = 0; // una conversación guarda un solo ticket_id; se cuenta si un mismo ticket quedó en >1 conversación
      Object.keys(tickets).forEach(function (k) { if (tickets[k] > 1) dupConvs++; });

      var KPIS = [
        ['Resolución sin asesor', 'conversaciones sin escalar ÷ conversaciones', total ? (total - esc_) / total : NaN, '≥ 60 %', function (v) { return v >= 0.6; }, pct],
        ['Preguntas sin respuesta', 'gaps ÷ mensajes de usuario', userMsgs ? gapsN / userMsgs : NaN, '≤ 10 %', function (v) { return v <= 0.1; }, pct],
        ['Éxito de consultas n8n/HubSpot', 'consultas OK ÷ consultas', n8n.length ? n8nOk / n8n.length : NaN, '≥ 99 %', function (v) { return v >= 0.99; }, pct],
        ['Latencia p95 del motor', 'p95 de latency_ms', p == null ? NaN : p, '≤ 3 s', function (v) { return v <= 3000; }, function (v) { return isFinite(v) ? v + ' ms' : '—'; }],
        ['Tickets duplicados', 'tickets en más de una conversación', total ? dupConvs : NaN, '0', function (v) { return v === 0; }, function (v) { return isFinite(v) ? String(v) : '—'; }]
      ];

      var cats = CATS.map(function (c) {
        var act = app.faqs.filter(function (f) { return f.categoria === c && f.activa !== false; }).length;
        var used = bot.filter(function (m) { return m.categoria === c; }).length;
        return { c: c, act: act, used: used };
      });
      var maxAct = Math.max.apply(null, cats.map(function (x) { return x.act; }).concat([1]));
      var recent = app.msgs.filter(function (m) { return m.role === 'user'; }).slice(-8).reverse();
      var intentByConv = {};
      app.msgs.forEach(function (m) { if (m.role === 'bot' && m.intent) intentByConv[m.conversation_id + ':' + m.id] = m; });

      return '<div class="grid grid-4">' +
        stat('Conversaciones', total, esc_ + ' escaladas') +
        stat('Mensajes de usuario', userMsgs, gapsN + ' sin respuesta') +
        stat('Confianza promedio', avgConf == null ? '—' : avgConf.toFixed(2), faqAns.length + ' respuestas FAQ') +
        stat('Utilidad (👍)', app.feedback.length ? pct(fbOk / app.feedback.length) : '—', app.feedback.length + ' valoraciones') +
        '</div>' +
        '<div class="card" style="margin-top:16px"><div class="card-head"><h2>Indicadores</h2><span class="small muted">Se calculan con los datos guardados</span></div><div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Fórmula</th><th>Actual</th><th>Meta</th><th>Estado</th></tr></thead><tbody>' +
        KPIS.map(function (k) {
          var v = k[2], has = isFinite(v);
          return '<tr><td><b>' + k[0] + '</b></td><td class="small muted">' + k[1] + '</td><td class="mono">' + k[5](v) + '</td><td class="mono">' + k[3] + '</td><td>' + (has ? (k[4](v) ? '<span class="badge ok">En meta</span>' : '<span class="badge danger">Fuera de meta</span>') : '<span class="badge">Sin datos</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<div class="grid grid-2" style="margin-top:16px">' +
        '<div class="card"><div class="card-head"><h2>Cobertura por categoría</h2><span class="small muted">FAQs activas · respuestas dadas</span></div>' +
        cats.map(function (x) { return '<div class="bar-row"><span>' + esc(x.c) + '</span><div class="bar"><i style="width:' + Math.round(x.act / maxAct * 100) + '%"></i></div><span class="mono small">' + x.act + ' · ' + x.used + '</span></div>'; }).join('') + '</div>' +
        '<div class="card"><div class="card-head"><h2>Actividad reciente</h2></div>' +
        (recent.length ? '<table><tbody>' + recent.map(function (m) {
          var reply = app.msgs.filter(function (b) { return b.role === 'bot' && b.conversation_id === m.conversation_id && b.id > m.id; })[0];
          return '<tr><td class="small">' + esc(m.text).slice(0, 90) + '</td><td>' + (reply ? '<span class="badge ' + (reply.tipo === 'gap' ? 'warn' : reply.tipo === 'escalamiento' ? 'info' : 'ok') + '">' + esc(reply.intent || reply.tipo) + '</span>' : '') + '</td><td class="small muted">' + fmtDate(m.created_at) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">Aún no hay conversaciones. Prueba a Emi en el Playground.</div>') + '</div></div>';
    }
  };
  function stat(label, value, meta) { return '<div class="card stat"><div class="label">' + label + '</div><div class="value">' + esc(value) + '</div><div class="meta muted">' + esc(meta) + '</div></div>'; }

  // Base de conocimiento
  function faqForm(f) {
    f = f || { pregunta: '', respuesta: '', categoria: 'Otro', keywords: '', fuente: 'Consola' };
    return '<label class="field"><span>Pregunta</span><input type="text" name="pregunta" value="' + esc(f.pregunta) + '" required></label>' +
      '<label class="field"><span>Respuesta</span><textarea name="respuesta" rows="6" required>' + esc(f.respuesta) + '</textarea><small>Formato WhatsApp: *negrilla*. Evita datos personales.</small></label>' +
      '<div class="grid grid-2"><label class="field"><span>Categoría</span><select name="categoria">' + CATS.map(function (c) { return '<option' + (c === f.categoria ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Fuente</span><input type="text" name="fuente" value="' + esc(f.fuente || '') + '"></label></div>' +
      '<label class="field"><span>Palabras clave</span><textarea name="keywords" rows="2">' + esc(f.keywords || '') + '</textarea><small>Formas en que los clientes lo preguntan, separadas por coma.</small></label>';
  }
  function readForm(el) {
    var o = {}; el.querySelectorAll('[name]').forEach(function (i) { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; }); return o;
  }

  VIEWS.kb = {
    html: function () {
      var k = app.kb, nq = E.normalize(k.q);
      var list = app.faqs.filter(function (f) {
        if (k.cat && f.categoria !== k.cat) return false;
        if (k.act === 'on' && f.activa === false) return false;
        if (k.act === 'off' && f.activa !== false) return false;
        if (nq && E.normalize(f.pregunta + ' ' + f.respuesta + ' ' + f.keywords).indexOf(nq) === -1) return false;
        return true;
      });
      return '<div class="card"><div class="card-head"><div class="row" style="flex:1">' +
        '<input type="search" id="kb-q" placeholder="Buscar en preguntas, respuestas y palabras clave" value="' + esc(k.q) + '" style="max-width:360px">' +
        '<select id="kb-cat" style="max-width:220px"><option value="">Todas las categorías</option>' + CATS.map(function (c) { return '<option' + (c === k.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
        '<select id="kb-act" style="max-width:160px"><option value="">Todas</option><option value="on"' + (k.act === 'on' ? ' selected' : '') + '>Activas</option><option value="off"' + (k.act === 'off' ? ' selected' : '') + '>Inactivas</option></select>' +
        '</div><button class="btn primary" data-act="new">+ Nueva FAQ</button></div>' +
        '<p class="small muted" style="margin:0 0 8px">' + list.length + ' de ' + app.faqs.length + ' FAQs · base ' + esc(B.BASE_VERSION) + '</p>' +
        '<div class="table-wrap"><table><thead><tr><th>N°</th><th>Pregunta</th><th>Categoría</th><th>Activa</th><th></th></tr></thead><tbody>' +
        (list.length ? list.map(function (f) {
          return '<tr><td class="mono">' + (f.base_id || '—') + '</td><td><b>' + esc(f.pregunta) + '</b><div class="small muted">' + esc(String(f.respuesta).slice(0, 140)) + (f.respuesta.length > 140 ? '…' : '') + '</div></td>' +
            '<td><span class="badge">' + esc(f.categoria) + '</span></td>' +
            '<td><label class="switch" title="Activar o desactivar"><input type="checkbox" data-toggle="' + f.id + '"' + (f.activa !== false ? ' checked' : '') + ' aria-label="Activa"><i></i></label></td>' +
            '<td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-edit="' + f.id + '">Editar</button><button class="btn sm ghost" data-hist="' + f.id + '">Historial</button><button class="btn sm ghost" data-try="' + f.id + '">Probar</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="empty">No hay FAQs con esos filtros.</td></tr>') + '</tbody></table></div></div>';
    },
    mount: function (root) {
      var q = $('#kb-q', root), deb;
      q.oninput = function () { clearTimeout(deb); deb = setTimeout(function () { app.kb.q = q.value; render(); var n = $('#kb-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 220); };
      $('#kb-cat', root).onchange = function (e) { app.kb.cat = e.target.value; render(); };
      $('#kb-act', root).onchange = function (e) { app.kb.act = e.target.value; render(); };
      root.onchange = function (e) {
        var id = e.target.dataset.toggle; if (!id) return;
        var f = app.faqs.filter(function (x) { return String(x.id) === id; })[0];
        saveFaq(f, { activa: e.target.checked }, e.target.checked ? 'faq_activar' : 'faq_desactivar').then(function () { toast(e.target.checked ? 'FAQ activada' : 'FAQ desactivada'); render(); }).catch(function (er) { fail(er, 'actualizar la FAQ'); });
      };
      root.onclick = function (e) {
        var t = e.target.closest('[data-act],[data-edit],[data-hist],[data-try]'); if (!t) return;
        if (t.dataset.act === 'new') return editFaq(null);
        var id = t.dataset.edit || t.dataset.hist || t.dataset.try;
        var f = app.faqs.filter(function (x) { return String(x.id) === id; })[0];
        if (t.dataset.edit) editFaq(f);
        else if (t.dataset.hist) showHistory(f);
        else { app.playInput = f.pregunta; newConversation(); go('playground'); }
      };
    }
  };

  function editFaq(f, prefill, onSaved) {
    modal(f ? 'Editar FAQ' + (f.base_id ? ' #' + f.base_id : '') : 'Nueva FAQ', faqForm(f || prefill), [
      { label: 'Cancelar' },
      { label: 'Guardar', cls: 'primary', onClick: function (el) {
        var d = readForm(el);
        if (!d.pregunta.trim() || !d.respuesta.trim()) { toast('La pregunta y la respuesta son obligatorias.', true); return false; }
        if (!f && isDuplicate(d.pregunta)) { toast('Ya existe una FAQ con esa pregunta.', true); return false; }
        var p = f ? saveFaq(f, { pregunta: d.pregunta.trim(), respuesta: d.respuesta.trim(), categoria: d.categoria, keywords: d.keywords.trim(), fuente: d.fuente.trim() }) : createFaq(d, d.fuente || 'Consola');
        return p.then(function (r) { toast('FAQ guardada'); if (onSaved) return onSaved(r || f); render(); }).catch(function (er) { fail(er, 'guardar la FAQ'); return false; });
      } }
    ]);
  }

  function showHistory(f) {
    var get = app.versions ? Promise.resolve(app.versions) : app.store.list('faq_versions').then(function (v) { app.versions = v; return v; });
    get.then(function (all) {
      var rows = all.filter(function (v) { return v.faq_id === f.id; }).sort(function (a, b) { return b.version - a.version; });
      modal('Historial · ' + f.pregunta, rows.length ? rows.map(function (v) {
        var s = {}; try { s = JSON.parse(v.snapshot); } catch (e) { /* snapshot ilegible */ }
        return '<div class="draft"><div class="row" style="justify-content:space-between"><b>Versión ' + v.version + '</b><span class="small muted">reemplazada el ' + fmtDate(v.changed_at) + '</span></div>' +
          '<p style="margin:6px 0"><b>' + esc(s.pregunta) + '</b></p><p class="small" style="margin:0;white-space:pre-wrap">' + esc(s.respuesta) + '</p>' +
          '<p class="small muted" style="margin:6px 0 0">' + esc(s.categoria) + ' · ' + (s.activa === false ? 'inactiva' : 'activa') + '</p>' +
          '<button class="btn sm" style="margin-top:8px" data-restore="' + v.id + '">Restaurar esta versión</button></div>';
      }).join('') : '<p class="muted">Esta FAQ no tiene cambios todavía. Versión actual: ' + (f.version || 1) + '.</p>');
      $('#modal-root').onclick = function (e) {
        var b = e.target.closest('[data-restore]'); if (!b) return;
        var v = rows.filter(function (x) { return String(x.id) === b.dataset.restore; })[0], s = JSON.parse(v.snapshot);
        saveFaq(f, { pregunta: s.pregunta, respuesta: s.respuesta, categoria: s.categoria, keywords: s.keywords, activa: s.activa !== false }, 'faq_restaurar')
          .then(function () { $('#modal-root').innerHTML = ''; $('#modal-root').onclick = null; toast('Versión restaurada'); render(); }).catch(function (er) { fail(er, 'restaurar'); });
      };
    }).catch(function (e) { fail(e, 'cargar el historial'); });
  }

  // Documentos
  function importFaqs(list, fuente) {
    var added = 0, skipped = 0;
    return list.reduce(function (p, f) {
      return p.then(function () {
        if (isDuplicate(f.pregunta)) { skipped++; return null; }
        return createFaq(f, fuente).then(function () { added++; });
      });
    }, Promise.resolve()).then(function () { return { added: added, skipped: skipped }; });
  }

  function handleFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var base = { nombre: file.name, tipo: ext, created_at: now(), faqs_incorporadas: 0, draft_faqs: null };
    if (ext === 'csv' || ext === 'txt') {
      return file.text().then(function (txt) {
        var r = ext === 'csv' ? P.csvToFaqs(txt) : P.textToFaqs(txt);
        if (!r.faqs.length) { toast(r.errors[0] || 'No se encontraron FAQs en el archivo.', true); return; }
        return importFaqs(r.faqs, file.name).then(function (s) {
          return app.store.create('documents', Object.assign(base, { estado: 'incorporado', faqs_incorporadas: s.added })).then(function (d) {
            app.docs.push(d);
            audit('documento_incorporado', 'document:' + d.id, { nombre: file.name, nuevas: s.added, duplicadas: s.skipped, errores: r.errors.length });
            toast(s.added + ' FAQs incorporadas' + (s.skipped ? ' · ' + s.skipped + ' duplicadas omitidas' : '') + (r.errors.length ? ' · ' + r.errors.length + ' filas con error' : ''));
            render();
          });
        });
      });
    }
    if (ext === 'docx' || ext === 'xlsx') {
      return file.arrayBuffer().then(function (buf) { return P.extractOffice(buf, ext); }).then(function (r) {
        return app.store.create('documents', Object.assign(base, { estado: 'pendiente', draft_faqs: JSON.stringify(r.faqs) })).then(function (d) {
          app.docs.push(d);
          audit('documento_cargado', 'document:' + d.id, { nombre: file.name, borradores: r.faqs.length });
          toast(r.faqs.length + ' borradores listos para revisión');
          render(); reviewDoc(d);
        });
      }).catch(function (e) { fail(e, 'leer el archivo ' + file.name); });
    }
    if (ext === 'pdf') {
      return app.store.create('documents', Object.assign(base, { estado: 'pendiente_extraccion' })).then(function (d) {
        app.docs.push(d);
        toast('PDF registrado. La extracción de PDF queda para n8n; por ahora copia el texto en un .txt.', true);
        render();
      });
    }
    toast('Formato no soportado: .' + ext, true);
    return Promise.resolve();
  }

  function reviewDoc(d) {
    var drafts = []; try { drafts = JSON.parse(d.draft_faqs) || []; } catch (e) { /* vacío */ }
    var m = modal('Revisión · ' + d.nombre, drafts.length ? '<p class="small muted" style="margin-top:0">Revisa y corrige cada borrador. Solo se incorporan los marcados.</p>' + drafts.map(function (f, i) {
      var dup = isDuplicate(f.pregunta);
      return '<div class="draft' + (dup ? ' off' : '') + '" data-i="' + i + '"><label class="check"><input type="checkbox" name="ok"' + (dup ? '' : ' checked') + '> Incorporar ' + (dup ? '<span class="badge warn">ya existe</span>' : '') + '</label>' +
        '<label class="field"><span>Pregunta</span><input type="text" name="pregunta" value="' + esc(f.pregunta) + '"></label>' +
        '<label class="field"><span>Respuesta</span><textarea name="respuesta" rows="3">' + esc(f.respuesta) + '</textarea></label>' +
        '<div class="grid grid-2"><label class="field"><span>Categoría</span><select name="categoria">' + CATS.map(function (c) { return '<option' + (c === f.categoria ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>Palabras clave</span><input type="text" name="keywords" value="' + esc(f.keywords || '') + '"></label></div></div>';
    }).join('') : '<p>No se encontraron borradores en este documento.</p>', [
      { label: 'Rechazar documento', cls: 'danger', onClick: function () {
        return app.store.update('documents', d.id, Object.assign({}, d, { estado: 'rechazado' })).then(function () { d.estado = 'rechazado'; audit('documento_rechazado', 'document:' + d.id, { nombre: d.nombre }); render(); });
      } },
      { label: 'Cerrar' },
      { label: 'Aprobar e incorporar', cls: 'primary', onClick: function (el) {
        var sel = Array.prototype.map.call(el.querySelectorAll('.draft'), function (x) { return readForm(x); }).filter(function (x) { return x.ok && x.pregunta.trim() && x.respuesta.trim(); });
        if (!sel.length) { toast('No hay borradores marcados.', true); return false; }
        return importFaqs(sel, d.nombre).then(function (s) {
          return app.store.update('documents', d.id, Object.assign({}, d, { estado: 'aprobado', faqs_incorporadas: s.added })).then(function () {
            d.estado = 'aprobado'; d.faqs_incorporadas = s.added;
            audit('documento_aprobado', 'document:' + d.id, { nombre: d.nombre, incorporadas: s.added });
            toast(s.added + ' FAQs incorporadas'); render();
          });
        }).catch(function (er) { fail(er, 'incorporar'); return false; });
      } }
    ]);
    return m;
  }

  VIEWS.docs = {
    html: function () {
      var ESTADOS = { incorporado: ['ok', 'Incorporado'], aprobado: ['ok', 'Aprobado'], pendiente: ['warn', 'Pendiente de revisión'], pendiente_extraccion: ['info', 'Extracción pendiente (n8n)'], rechazado: ['danger', 'Rechazado'] };
      var docs = app.docs.slice().reverse();
      return '<div class="card"><div class="card-head"><h2>Cargar documento</h2></div>' +
        '<label class="drop" id="drop"><input type="file" id="file" accept=".csv,.txt,.docx,.xlsx,.pdf" multiple hidden>' +
        '<b>Arrastra archivos aquí o haz clic para elegir</b><br><span class="small">CSV y TXT se incorporan de inmediato (omitiendo duplicados). DOCX y XLSX generan borradores que requieren aprobación. PDF: extracción pendiente en n8n.</span></label>' +
        '<p class="small muted" style="margin:10px 0 0">CSV/XLSX: columnas <code>Pregunta</code>, <code>Respuesta</code>, <code>Categoría</code>, <code>Palabras clave</code> (el mismo formato del Sheet). TXT/DOCX: líneas <code>P: …</code> / <code>R: …</code> o preguntas que terminan en "?".</p></div>' +
        '<div class="card"><div class="card-head"><h2>Historial</h2></div>' + (docs.length ? '<div class="table-wrap"><table><thead><tr><th>Documento</th><th>Tipo</th><th>Estado</th><th>FAQs</th><th>Fecha</th><th></th></tr></thead><tbody>' + docs.map(function (d) {
          var e = ESTADOS[d.estado] || ['', d.estado];
          return '<tr><td>' + esc(d.nombre) + '</td><td class="mono">' + esc(d.tipo) + '</td><td><span class="badge ' + e[0] + '">' + e[1] + '</span></td><td class="mono">' + (d.faqs_incorporadas || 0) + '</td><td class="small muted">' + fmtDate(d.created_at) + '</td><td>' + (d.estado === 'pendiente' ? '<button class="btn sm primary" data-review="' + d.id + '">Revisar</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">Aún no hay documentos cargados.</div>') + '</div>';
    },
    mount: function (root) {
      var drop = $('#drop', root), input = $('#file', root);
      function many(files) { Array.prototype.reduce.call(files, function (p, f) { return p.then(function () { return handleFile(f); }); }, Promise.resolve()).catch(function (e) { fail(e, 'procesar el archivo'); }); }
      input.onchange = function () { many(input.files); };
      drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = function () { drop.classList.remove('over'); };
      drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); many(e.dataTransfer.files); };
      root.onclick = function (e) { var b = e.target.closest('[data-review]'); if (b) reviewDoc(app.docs.filter(function (d) { return String(d.id) === b.dataset.review; })[0]); };
    }
  };

  // Preguntas sin respuesta
  function setGap(g, estado, faqId) {
    var upd = Object.assign({}, g, { estado: estado, faq_id: faqId || null });
    return app.store.update('gaps', g.id, upd).then(function () { Object.assign(g, upd); audit('gap_' + estado, 'gap:' + g.id, { faq_id: faqId || null }); });
  }
  VIEWS.gaps = {
    html: function () {
      var open = app.gaps.filter(function (g) { return g.estado === 'abierta'; }).slice().reverse();
      var closed = app.gaps.filter(function (g) { return g.estado !== 'abierta'; }).length;
      return '<div class="card"><div class="card-head"><h2>Abiertas (' + open.length + ')</h2><span class="small muted">' + closed + ' resueltas</span></div>' +
        (open.length ? '<div class="table-wrap"><table><thead><tr><th>Pregunta</th><th>Confianza</th><th>FAQ más cercana</th><th>Fecha</th><th></th></tr></thead><tbody>' + open.map(function (g) {
          var sug = g.faq_sugerida ? app.faqs.filter(function (f) { return (f.base_id || f.id) === g.faq_sugerida; })[0] : null;
          return '<tr><td><b>' + esc(g.pregunta) + '</b></td><td class="mono">' + (+g.score).toFixed(3) + '</td><td class="small">' + (sug ? '#' + (sug.base_id || sug.id) + ' ' + esc(sug.pregunta) : '—') + '</td><td class="small muted">' + fmtDate(g.created_at) + '</td>' +
            '<td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-fix="' + g.id + '">Corregir respuesta</button><button class="btn sm primary" data-faq="' + g.id + '">Convertir en FAQ</button><button class="btn sm ghost" data-discard="' + g.id + '">Descartar</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">No hay preguntas sin respuesta. 🎉</div>') + '</div>';
    },
    mount: function (root) {
      root.onclick = function (e) {
        var b = e.target.closest('[data-fix],[data-faq],[data-discard]'); if (!b) return;
        var id = b.dataset.fix || b.dataset.faq || b.dataset.discard;
        var g = app.gaps.filter(function (x) { return String(x.id) === id; })[0];
        if (b.dataset.discard) return setGap(g, 'descartada').then(render).catch(function (er) { fail(er, 'descartar'); });
        if (b.dataset.faq) return editFaq(null, { pregunta: g.pregunta, respuesta: '', categoria: 'Otro', keywords: '', fuente: 'Pregunta sin respuesta' }, function (f) { return setGap(g, 'convertida', f.id).then(render); });
        // Corregir: vincula la pregunta a una FAQ existente agregándola como palabra clave.
        var ranked = E.searchFaqs(g.pregunta, activeFaqs()).ranked;
        modal('Corregir respuesta', '<p style="margin-top:0">Pregunta del cliente: <b>' + esc(g.pregunta) + '</b></p><p class="small muted">Elige la FAQ que debió responder. La pregunta se agrega a sus palabras clave para que Emi la reconozca la próxima vez.</p>' +
          '<label class="field"><span>FAQ</span><select name="faq">' + ranked.map(function (r) { return '<option value="' + r.faq.id + '">#' + (r.faq.base_id || r.faq.id) + ' · ' + esc(r.faq.pregunta) + ' (' + r.score.toFixed(2) + ')</option>'; }).join('') +
          '<option disabled>──────────</option>' + activeFaqs().map(function (f) { return '<option value="' + f.id + '">#' + (f.base_id || f.id) + ' · ' + esc(f.pregunta) + '</option>'; }).join('') + '</select></label>', [
          { label: 'Cancelar' },
          { label: 'Vincular', cls: 'primary', onClick: function (el) {
            var f = app.faqs.filter(function (x) { return String(x.id) === el.querySelector('[name=faq]').value; })[0];
            var kw = (f.keywords ? f.keywords + ', ' : '') + g.pregunta.replace(/[,;]/g, ' ');
            return saveFaq(f, { keywords: kw }, 'faq_corregir_gap').then(function () { return setGap(g, 'corregida', f.id); }).then(function () { toast('Pregunta vinculada a la FAQ #' + (f.base_id || f.id)); render(); }).catch(function (er) { fail(er, 'vincular'); return false; });
          } }
        ]);
      };
    }
  };

  // Ajustes
  function settingsCard(title, body, id) {
    return '<form class="card" id="' + id + '"><div class="card-head"><h2>' + title + '</h2></div>' + body + '<div class="row"><button class="btn primary" type="submit">Guardar</button><span class="small muted">Cada cambio crea una nueva versión y queda en la auditoría.</span></div></form>';
  }
  function opt(v, cur, label) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>'; }

  VIEWS.personalidad = {
    html: function () {
      var c = app.cfg;
      return settingsCard('Personalidad',
        '<div class="grid grid-2"><label class="field"><span>Nombre</span><input type="text" name="nombre" value="' + esc(c.nombre) + '" maxlength="30"></label>' +
        '<label class="field"><span>Tono</span><input type="text" name="tono" value="' + esc(c.tono) + '"><small>Guía para quien redacta las FAQs; no altera el texto automáticamente.</small></label>' +
        '<label class="field"><span>Trato</span><select name="trato">' + opt('tu', c.trato, 'Tú') + opt('usted', c.trato, 'Usted') + '</select><small>"Usted" convierte de forma aproximada las formas más comunes.</small></label>' +
        '<label class="field"><span>Longitud de respuestas</span><select name="longitud">' + opt('corta', c.longitud, 'Corta (2 frases)') + opt('media', c.longitud, 'Media') + opt('detallada', c.longitud, 'Detallada') + '</select></label>' +
        '<label class="field"><span>Emojis</span><select name="emojis">' + opt('ninguno', c.emojis, 'Ninguno') + opt('moderados', c.emojis, 'Moderados (máx. 1)') + opt('muchos', c.emojis, 'Los que traiga el texto') + '</select></label></div>', 'f-pers');
    },
    mount: function (root) {
      $('#f-pers', root).onsubmit = function (e) { e.preventDefault(); var d = readForm(e.target); saveConfig(Object.assign({}, app.cfg, { nombre: d.nombre.trim() || 'Emi', tono: d.tono.trim(), trato: d.trato, longitud: d.longitud, emojis: d.emojis }), 'personalidad'); };
    }
  };

  VIEWS.mensajes = {
    html: function () {
      var m = app.cfg.mensajes;
      var F = [['saludo', 'Saludo', 'Variables: {nombre}'], ['insuficiente', 'Información insuficiente', 'Se usa cuando la confianza es baja o una consulta falla. Debe ofrecer asesor.'], ['escalamiento', 'Escalamiento', 'Al pasar a un asesor en horario.'], ['fueraHorario', 'Fuera de horario', 'Variables: {horario}, {proximo}'], ['contactoRespaldo', 'Contacto de respaldo', 'Si no se pudo crear el ticket.']];
      return settingsCard('Mensajes clave', F.map(function (f) { return '<label class="field"><span>' + f[1] + '</span><textarea name="' + f[0] + '" rows="3">' + esc(m[f[0]]) + '</textarea><small>' + f[2] + '</small></label>'; }).join(''), 'f-msg');
    },
    mount: function (root) {
      $('#f-msg', root).onsubmit = function (e) { e.preventDefault(); var d = readForm(e.target); saveConfig(Object.assign({}, app.cfg, { mensajes: Object.assign({}, app.cfg.mensajes, d) }), 'mensajes'); };
    }
  };

  VIEWS.horario = {
    html: function () {
      var h = app.cfg.horario, DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      var open = E.isOpen(new Date(), h, holidayDates());
      return settingsCard('Horario de atención',
        '<p style="margin-top:0"><span class="badge ' + (open ? 'ok' : 'warn') + '">' + (open ? 'Abierto ahora' : 'Cerrado ahora') + '</span> <span class="small muted">' + esc(E.horarioText(h)) + ' · hora de Colombia · próximo: ' + esc(E.nextOpenText(new Date(), h, holidayDates())) + '</span></p>' +
        '<div class="grid grid-2"><label class="field"><span>Inicio</span><input type="time" name="inicio" value="' + esc(h.inicio) + '"></label><label class="field"><span>Fin</span><input type="time" name="fin" value="' + esc(h.fin) + '"></label></div>' +
        '<div class="field"><span style="font-weight:600;font-size:13px">Días</span><div class="row">' + DIAS.map(function (d, i) { return '<label class="check"><input type="checkbox" name="d' + i + '"' + (h.dias.indexOf(i) !== -1 ? ' checked' : '') + '> ' + d + '</label>'; }).join('') + '</div></div>' +
        '<label class="check"><input type="checkbox" name="atenderFestivos"' + (h.atenderFestivos ? ' checked' : '') + '> Atender en festivos de Colombia</label>', 'f-hor') +
        '<div class="card"><div class="card-head"><h2>Festivos (' + app.holidays.length + ')</h2><form class="row" id="f-hol"><input type="date" name="fecha" required style="width:auto"><input type="text" name="nombre" placeholder="Nombre" required style="width:200px"><button class="btn" type="submit">Agregar</button></form></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Festivo</th><th></th></tr></thead><tbody>' + app.holidays.map(function (x) { return '<tr><td class="mono">' + esc(x.fecha) + '</td><td>' + esc(x.nombre) + '</td><td><button class="btn sm ghost danger" data-delhol="' + x.id + '">Quitar</button></td></tr>'; }).join('') + '</tbody></table></div></div>';
    },
    mount: function (root) {
      $('#f-hor', root).onsubmit = function (e) {
        e.preventDefault(); var d = readForm(e.target);
        if (d.inicio >= d.fin) return toast('La hora de inicio debe ser menor que la de fin.', true);
        var dias = []; for (var i = 0; i < 7; i++) if (d['d' + i]) dias.push(i);
        saveConfig(Object.assign({}, app.cfg, { horario: { inicio: d.inicio, fin: d.fin, dias: dias, atenderFestivos: !!d.atenderFestivos } }), 'horario');
      };
      $('#f-hol', root).onsubmit = function (e) {
        e.preventDefault(); var d = readForm(e.target);
        if (app.holidays.some(function (h) { return h.fecha === d.fecha; })) return toast('Esa fecha ya está registrada.', true);
        app.store.create('holidays', { fecha: d.fecha, nombre: d.nombre.trim() }).then(function (r) { app.holidays.push(r); app.holidays.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }); audit('festivo_agregar', 'holidays', r); render(); }).catch(function (er) { fail(er, 'agregar el festivo'); });
      };
      root.onclick = function (e) {
        var b = e.target.closest('[data-delhol]'); if (!b) return;
        var h = app.holidays.filter(function (x) { return String(x.id) === b.dataset.delhol; })[0];
        app.store.remove('holidays', h.id).then(function () { app.holidays = app.holidays.filter(function (x) { return x !== h; }); audit('festivo_quitar', 'holidays', h); render(); }).catch(function (er) { fail(er, 'quitar el festivo'); });
      };
    }
  };

  VIEWS.escalamiento = {
    html: function () {
      var c = app.cfg;
      function sw(name, label, help) { return '<div class="row" style="margin:10px 0;justify-content:space-between;flex-wrap:nowrap"><div><b>' + label + '</b><div class="small muted">' + help + '</div></div><label class="switch"><input type="checkbox" name="' + name + '"' + (c.escalar[name] ? ' checked' : '') + ' aria-label="' + label + '"><i></i></label></div>'; }
      return settingsCard('Reglas de escalamiento',
        '<label class="field"><span>Umbral de confianza: <b class="mono" id="th-v">' + c.threshold.toFixed(2) + '</b></span><input type="range" name="threshold" min="0.10" max="0.90" step="0.01" value="' + c.threshold + '" style="width:100%;accent-color:var(--accent)"><small>Por debajo de este puntaje Emi no responde, registra la pregunta y ofrece asesor. Valor inicial: 0.35.</small></label>' +
        sw('pideAsesor', 'Escalar si pide asesor', 'Crea el ticket cuando el cliente pide hablar con una persona.') +
        sw('reclamo', 'Escalar si hay reclamo', 'Queja, fraude, estafa, PQR.') +
        sw('bajaConfianza', 'Ofrecer asesor con confianza baja', 'Si el cliente acepta, se crea el ticket.') +
        '<p class="small muted">Pipeline y etapa de tickets en HubSpot: <b>pendiente de definir</b> (portal 2917670). Se configura en el webhook <code>/emi/escalate</code> de n8n, no en la consola.</p>', 'f-esc');
    },
    mount: function (root) {
      var f = $('#f-esc', root);
      f.threshold.oninput = function () { $('#th-v').textContent = (+f.threshold.value).toFixed(2); };
      f.onsubmit = function (e) { e.preventDefault(); var d = readForm(f); saveConfig(Object.assign({}, app.cfg, { threshold: +(+d.threshold).toFixed(2), escalar: { pideAsesor: !!d.pideAsesor, reclamo: !!d.reclamo, bajaConfianza: !!d.bajaConfianza } }), 'escalamiento'); };
    }
  };

  VIEWS.whatsapp = {
    html: function () {
      return '<div class="card"><div class="card-head"><h2>WhatsApp Business</h2><span class="badge info">Fase posterior</span></div>' +
        '<p style="margin-top:0">El canal de producción será la bandeja de WhatsApp de HubSpot (portal 2917670). La consola ya está preparada: el motor de Emi es un módulo independiente que se reutiliza tal cual en n8n.</p>' +
        '<ol class="small"><li>Un cliente escribe a WhatsApp → llega a la bandeja de HubSpot.</li><li>Un flujo de n8n recibe el mensaje (webhook de HubSpot Conversations).</li><li>n8n ejecuta <code>js/engine/engine.js</code> con las FAQs y la configuración de esta consola, y consulta Metabase/HubSpot.</li><li>n8n responde por la misma conversación; si hay escalamiento, asigna el hilo o crea el ticket.</li><li>Cada mensaje se registra en <code>conversations</code>/<code>messages</code> para el Panel.</li></ol>' +
        '<p class="small muted">Interfaz pendiente: <code>ChannelAdapter { receive(msg), send(conversationId, text), handoff(conversationId, ticket) }</code>. Ver <code>n8n/README.md</code>.</p></div>';
    }
  };

  VIEWS.tema = {
    html: function () {
      var t = 'system'; try { t = localStorage.getItem('emi_theme') || 'system'; } catch (e) { /* sin storage */ }
      return '<div class="card"><div class="card-head"><h2>Apariencia</h2></div><div class="seg" role="group" aria-label="Tema">' +
        [['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']].map(function (o) { return '<button data-settheme="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') +
        '</div><p class="small muted">Es una preferencia de este navegador; no afecta a otros usuarios.</p></div>';
    },
    mount: function (root) {
      root.onclick = function (e) {
        var b = e.target.closest('[data-settheme]'); if (!b) return;
        var t = b.dataset.settheme;
        try { if (t === 'system') localStorage.removeItem('emi_theme'); else localStorage.setItem('emi_theme', t); } catch (er) { /* sin storage */ }
        if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
        render();
      };
    }
  };

  VIEWS.exportar = {
    html: function () {
      var log = app.audit.filter(function (a) { return a.accion !== 'consulta_n8n'; }).slice(-40).reverse();
      return '<div class="grid grid-2"><div class="card"><div class="card-head"><h2>Exportar</h2></div><p class="small muted" style="margin-top:0">Descarga configuración, FAQs y festivos en JSON (esquema <code>emi-console</code> v1).</p><button class="btn primary" data-act="export">Descargar JSON</button></div>' +
        '<div class="card"><div class="card-head"><h2>Importar</h2></div><p class="small muted" style="margin-top:0">Valida el esquema antes de aplicar. Las FAQs se fusionan: se agregan las nuevas y se actualizan las que tienen la misma pregunta.</p><label class="btn">Elegir archivo JSON<input type="file" id="imp" accept=".json,application/json" hidden></label></div></div>' +
        '<div class="card"><div class="card-head"><h2>Auditoría</h2><span class="small muted">Quién (correo autenticado), qué y cuándo · últimos 40 cambios</span></div>' +
        (log.length ? '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr></thead><tbody>' + log.map(function (a) {
          return '<tr><td class="small muted">' + fmtDate(a.created_at) + '</td><td class="small">' + esc(a.owner_email || '—') + '</td><td><span class="badge">' + esc(a.accion) + '</span></td><td class="mono small">' + esc(a.objeto) + '</td><td class="mono small" style="max-width:360px;word-break:break-word">' + esc(String(a.detalle || '').slice(0, 220)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">Sin cambios registrados.</div>') + '</div>';
    },
    mount: function (root) {
      root.onclick = function (e) {
        var b = e.target.closest('[data-act=export]'); if (!b) return;
        var data = P.buildExport({ config: app.cfg, faqs: app.faqs, holidays: app.holidays });
        var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        var a = document.createElement('a'); a.href = url; a.download = 'emi-consola-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        audit('exportar', 'consola', { faqs: data.faqs.length });
      };
      $('#imp', root).onchange = function (e) {
        var file = e.target.files[0]; if (!file) return;
        file.text().then(function (txt) {
          var obj; try { obj = JSON.parse(txt); } catch (er) { return toast('El archivo no es un JSON válido.', true); }
          var v = P.validateImport(obj);
          if (!v.ok) return modal('Importación rechazada', '<p>Corrige estos problemas y vuelve a intentar:</p><ul>' + v.errors.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
          var faqs = obj.faqs || [];
          var nuevas = faqs.filter(function (f) { return !isDuplicate(f.pregunta); });
          modal('Confirmar importación', '<ul><li>Configuración: ' + (obj.config ? 'se guardará como nueva versión' : 'sin cambios') + '</li><li>FAQs: ' + nuevas.length + ' nuevas · ' + (faqs.length - nuevas.length) + ' actualizadas</li><li>Festivos: ' + ((obj.holidays || []).filter(function (h) { return !app.holidays.some(function (x) { return x.fecha === h.fecha; }); }).length) + ' nuevos</li></ul>', [
            { label: 'Cancelar' },
            { label: 'Importar', cls: 'primary', onClick: function () {
              var jobs = Promise.resolve();
              faqs.forEach(function (f) {
                jobs = jobs.then(function () {
                  var n = E.normalize(f.pregunta);
                  var cur = app.faqs.filter(function (x) { return E.normalize(x.pregunta) === n; })[0];
                  if (cur) return saveFaq(cur, { respuesta: f.respuesta, categoria: f.categoria, keywords: f.keywords || '', activa: f.activa !== false }, 'faq_importar');
                  return createFaq(f, f.fuente || 'Importación').then(function (r) { if (f.activa === false) return saveFaq(r, { activa: false }, 'faq_importar'); });
                });
              });
              (obj.holidays || []).forEach(function (h) {
                jobs = jobs.then(function () { if (app.holidays.some(function (x) { return x.fecha === h.fecha; })) return; return app.store.create('holidays', { fecha: h.fecha, nombre: h.nombre || 'Festivo' }).then(function (r) { app.holidays.push(r); }); });
              });
              return jobs.then(function () {
                audit('importar', 'consola', { archivo: file.name, faqs: faqs.length });
                if (obj.config) return saveConfig(E.withDefaults(obj.config), 'importación');
                render();
              }).then(function () { toast('Importación completada'); }).catch(function (er) { fail(er, 'importar'); });
            } }
          ]);
        });
        e.target.value = '';
      };
    }
  };

  // ───────────── Arranque ─────────────
  document.addEventListener('click', function (e) { var n = e.target.closest('[data-nav]'); if (n) go(n.dataset.nav); });

  S.connect().then(function (store) {
    app.store = store;
    if (store.mode === 'local') {
      $('#banner').innerHTML = '<div class="banner warn"><b>Modo local de desarrollo:</b> no hay servidor de datos, así que todo se guarda solo en este navegador. En consola-emi.apps.plataform.com se usa la base de datos del Deployer.</div>';
    }
    return load().then(seed);
  }).then(function () {
    var h = (location.hash || '').slice(1);
    if (VIEWS[h]) app.view = h;
    render();
  }).catch(function (e) {
    console.error(e);
    $('#view').innerHTML = '<div class="card"><h2>No se pudo iniciar la consola</h2><p class="muted">' + esc(e && e.message || e) + '</p></div>';
  });
})();
