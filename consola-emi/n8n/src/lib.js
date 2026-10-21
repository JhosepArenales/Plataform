/* Lógica de los flujos de n8n de Emi.
 * `emiLib` se incrusta tal cual en los nodos Code (n8n/build.js), y los tests la cargan desde aquí,
 * así el código probado es el mismo que corre en n8n. Sin dependencias ni acceso a red. */
function emiLib() {
  var PEND = 'POR_DEFINIR';

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function key(s) { return norm(s).replace(/ /g, '_'); }
  function digits(s) { return String(s == null ? '' : s).split('-')[0].replace(/\D/g, ''); }
  function maskDoc(d) {
    d = digits(d);
    if (!d) return '';
    return (d.length === 9 && /^[89]/.test(d) ? 'NIT' : 'CC') + ' ***' + d.slice(-6);
  }

  // Valores 'POR_DEFINIR' que impiden operar con seguridad.
  function missingConfig(cfg, section) {
    var out = [];
    (function walk(o, path) {
      if (o === PEND) out.push(path);
      else if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { walk(o[k], path ? path + '.' + k : k); });
    })(cfg[section], section);
    return out;
  }

  // ── Validación de requests ──
  function validate(kind, body) {
    body = body || {};
    if (kind === 'client') {
      var d = digits(body.documento);
      if (d.length < 5 || d.length > 12) return { error: 'bad_request', detalle: 'documento' };
      return { ok: true, documento: d };
    }
    if (kind === 'operation') {
      var n = String(body.numero_operacion || '').replace(/\D/g, '');
      var e = String(body.empresa || '').trim();
      if (!n || n.length > 9) return { error: 'bad_request', detalle: 'numero_operacion' };
      if (e.length < 3 || e.length > 120) return { error: 'bad_request', detalle: 'empresa' };
      return { ok: true, numero: n, empresa: e };
    }
    if (kind === 'escalate') {
      if (!body.conversation_id || String(body.conversation_id).length > 80) return { error: 'bad_request', detalle: 'conversation_id' };
      if (!body.motivo) return { error: 'bad_request', detalle: 'motivo' };
      return { ok: true };
    }
    return { error: 'bad_request' };
  }

  // ── Metabase ──
  // Acepta /api/card/:id/query ({data:{cols,rows}}) o /query/json (lista de objetos). Claves normalizadas.
  function metabaseRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[key(k)] = r[k]; }); return o; });
    var data = resp.data || resp;
    if (!data.cols || !data.rows) return [];
    var names = data.cols.map(function (c) { return key(c.display_name || c.name); });
    var alt = data.cols.map(function (c) { return key(c.name); });
    return data.rows.map(function (row) {
      var o = {};
      row.forEach(function (v, i) { o[names[i]] = v; if (!(alt[i] in o)) o[alt[i]] = v; });
      return o;
    });
  }
  function cardBody(paramName, value) {
    if (!paramName) return { parameters: [] };
    return { parameters: [{ type: 'category', target: ['variable', ['template-tag', paramName]], value: value }] };
  }
  function col(row, name) { return name ? row[key(name)] : undefined; }

  // HTTP con "continuar en error": n8n deja el error en el json del item.
  function isHttpError(j) {
    return !j || (j.error !== undefined && j.data === undefined && j.results === undefined && j.id === undefined && !Array.isArray(j));
  }

  function truthy(v) { var n = norm(v); return n === 'si' || n === 'true' || n === '1' || n === 'x' || n === 'yes' || (typeof v === 'number' && v > 0); }
  function ruleMatch(rule, row) {
    var v = col(row, rule.columna);
    switch (rule.op) {
      case 'in': return (rule.valor || []).map(norm).indexOf(norm(v)) !== -1;
      case 'notEmpty': return v !== null && v !== undefined && String(v).trim() !== '';
      case 'gt': return Number(v) > Number(rule.valor);
      case 'truthy': return truthy(v);
      default: return false;
    }
  }

  function classifyClient(rows, documento, cfg) {
    var c = cfg.clientes;
    var mine = rows.filter(function (r) { return digits(col(r, c.columnaDocumento)) === documento; });
    if (!mine.length) return { estado: 'no_encontrado' };
    var estado = c.estadoPorDefecto;
    for (var i = 0; i < c.reglas.length; i++) {
      var rule = c.reglas[i];
      if (mine.some(function (r) { return ruleMatch(rule, r); })) { estado = rule.estado; break; }
    }
    var nombre = String(col(mine[0], c.columnaNombre) || '').trim().split(/\s+/)[0] || null;
    var email = c.columnaEmail ? String(col(mine[0], c.columnaEmail) || '').trim().toLowerCase() || null : null;
    return { estado: estado, nombre: nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase() : null, email: email };
  }

  function contactSearchBody(email) {
    return { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], properties: ['email'], limit: 1 };
  }

  // ── Operaciones ──
  function stripCompany(s) { return norm(s).replace(/\b(s a s|sas|s a|sa|ltda|limitada|s en c|e u|eu)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  function matchEmpresa(input, nit, razon) {
    var d = digits(input);
    if (d.length >= 6) return d === digits(nit);
    var q = stripCompany(input);
    if (q.length < 4) return false;
    return stripCompany(razon).indexOf(q) !== -1;
  }

  function findOperation(rows, numero, empresa, cfg) {
    var o = cfg.operaciones;
    var hits = rows.filter(function (r) { return String(col(r, o.columnaNumero)).replace(/\D/g, '') === numero; });
    if (!hits.length) return { found: false };
    var r = hits[0];
    var nit = digits(col(r, o.columnaNit)), razon = String(col(r, o.columnaRazonSocial) || '');
    if (!matchEmpresa(empresa, nit, razon)) return { found: false };
    var estadoRaw = norm(col(r, o.columnaEstado));
    var estado = o.mapaEstados[estadoRaw];
    if (!estado) return { error: 'unknown_state', detalle: estadoRaw.slice(0, 40) };
    var exp = col(r, o.columnaExpediente);
    return {
      found: true, numero_operacion: numero, estado_cobro: estado,
      empresa: { razon_social: razon, nit: nit, tipo_societario: col(r, o.columnaTipoSocietario) || null },
      fecha_pago_estimada: col(r, o.columnaFechaPago) ? String(col(r, o.columnaFechaPago)).slice(0, 10) : null,
      expediente: exp ? { numero: String(exp), tipo_proceso: col(r, o.columnaTipoProceso) || null } : null
    };
  }

  // Busca correos salientes con la palabra del asunto; el filtro fino por operación/empresa se hace en código.
  function emailSearchBody(cfg) {
    var h = cfg.hubspot;
    return {
      filterGroups: [{ filters: [
        { propertyName: 'hs_email_direction', operator: 'EQ', value: 'EMAIL' },
        { propertyName: 'hs_email_subject', operator: 'CONTAINS_TOKEN', value: h.palabraAsunto }
      ] }],
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      properties: ['hs_timestamp', 'hs_email_subject', 'hs_email_text', 'hs_email_html', 'hs_email_from_email'],
      limit: Math.min(100, h.maxCorreos || 50)
    };
  }

  function htmlToText(s) {
    return String(s || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  }
  // Resumen seguro: sin citas de respuestas anteriores, sin documentos, ≤ 300 caracteres.
  function summarize(text, max) {
    max = max || 300;
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (/^(el|on) .{0,120}(escribi[oó]|wrote):?$/i.test(l) || /^-{2,}\s*(mensaje original|original message)/i.test(l) || /^de:\s/i.test(l)) break;
      if (l.charAt(0) === '>') continue;
      out.push(l);
    }
    var t = out.join(' ').replace(/\b\d{7,}\b/g, function (m) { return maskDoc(m); }).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var cut = t.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).trim() + '…';
  }

  function pickLastCommunication(results, op, cfg) {
    var from = norm(cfg.hubspot.remitenteCorreos);
    var numRe = new RegExp('(^|\\D)' + op.numero_operacion + '(\\D|$)');
    var empresa = stripCompany(op.empresa.razon_social);
    var mails = (results || []).map(function (e) {
      var p = e.properties || {};
      var text = p.hs_email_text || htmlToText(p.hs_email_html);
      return { ts: p.hs_timestamp, asunto: String(p.hs_email_subject || ''), text: text, from: norm(p.hs_email_from_email) };
    }).filter(function (m) { return !from || !m.from || m.from === from; });
    var byNum = mails.filter(function (m) { return numRe.test(m.asunto) || numRe.test(m.text); });
    var pool = byNum.length ? byNum : (empresa ? mails.filter(function (m) { return stripCompany(m.asunto + ' ' + m.text).indexOf(empresa) !== -1; }) : []);
    if (!pool.length) return null;
    pool.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    var m = pool[0];
    return { fecha: new Date(m.ts).toISOString().slice(0, 10), asunto: m.asunto.slice(0, 160), resumen: summarize(m.text) };
  }

  // ── Tickets ──
  var MOTIVOS = {
    pidio_asesor: 'Pidió asesor', reclamo: 'Reclamo', baja_confianza: 'Emi no supo responder', cliente_mora: 'Cliente en mora',
    actualizacion_operacion: 'Pide actualización de operación', error_consulta: 'Falla de consulta', documento_invalido: 'Documento inválido',
    operacion_no_validada: 'Operación no validada'
  };
  function ticketSearchBody(conversationId, cfg) {
    return { filterGroups: [{ filters: [{ propertyName: cfg.hubspot.propiedadConversacion, operator: 'EQ', value: String(conversationId) }] }], properties: ['hs_pipeline_stage'], limit: 1 };
  }
  function ticketCreateBody(p, cfg) {
    var h = cfg.hubspot;
    var motivo = MOTIVOS[p.motivo] || String(p.motivo);
    var ref = p.cliente && p.cliente.ref ? String(p.cliente.ref).slice(0, 20) : 'cliente sin validar';
    var lines = [
      'Escalado por Emi (asistente virtual).',
      'Motivo: ' + motivo,
      'Intención detectada: ' + (p.intencion || 'n/d') + ' · confianza: ' + (p.confianza == null ? 'n/d' : Number(p.confianza).toFixed(2)),
      'Cliente: ' + ref + (p.cliente && p.cliente.estado ? ' (' + p.cliente.estado + ')' : ''),
      p.fuera_horario ? 'FUERA DE HORARIO: contactar el próximo día hábil.' : 'En horario de atención.',
      '',
      'Resumen de la conversación:',
      String(p.resumen || '').replace(/\b\d{7,}\b/g, function (m) { return maskDoc(m); }).slice(0, 3000)
    ];
    var props = {
      subject: 'Emi · ' + motivo + ' · ' + ref,
      content: lines.join('\n'),
      hs_pipeline: String(h.ticketPipeline),
      hs_pipeline_stage: String(h.ticketEtapa),
      hs_ticket_priority: p.motivo === 'reclamo' ? 'HIGH' : 'MEDIUM'
    };
    props[h.propiedadConversacion] = String(p.conversation_id);
    if (h.ticketOwnerId) props.hubspot_owner_id = String(h.ticketOwnerId);
    var body = { properties: props };
    var cid = p.cliente && p.cliente.id;
    if (cid && /^\d+$/.test(String(cid))) {
      body.associations = [{ to: { id: String(cid) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] }];
    }
    return body;
  }

  return {
    norm: norm, key: key, digits: digits, maskDoc: maskDoc, missingConfig: missingConfig, validate: validate,
    metabaseRows: metabaseRows, cardBody: cardBody, isHttpError: isHttpError, classifyClient: classifyClient, contactSearchBody: contactSearchBody,
    matchEmpresa: matchEmpresa, findOperation: findOperation, emailSearchBody: emailSearchBody, summarize: summarize, htmlToText: htmlToText,
    pickLastCommunication: pickLastCommunication, ticketSearchBody: ticketSearchBody, ticketCreateBody: ticketCreateBody, MOTIVOS: MOTIVOS
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = emiLib;
