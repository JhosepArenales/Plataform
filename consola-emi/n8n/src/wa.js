/* Canal WhatsApp vía Evolution API: interpretación de mensajes, estado por número, silencio cuando
 * atiende un asesor y armado de registros para HubSpot. Se incrusta en los nodos Code (build.js). */
function emiWa() {
  // Marca invisible al final de cada mensaje de Emi: así su "eco" (fromMe) se reconoce sin depender del estado.
  var MARK = '\u2063';
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function jidUser(jid) { return String(jid || '').split('@')[0].split(':')[0]; }

  // Evolution API v2, evento messages.upsert. Devuelve el mensaje normalizado o {ignore: motivo}.
  function parseEvolution(body) {
    body = body || {};
    var ev = String(body.event || '').toLowerCase().replace(/_/g, '.');
    if (ev !== 'messages.upsert') return { ignore: 'evento:' + (body.event || 'vacío') };
    var d = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!d || !d.key) return { ignore: 'sin_datos' };
    var k = d.key;
    var jid = String(k.remoteJid || '');
    if (/@g\.us$/.test(jid) || /@broadcast$/.test(jid) || /@newsletter$/.test(jid)) return { ignore: 'grupo_o_difusion' };
    // Con identificadores @lid, WhatsApp manda el teléfono en otro campo.
    var phoneJid = /@lid$/.test(jid) ? (k.senderPn || k.remoteJidAlt || d.senderPn || '') : jid;
    var phone = digits(jidUser(phoneJid));
    if (phone.length < 8) return { ignore: 'sin_telefono' };
    var m = d.message || {};
    var text0 = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) ||
      (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText) ||
      (m.listResponseMessage && m.listResponseMessage.title) ||
      (m.imageMessage && m.imageMessage.caption) || (m.documentMessage && m.documentMessage.caption) || '';
    var marked = String(text0).indexOf(MARK) !== -1;
    var text = String(text0).split(MARK).join('');
    var tipo = text ? 'texto' : (d.messageType || Object.keys(m)[0] || 'desconocido');
    if (/^(protocolMessage|reactionMessage|senderKeyDistributionMessage|messageContextInfo)$/.test(tipo)) return { ignore: 'sistema:' + tipo };
    var ts = d.messageTimestamp ? new Date(Number(d.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
    return { id: k.id || null, phone: phone, fromMe: !!k.fromMe, bot: marked, text: String(text).trim().slice(0, 2000), tipo: tipo, pushName: d.pushName || null, ts: ts, instance: body.instance || null };
  }

  function hash(s) {
    var h = 5381; s = String(s).replace(/\s+/g, ' ').trim();
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  // Estado por número en los datos estáticos del flujo. Una sesión nueva tras `sesionHoras` sin actividad.
  function getConv(store, phone, now, cfg) {
    store.convs = store.convs || {};
    var c = store.convs[phone];
    var t = now.getTime();
    if (!c || t - c.lastAt > cfg.sesionHoras * 3600000) {
      c = { sessionId: 'wa-' + phone + '-' + t, engineState: null, humanUntil: (c && c.humanUntil) || 0, botTexts: (c && c.botTexts) || [], lastAt: t };
      store.convs[phone] = c;
    }
    return c;
  }
  // Limpia conversaciones viejas para que los datos estáticos no crezcan sin límite.
  function prune(store, now, dias) {
    var lim = now.getTime() - dias * 86400000;
    Object.keys(store.convs || {}).forEach(function (p) { if (store.convs[p].lastAt < lim) delete store.convs[p]; });
  }

  function rememberBot(conv, texts, now) {
    var t = now.getTime();
    conv.botTexts = (conv.botTexts || []).filter(function (b) { return t - b.at < 10 * 60000; }).concat(texts.map(function (x) { return { h: hash(x), at: t }; })).slice(-30);
  }
  function isBotEcho(conv, text, now, cfg) {
    if (String(text).indexOf(MARK) !== -1) return true;
    var h = hash(text), t = now.getTime();
    return (conv.botTexts || []).some(function (b) { return b.h === h && t - b.at < cfg.ventanaEcoSeg * 1000; });
  }

  // ¿Qué hacer con el mensaje? responder | registrar (sin responder) | ignorar.
  function decide(conv, msg, now, cfg) {
    if (msg.fromMe) {
      if (msg.bot || isBotEcho(conv, msg.text, now, cfg)) return { accion: 'ignorar', motivo: 'eco_del_bot' };
      // Un asesor escribió desde el WhatsApp: Emi se calla en esta conversación.
      conv.humanUntil = now.getTime() + cfg.silencioHoras * 3600000;
      return { accion: 'registrar', autor: 'Asesor' };
    }
    if (conv.humanUntil > now.getTime()) {
      if (/^\s*men[uú]\s*$/i.test(msg.text)) { conv.humanUntil = 0; return { accion: 'responder' }; }
      return { accion: 'registrar', autor: 'Cliente', motivo: 'atiende_asesor' };
    }
    return { accion: 'responder' };
  }

  function e164(phone) { return '+' + digits(phone); }
  function national(phone) { var d = digits(phone); return d.length > 10 ? d.slice(-10) : d; }
  // "+57 320 *** 0525": legible para el asesor; el número completo está en el contacto asociado.
  function maskPhone(phone) { var d = digits(phone); return '+' + d.slice(0, 2) + ' ' + d.slice(2, 5) + ' *** ' + d.slice(-4); }

  function contactSearchBody(phone) {
    var full = e164(phone), nat = national(phone);
    return {
      filterGroups: [
        { filters: [{ propertyName: 'hs_searchable_calculated_phone_number', operator: 'EQ', value: nat }] },
        { filters: [{ propertyName: 'hs_searchable_calculated_mobile_number', operator: 'EQ', value: nat }] },
        { filters: [{ propertyName: 'hs_whatsapp_phone_number', operator: 'EQ', value: full }] },
        { filters: [{ propertyName: 'phone', operator: 'EQ', value: full }] },
        { filters: [{ propertyName: 'mobilephone', operator: 'EQ', value: full }] }
      ],
      properties: ['firstname', 'phone', 'mobilephone'],
      limit: 1
    };
  }
  function contactCreateBody(phone, pushName) {
    var p = { phone: e164(phone), hs_whatsapp_phone_number: e164(phone) };
    if (pushName) p.firstname = String(pushName).slice(0, 60);
    return { properties: p };
  }

  // Un registro de comunicación (tipo WhatsApp) por mensaje, asociado al contacto.
  function maskDocs(text) {
    return String(text).replace(/\b\d[\d.]{5,}\d\b/g, function (m) { var d = m.replace(/\D/g, ''); return d.length >= 7 ? '***' + d.slice(-4) : m; });
  }
  function communicationsBody(entries, contactId, opts) {
    var mask = !opts || opts.enmascararDocumentos !== false;
    return {
      inputs: entries.filter(function (e) { return e.text; }).map(function (e) {
        var body = { properties: {
          hs_communication_channel_type: 'WHATS_APP',
          hs_communication_logged_from: 'CRM',
          hs_communication_body: e.autor + ': ' + (mask ? maskDocs(e.text) : e.text),
          hs_timestamp: e.ts
        } };
        if (contactId) body.associations = [{ to: { id: String(contactId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 81 }] }];
        return body;
      })
    };
  }

  function sendItems(cfg, phone, replies) {
    return replies.map(function (text, i) {
      return { url: cfg.evolutionUrl.replace(/\/+$/, '') + '/message/sendText/' + encodeURIComponent(cfg.instancia), body: { number: digits(phone), text: text + MARK, delay: cfg.retrasoEscrituraMs + i * 400 } };
    });
  }

  return {
    MARK: MARK, digits: digits, parseEvolution: parseEvolution, hash: hash, getConv: getConv, prune: prune, rememberBot: rememberBot,
    isBotEcho: isBotEcho, decide: decide, e164: e164, national: national, maskPhone: maskPhone,
    contactSearchBody: contactSearchBody, contactCreateBody: contactCreateBody, maskDocs: maskDocs, communicationsBody: communicationsBody, sendItems: sendItems
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = emiWa;
