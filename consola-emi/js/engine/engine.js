/* Motor de respuesta de Emi.
 * Módulo puro: sin DOM, sin red y sin almacenamiento. Todo lo externo entra por `ctx`
 * (configuración, FAQs, festivos, reloj y adaptadores ClientLookup / OperationLookup / EscalationSink).
 * El mismo archivo corre en el navegador (Playground) y en Node (tests, y nodo Code de n8n). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./menus.js'));
  else root.EmiEngine = factory(root.EmiMenus);
})(typeof self !== 'undefined' ? self : this, function (Menus) {
  var MENUS = Menus.MENUS;

  // ───────────────────────── Configuración por defecto ─────────────────────────
  var CATEGORIAS = ['Producto e inversión', 'Pagos y facturación', 'Requisitos y documentos', 'Estados y tiempos', 'Horarios', 'Otro'];

  function defaults() {
    return {
      nombre: 'Emi',
      tono: 'Cálido y cercano, pero confiable',
      trato: 'tu',            // tu | usted
      longitud: 'media',      // corta | media | detallada
      emojis: 'moderados',    // ninguno | moderados | muchos
      mensajes: {
        saludo: '¡Hola! 👋 Soy {nombre}, la asistente virtual de Mesfix. Estoy aquí para ayudarte.',
        insuficiente: 'No tengo información suficiente para responderte con certeza. ¿Quieres que te comunique con un asesor?',
        escalamiento: 'Te comunico con un asesor de nuestro equipo 🙌. En breve te responderá por este mismo chat.',
        fueraHorario: 'Nuestro horario de atención es {horario}. Ya dejé registrada tu solicitud y un asesor te contactará {proximo}.',
        contactoRespaldo: 'Escríbenos al WhatsApp 321 751 7944 o a info@mesfix.com y te ayudamos.'
      },
      horario: { inicio: '08:00', fin: '18:00', dias: [1, 2, 3, 4, 5], atenderFestivos: false },
      threshold: 0.35,
      escalar: { pideAsesor: true, reclamo: true, bajaConfianza: true },
      barandaUrl: 'https://baranda.supersociedades.gov.co/'
    };
  }

  // Completa una configuración parcial con los valores por defecto (sin mutar la entrada).
  function withDefaults(cfg) {
    var d = defaults();
    cfg = cfg || {};
    var out = {};
    Object.keys(d).forEach(function (k) {
      var v = cfg[k];
      if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) out[k] = Object.assign({}, d[k], v || {});
      else out[k] = v === undefined || v === null ? d[k] : v;
    });
    return out;
  }

  // ───────────────────────── Texto: normalización y similitud ─────────────────────────
  var STOP = ('a al algo algun alguna algunas alguno algunos ante antes como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estan estas este esto estos fue ha hay la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otro para pero poco por porque que quien se sea ser si sin sobre su sus tambien te tengo tiene tu tus un una uno unos y ya yo hola buenas buenos dias tardes noches favor gracias quiero quisiera saber puedo debo hacer hago tengo necesito cosa me le').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Raíz ligera para español: quita plural, clíticos y terminaciones verbales/de género frecuentes.
  function stem(w) {
    if (w.length < 4 || /^\d+$/.test(w)) return w;
    w = w.replace(/(me|te|se|lo|la|le)$/, function (m, p, off) { return off >= 5 ? '' : m; });
    if (w.length > 4) w = w.replace(/(es|s)$/, function (m, p, off) { return off >= 3 ? '' : m; });
    var m = w.match(/(ando|iendo|ado|ido|ar|er|ir|o|a|e)$/);
    if (m && w.length - m[0].length >= 3) w = w.slice(0, w.length - m[0].length);
    return w;
  }

  function tokens(s) {
    return normalize(s).split(' ').filter(function (w) { return w && !STOPSET[w]; });
  }
  function stems(s) { return tokens(s).map(stem); }

  function bigrams(s) {
    var t = ' ' + s + ' ', out = {}, n = 0;
    for (var i = 0; i < t.length - 1; i++) { var g = t.substr(i, 2); out[g] = (out[g] || 0) + 1; n++; }
    return { map: out, n: n };
  }
  // Coeficiente de Dice sobre bigramas de caracteres (tolera errores de tipeo).
  function dice(a, b) { return diceNorm(tokens(a).join(' '), tokens(b).join(' ')); }

  function splitKeywords(k) {
    return String(k || '').split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // Índice por FAQ (se recalcula solo si cambian la pregunta o las keywords).
  var INDEX = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function indexOf(faq) {
    var key = faq.pregunta + '\u0000' + faq.keywords;
    var ix = INDEX && INDEX.get(faq);
    if (ix && ix.key === key) return ix;
    var docSet = {};
    stems(faq.pregunta).concat(stems(faq.keywords)).forEach(function (w) { docSet[w] = true; });
    ix = { key: key, docSet: docSet, pregunta: tokens(faq.pregunta).join(' '), keywords: splitKeywords(faq.keywords).map(function (k) { return tokens(k).join(' '); }) };
    if (INDEX) INDEX.set(faq, ix);
    return ix;
  }
  function diceNorm(a, b) {
    if (!a || !b) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0;
    Object.keys(A.map).forEach(function (g) { if (B.map[g]) inter += Math.min(A.map[g], B.map[g]); });
    return (2 * inter) / (A.n + B.n);
  }

  // score = 0.55·recall + 0.32·max(dice(q,pregunta), dice(q,keywords)) + 0.13·dice(q,pregunta), +0.06 por categoría, tope 1.
  function score(q, faq, categoriaHint) {
    var qs = stems(q);
    if (!qs.length) return 0;
    var ix = indexOf(faq);
    var uniq = {}, hit = 0, total = 0;
    qs.forEach(function (w) { if (uniq[w]) return; uniq[w] = true; total++; if (ix.docSet[w]) hit++; });
    var recall = hit / total;
    var qn = tokens(q).join(' ');
    var dP = diceNorm(qn, ix.pregunta);
    var dK = 0;
    ix.keywords.forEach(function (k) { var d = diceNorm(qn, k); if (d > dK) dK = d; });
    var s = 0.55 * recall + 0.32 * Math.max(dP, dK) + 0.13 * dP;
    if (categoriaHint && faq.categoria === categoriaHint) s += 0.06;
    return Math.min(1, s);
  }

  function searchFaqs(q, faqs, categoriaHint) {
    var ranked = (faqs || []).filter(function (f) { return f.activa !== false; }).map(function (f) {
      return { faq: f, score: score(q, f, categoriaHint) };
    }).sort(function (a, b) { return b.score - a.score || (a.faq.base_id || a.faq.id) - (b.faq.base_id || b.faq.id); });
    return { best: ranked[0] || null, ranked: ranked.slice(0, 5) };
  }

  // ───────────────────────── Intenciones ─────────────────────────
  var RE = {
    ASESOR: /(\b(hablar|comunicar(me)?|contactar(me)?|pasar(me)?|quiero|necesito|comun[ií]came|p[aá]same|atienda|atender)\b.{0,25}\b(asesor(a|es)?|agente|humano|persona|operador(a)?)\b)|^(un |una )?(asesor(a)?|agente|humano)[.!?]*$/i,
    RECLAMO: /\b(reclamo|reclamar|queja|quejarme|inconforme|inconformidad|estafa|estafad[oa]s?|fraude|robo|robaron|denuncia|denunciar|pqrs?|p[eé]simo|indignad[oa]|molest[oa])\b/i,
    SALUDO: /^\s*(hola+|holi|buen[oa]s?(\s+(d[ií]as|tardes|noches))?|buen d[ií]a|hey|saludos|qu[eé] tal)\b[\s!¡.,]*(emi)?[\s!¡.,]*/i,
    ACCESO_MERCADO: /\b(no\s+(puedo|logro|me deja)\s+(ver|entrar|acceder|ingresar)|acceso|acceder|habilitar|habilit[ae]n)\b.{0,30}\bmercado\b/i,
    SIGNUP: /^(quiero|deseo|me gustar[ií]a|c[oó]mo)?\s*(me\s+)?(puedo\s+)?(registrarme|registro|crear (una |mi )?cuenta|abrir (una |mi )?cuenta|inscribirme)\b/i,
    OP_STRONG: /\boperaci[oó]n\s*(?:n[°ºo]\.?|no\.?|n[uú]mero|#)?\s*(\d{3,7})\b/i,
    OP_ESTADO: /\b(estado|c[oó]mo va|seguimiento|novedad(?:es)?|qu[eé] ha pasado|actualizaci[oó]n)\b.{0,25}\b(mi|mis|la|una|de)\s+(operaci[oó]n|operaciones|inversi[oó]n)\b/i,
    SI: /^(s[ií]+|claro|dale|ok|okay|de acuerdo|por favor|porfa|bueno|listo|va|perfecto)\b/i,
    NO: /^(no|nop|nel|ahora no|despu[eé]s|no gracias)\b/i
  };

  // ───────────────────────── Documentos y datos personales ─────────────────────────
  function normalizeDoc(input) {
    var s = String(input || '').trim();
    var m = s.match(/\d[\d.\s]*\d(\s*-\s*\d)?/);
    if (!m) return '';
    return m[0].split('-')[0].replace(/\D/g, '');
  }
  function docType(doc) { return doc.length === 9 && /^[89]/.test(doc) ? 'NIT' : 'CC'; }
  function maskDoc(doc) {
    doc = String(doc || '').replace(/\D/g, '');
    if (!doc) return '';
    return docType(doc) + ' ***' + doc.slice(-6);
  }
  // Enmascara cualquier secuencia larga de dígitos que pueda ser un documento.
  function maskText(text) {
    return String(text || '').replace(/\b\d[\d.]{5,}\d\b/g, function (m) { return maskDoc(m.replace(/\D/g, '')); });
  }

  // ───────────────────────── Horario y festivos (hora de Colombia, UTC-5 sin horario de verano) ─────────────────────────
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function bogota(now) {
    var d = new Date(now.getTime() - 5 * 3600000);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
      dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
      day: d.getUTCDate(), month: d.getUTCMonth(), utcMidnight: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    };
  }
  function toMin(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function fmtHora(hhmm) {
    var m = toMin(hhmm), h = Math.floor(m / 60), mm = m % 60;
    var suf = h < 12 ? 'a.m.' : 'p.m.';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + suf;
  }
  function isWorkingDay(b, horario, holidays) {
    if ((horario.dias || []).indexOf(b.dow) === -1) return false;
    if (!horario.atenderFestivos && (holidays || []).indexOf(b.date) !== -1) return false;
    return true;
  }
  function isOpen(now, horario, holidays) {
    var b = bogota(now);
    return isWorkingDay(b, horario, holidays) && b.minutes >= toMin(horario.inicio) && b.minutes < toMin(horario.fin);
  }
  // Texto del próximo momento de atención, p. ej. "mañana a partir de las 8:00 a.m."
  function nextOpenText(now, horario, holidays) {
    var desde = 'a partir de las ' + fmtHora(horario.inicio);
    var hoy = bogota(now);
    for (var i = 0; i < 21; i++) {
      var b = bogota(new Date(now.getTime() + i * 86400000));
      if (!isWorkingDay(b, horario, holidays)) continue;
      if (i === 0) {
        if (hoy.minutes < toMin(horario.inicio)) return 'hoy ' + desde;
        if (hoy.minutes < toMin(horario.fin)) return 'en este momento';
        continue;
      }
      if (i === 1) return 'mañana ' + desde;
      return 'el ' + DIAS[b.dow] + ' ' + b.day + ' de ' + MESES[b.month] + ' ' + desde;
    }
    return 'el próximo día hábil';
  }
  function horarioText(horario) {
    var dias = (horario.dias || []).slice().sort();
    var rango;
    if (dias.join(',') === '1,2,3,4,5') rango = 'de lunes a viernes';
    else if (dias.join(',') === '1,2,3,4,5,6') rango = 'de lunes a sábado';
    else rango = 'los días ' + dias.map(function (d) { return DIAS[d]; }).join(', ');
    return rango + ' de ' + fmtHora(horario.inicio) + ' a ' + fmtHora(horario.fin);
  }

  // ───────────────────────── Personalidad ─────────────────────────
  // Conversión aproximada tú → usted (se aplica sobre plantillas y FAQs; conserva la mayúscula inicial).
  // \b de JS no reconoce letras acentuadas, por eso se usan límites explícitos.
  var USTED = [
    ['tú', 'usted'], ['te ayudo', 'le ayudo'], ['te ayudamos', 'le ayudamos'], ['te comunico', 'le comunico'],
    ['te contactará', 'lo contactará'], ['te responderá', 'le responderá'], ['te informaremos', 'le informaremos'], ['te cuento', 'le cuento'],
    ['darte', 'darle'], ['ayudarte', 'ayudarle'], ['contactarte', 'contactarle'],
    ['puedes', 'puede'], ['tienes', 'tiene'], ['quieres', 'quiere'], ['necesitas', 'necesita'], ['estás', 'está'], ['firmes', 'firme'],
    ['escríbeme', 'escríbame'], ['escríbenos', 'escríbanos'], ['elige', 'elija'], ['escribe', 'escriba'], ['cuéntame', 'cuénteme'],
    ['verifica', 'verifique'], ['revisa', 'revise'], ['ingresa', 'ingrese'], ['hazme', 'hágame'],
    ['tu', 'su'], ['tus', 'sus'], ['te', 'le']
  ].map(function (p) {
    return [new RegExp('(^|[^\\p{L}])(' + p[0] + ')(?=$|[^\\p{L}])', 'giu'), p[1]];
  });
  function keepCase(src, dst) { return src[0] === src[0].toUpperCase() ? dst[0].toUpperCase() + dst.slice(1) : dst; }
  var EMOJI = /(\p{Extended_Pictographic}|\p{Regional_Indicator})(️|‍(\p{Extended_Pictographic}))*/gu;

  function stylize(text, cfg) {
    var out = String(text);
    if (cfg.trato === 'usted') USTED.forEach(function (r) {
      out = out.replace(r[0], function (m, pre, word) { return pre + keepCase(word, r[1]); });
    });
    if (cfg.emojis === 'ninguno') out = out.replace(EMOJI, '').replace(/ {2,}/g, ' ').replace(/ ([.,!?])/g, '$1');
    else if (cfg.emojis === 'moderados') { var seen = 0; out = out.replace(EMOJI, function (m) { seen++; return seen <= 1 ? m : ''; }).replace(/ {2,}/g, ' '); }
    return out.trim();
  }
  function shorten(text, cfg) {
    if (cfg.longitud !== 'corta') return text;
    var parts = String(text).match(/[^.!?]+[.!?]+(\s|$)/g);
    return parts && parts.length > 2 ? parts.slice(0, 2).join('').trim() : text;
  }
  function fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
  }

  // ───────────────────────── Estado de la conversación ─────────────────────────
  function newState() {
    return { menuStack: [], pending: null, cliente: null, escalated: false, ticketId: null, turns: 0, history: [] };
  }
  function clone(s) { return JSON.parse(JSON.stringify(s || newState())); }
  function currentMenu(st) { return st.menuStack.length ? st.menuStack[st.menuStack.length - 1] : null; }

  function renderMenu(id) {
    var m = MENUS[id];
    var lines = [m.texto];
    m.opciones.forEach(function (o) { lines.push(o.key + '. ' + o.label); });
    if (id !== 'inicio') lines.push('9. Volver al menú anterior · escribe *menú* para el principal');
    return lines.join('\n');
  }

  function findFaqByBaseId(faqs, baseId) {
    for (var i = 0; i < (faqs || []).length; i++) {
      var f = faqs[i];
      if ((f.base_id || f.id) === baseId && f.activa !== false) return f;
    }
    return null;
  }

  // Motivo técnico de una falla remota, para el panel de debug (nunca se muestra al cliente).
  function errDetail(e) {
    if (!e) return null;
    if (e.detail) return String(typeof e.detail === 'object' ? JSON.stringify(e.detail) : e.detail).slice(0, 200);
    if (e.status) return 'HTTP ' + e.status;
    return String(e.kind || e.message || e).slice(0, 200);
  }

  function fmtFecha(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    if (p.length !== 3) return iso || '';
    return (+p[2]) + ' de ' + MESES[(+p[1]) - 1] + ' de ' + p[0];
  }

  // ───────────────────────── Motor ─────────────────────────
  function respond(text, state, ctx) {
    var started = Date.now();
    var cfg = withDefaults(ctx.config);
    var faqs = ctx.faqs || [];
    var holidays = ctx.holidays || [];
    var now = ctx.now ? new Date(ctx.now) : new Date();
    var ad = ctx.adapters || {};
    var st = clone(state);
    var raw = String(text || '').trim();
    var t = raw;
    st.turns++;
    st.history.push({ r: 'u', t: maskText(raw).slice(0, 300) });

    var out = { replies: [], debug: { intencion: null, tipo: null, faqId: null, faqPregunta: null, origen: null, confianza: null, escalamiento: null }, gap: null, escalation: null };

    function say(s) { out.replies.push(s); }
    function dbg(o) { Object.assign(out.debug, o); }
    function finish() {
      out.replies = out.replies.map(function (r) { return stylize(r, cfg); });
      out.replies.forEach(function (r) { st.history.push({ r: 'b', t: maskText(r).slice(0, 300) }); });
      if (st.history.length > 20) st.history = st.history.slice(-20);
      out.state = st;
      out.debug.latencyMs = Date.now() - started;
      out.debug.cliente = st.cliente ? { estado: st.cliente.estado, ref: st.cliente.ref } : null;
      return out;
    }
    function openMenu(id, prefix) {
      st.menuStack.push(id);
      say((prefix ? prefix + '\n\n' : '') + renderMenu(id));
    }
    function offerAsesor(motivo) {
      st.pending = { type: 'ofrece_asesor', motivo: motivo };
    }
    function answerFaq(f, conf, origen) {
      say(shorten(f.respuesta, cfg));
      dbg({ tipo: 'faq', faqId: f.base_id || f.id, faqPregunta: f.pregunta, origen: origen || 'base', confianza: conf });
    }

    function escalate(motivo) {
      var abierto = isOpen(now, cfg.horario, holidays);
      var payload = {
        conversationId: ctx.conversationId || null,
        motivo: motivo,
        intencion: out.debug.intencion,
        confianza: out.debug.confianza,
        fueraHorario: !abierto,
        cliente: st.cliente ? { estado: st.cliente.estado, ref: st.cliente.ref, id: st.cliente.id || null } : null,
        resumen: st.history.slice(-10).map(function (h) { return (h.r === 'u' ? 'Usuario: ' : 'Emi: ') + h.t; }).join('\n')
      };
      var texto = abierto ? cfg.mensajes.escalamiento
        : fill(cfg.mensajes.fueraHorario, { horario: horarioText(cfg.horario), proximo: nextOpenText(now, cfg.horario, holidays) });
      st.pending = null;
      // Una conversación abierta = un ticket: si ya existe, no se vuelve a crear.
      var prior = st.ticketId ? Promise.resolve({ ticketId: st.ticketId, created: false })
        : (ad.escalation ? ad.escalation.escalate(payload) : Promise.reject(new Error('sin EscalationSink')));
      return prior.then(function (res) {
        st.escalated = true;
        st.ticketId = res.ticketId;
        out.escalation = { motivo: motivo, ticketId: res.ticketId, created: !!res.created, fueraHorario: !abierto };
        dbg({ tipo: out.debug.tipo || 'escalamiento', escalamiento: out.escalation });
        say(fill(texto, { nombre: cfg.nombre }));
      }, function (e) {
        out.escalation = { motivo: motivo, ticketId: null, created: false, error: true, detalle: errDetail(e), fueraHorario: !abierto };
        dbg({ tipo: 'escalamiento', escalamiento: out.escalation });
        say('En este momento no pude registrar tu solicitud con un asesor. ' + cfg.mensajes.contactoRespaldo);
      });
    }

    function insufficient(motivo) {
      say(cfg.mensajes.insuficiente);
      if (cfg.escalar.bajaConfianza) offerAsesor(motivo || 'baja_confianza');
    }

    // ── Validación de documento ──
    function startDocValidation(next) {
      st.pending = { type: 'doc', next: next || 'inversionista', intentos: 0 };
      say('Para darte información de tu cuenta necesito validar tu identidad. Escríbeme tu número de documento (cédula o NIT, sin puntos ni dígito de verificación).');
    }
    function handleDoc(p) {
      var doc = normalizeDoc(t);
      if (doc.length < 5 || doc.length > 12) {
        if (!/\d/.test(t) && tokens(t).length > 2) { st.pending = null; return null; } // cambió de tema
        p.intentos++;
        if (p.intentos >= 2) { st.pending = null; say('No logré leer un número de documento válido.'); insufficient('documento_invalido'); return Promise.resolve(); }
        say('Ese número no parece un documento válido. Escríbelo solo con dígitos, sin puntos ni dígito de verificación.');
        return Promise.resolve();
      }
      dbg({ intencion: 'validar_documento', tipo: 'flujo' });
      if (!ad.client) { st.pending = null; insufficient('sin_adaptador'); return Promise.resolve(); }
      return ad.client.find(doc).then(function (c) {
        st.pending = null;
        if (!c || c.error) throw new Error('lookup');
        dbg({ origen: ad.client.source || 'remoto' });
        st.cliente = { estado: c.estado, nombre: c.nombre || null, ref: maskDoc(doc), id: c.id || null };
        var nombre = c.nombre ? ' ' + c.nombre : '';
        switch (c.estado) {
          case 'inversionista':
            openMenu(p.next, '¡Hola' + nombre + '! Ya validé tu identidad ✅');
            break;
          case 'inversionista+contratos_pendientes':
            var f98 = findFaqByBaseId(faqs, 98);
            openMenu(p.next, '¡Hola' + nombre + '! Ya validé tu identidad ✅\n\nTe cuento que tienes contratos pendientes por firmar; mientras no los firmes no podrás invertir.' + (f98 ? ' ' + f98.respuesta : ''));
            break;
          case 'mora':
            say('Hola' + nombre + '. Veo que tu cuenta tiene un pago pendiente. Para revisarlo contigo y darte opciones, lo mejor es que lo atienda un asesor. ¿Quieres que te comunique?');
            offerAsesor('cliente_mora');
            break;
          case 'prospecto':
            openMenu('registro', 'Veo que aún no has terminado tu registro como inversionista. Te ayudo a completarlo:');
            break;
          default:
            st.cliente = { estado: 'no_encontrado', ref: maskDoc(doc) };
            openMenu('no_encontrado', 'No encontré un registro con el documento ' + maskDoc(doc) + '.');
        }
      }).catch(function (e) {
        st.pending = null;
        st.cliente = null;
        dbg({ origen: (ad.client && ad.client.source) || 'remoto', error: 'lookup_cliente', detalle: errDetail(e) });
        insufficient('error_consulta');
      });
    }

    // ── Estado de operación ──
    function askOpNumber() {
      st.pending = { type: 'op_numero', intentos: 0 };
      say('Claro. ¿Cuál es el número de la operación que quieres consultar?');
    }
    function askEmpresa(num) {
      st.pending = { type: 'op_empresa', op: num, intentos: 0 };
      say('Gracias. Para validar, ¿cuál es el nombre o NIT de la empresa pagadora de la operación ' + num + '?');
    }
    function handleOpNumero(p) {
      var m = t.match(/\d{3,7}/);
      if (!m) {
        if (tokens(t).length > 2) { st.pending = null; return null; }
        p.intentos++;
        if (p.intentos >= 2) { st.pending = null; insufficient('operacion_invalida'); return Promise.resolve(); }
        say('Escríbeme solo el número de la operación, por ejemplo 7981.');
        return Promise.resolve();
      }
      dbg({ intencion: 'estado_operacion', tipo: 'flujo' });
      askEmpresa(m[0]);
      return Promise.resolve();
    }
    function handleOpEmpresa(p) {
      dbg({ intencion: 'estado_operacion', tipo: 'flujo' });
      if (!ad.operation) { st.pending = null; insufficient('sin_adaptador'); return Promise.resolve(); }
      return ad.operation.find(p.op, t).then(function (r) {
        if (!r || r.error) throw new Error('lookup');
        dbg({ origen: ad.operation.source || 'remoto' });
        if (!r.found) {
          p.intentos++;
          if (p.intentos >= 2) { st.pending = null; say('No logré validar la operación ' + p.op + ' con esa empresa.'); insufficient('operacion_no_validada'); return; }
          say('No encontré la operación ' + p.op + ' asociada a esa empresa. Revisa el nombre o NIT de la empresa pagadora y escríbelo de nuevo.');
          return;
        }
        st.pending = null;
        var emp = r.empresa.razonSocial;
        if (r.estado === 'al_dia') {
          say('La operación ' + r.numero + ' de ' + emp + ' está al día ✅.' + (r.fechaPagoEstimada ? ' La fecha estimada de pago es el ' + fmtFecha(r.fechaPagoEstimada) + '.' : ''));
          dbg({ resultado: 'al_dia' });
          return;
        }
        var etapa = r.estado === 'juridico' ? 'cobro jurídico' : 'cobro prejurídico';
        var lines = ['La operación ' + r.numero + ' de ' + emp + ' se encuentra en ' + etapa + '.'];
        if (r.ultimaComunicacion) {
          lines.push('La última comunicación que enviamos fue el ' + fmtFecha(r.ultimaComunicacion.fecha) + ':');
          lines.push('«' + r.ultimaComunicacion.asunto + '»');
          lines.push(r.ultimaComunicacion.resumen);
        } else {
          lines.push('Aún no hay comunicaciones enviadas sobre este proceso.');
        }
        lines.push('¿Esto resuelve tu inquietud o consulto si hay alguna actualización?');
        say(lines.join('\n'));
        st.pending = { type: 'op_confirma', op: r.numero, estado: r.estado, empresa: r.empresa, expediente: r.expediente || null };
        dbg({ resultado: r.estado });
      }).catch(function (e) {
        st.pending = null;
        dbg({ origen: (ad.operation && ad.operation.source) || 'remoto', error: 'lookup_operacion', detalle: errDetail(e) });
        insufficient('error_consulta');
      });
    }
    function handleOpConfirma(p) {
      var n = normalize(t);
      var quiereAct = /(actualiz|consult|revis|novedad|no me resuelve|no resuelve|^no\b)/.test(n);
      var resuelto = !quiereAct && (RE.SI.test(n) || /(resuelve|gracias|entendido|perfecto|listo)/.test(n));
      if (!quiereAct && !resuelto) { st.pending = null; return null; }
      st.pending = null;
      dbg({ intencion: 'estado_operacion', tipo: 'flujo' });
      if (resuelto) { say('¡Con gusto! Si necesitas algo más, aquí estoy.'); return Promise.resolve(); }
      var e = p.empresa || {};
      var lines = ['Esta es la información del proceso según la Baranda Virtual de la Superintendencia de Sociedades:'];
      lines.push('• Razón social: ' + (e.razonSocial || 'no disponible'));
      lines.push('• NIT: ' + (e.nit || 'no disponible'));
      if (p.expediente) {
        lines.push('• Expediente: ' + p.expediente.numero);
        lines.push('• Tipo de proceso: ' + p.expediente.tipoProceso);
      } else {
        lines.push('• Expediente: aún no registrado');
      }
      lines.push('• Tipo societario: ' + (e.tipoSocietario || 'no disponible'));
      lines.push('Puedes consultarlo en ' + cfg.barandaUrl + ' . Si necesitas más detalle, te comunico con un asesor.');
      say(lines.join('\n'));
      offerAsesor('actualizacion_operacion');
      return Promise.resolve();
    }

    function handleOfreceAsesor(p) {
      var n = normalize(t);
      if (RE.SI.test(n) || RE.ASESOR.test(t)) { dbg({ intencion: 'pide_asesor' }); return escalate(p.motivo === 'baja_confianza' ? 'baja_confianza' : p.motivo); }
      if (RE.NO.test(n)) { st.pending = null; dbg({ intencion: 'rechaza_asesor', tipo: 'flujo' }); say('Listo. Si quieres, escribe *menú* para ver las opciones o hazme otra pregunta.'); return Promise.resolve(); }
      st.pending = null;
      return null;
    }

    function handleMenuOption(menuId, opt) {
      dbg({ intencion: 'menu:' + menuId + '.' + opt.key, tipo: 'menu', origen: 'menu' });
      if (opt.goto) { openMenu(opt.goto, MENUS[opt.goto].titulo); return Promise.resolve(); }
      if (opt.faq) {
        var f = findFaqByBaseId(faqs, opt.faq);
        if (f) { answerFaq(f, 1, 'menu'); dbg({ tipo: 'menu' }); }
        else insufficient('faq_inactiva');
        return Promise.resolve();
      }
      switch (opt.action) {
        case 'validar_doc':
          if (st.cliente && st.cliente.estado && st.cliente.estado.indexOf('inversionista') === 0) { openMenu(opt.next, 'Ya validé tu identidad ✅'); return Promise.resolve(); }
          startDocValidation(opt.next); return Promise.resolve();
        case 'op_estado': askOpNumber(); return Promise.resolve();
        case 'agente': dbg({ intencion: 'pide_asesor' }); return escalate('pidio_asesor');
        case 'libre': say('Cuéntame tu pregunta con tus palabras y te ayudo.'); return Promise.resolve();
      }
      return Promise.resolve();
    }

    // ── Pipeline principal ──
    function run() {
      if (!t) { say('¿En qué te puedo ayudar?'); return Promise.resolve(); }

      // 1. Alias de menú (funcionan siempre, incluso con un flujo abierto)
      if (Menus.ALIAS_INICIO.test(t)) {
        st.pending = null; st.menuStack = [];
        dbg({ intencion: 'menu_inicio', tipo: 'menu', origen: 'menu' });
        openMenu('inicio'); return Promise.resolve();
      }
      if (Menus.ALIAS_VOLVER.test(t) && st.menuStack.length && !(st.pending && st.pending.type === 'doc' && /^\d+$/.test(t) && t.length > 1)) {
        st.pending = null;
        st.menuStack.pop();
        var prev = currentMenu(st) || 'inicio';
        if (!st.menuStack.length) st.menuStack = [];
        else st.menuStack.pop();
        dbg({ intencion: 'menu_volver', tipo: 'menu', origen: 'menu' });
        openMenu(prev); return Promise.resolve();
      }

      // 2. Flujos abiertos
      if (st.pending) {
        var p = st.pending, r = null;
        if (p.type === 'doc') r = handleDoc(p);
        else if (p.type === 'op_numero') r = handleOpNumero(p);
        else if (p.type === 'op_empresa') r = handleOpEmpresa(p);
        else if (p.type === 'op_confirma') r = handleOpConfirma(p);
        else if (p.type === 'ofrece_asesor') r = handleOfreceAsesor(p);
        if (r) return r;
      }

      // 3. Opción de menú
      var mid = currentMenu(st);
      if (mid && /^\d$/.test(t)) {
        var opt = MENUS[mid].opciones.filter(function (o) { return o.key === t; })[0];
        if (opt) return handleMenuOption(mid, opt);
        say('Esa opción no está en el menú.\n\n' + renderMenu(mid));
        dbg({ intencion: 'menu_opcion_invalida', tipo: 'menu', origen: 'menu' });
        return Promise.resolve();
      }

      // 4. Reglas por intención
      if (RE.ASESOR.test(t)) {
        dbg({ intencion: 'pide_asesor', tipo: 'regla', origen: 'regla' });
        if (cfg.escalar.pideAsesor) return escalate('pidio_asesor');
        say('En este momento te puedo ayudar yo. ' + cfg.mensajes.contactoRespaldo); return Promise.resolve();
      }
      if (RE.RECLAMO.test(t)) {
        dbg({ intencion: 'reclamo', tipo: 'regla', origen: 'regla' });
        say('Lamento mucho lo que estás viviendo. Quiero que esto se resuelva bien.');
        if (cfg.escalar.reclamo) return escalate('reclamo');
        say(cfg.mensajes.contactoRespaldo); return Promise.resolve();
      }
      var sal = t.match(RE.SALUDO);
      if (sal) {
        var resto = t.slice(sal[0].length).trim();
        if (tokens(resto).length === 0) {
          st.menuStack = [];
          dbg({ intencion: 'saludo', tipo: 'regla', origen: 'regla' });
          openMenu('inicio', fill(cfg.mensajes.saludo, { nombre: cfg.nombre }));
          return Promise.resolve();
        }
        t = resto; // saludo + pregunta: se sigue con la pregunta
      }
      if (RE.ACCESO_MERCADO.test(t)) {
        var f128 = findFaqByBaseId(faqs, 128);
        dbg({ intencion: 'acceso_mercado', tipo: 'regla' });
        if (f128) { answerFaq(f128, 1, 'regla'); dbg({ tipo: 'regla' }); return Promise.resolve(); }
      }
      if (RE.SIGNUP.test(normalize(t))) {
        dbg({ intencion: 'registro', tipo: 'regla', origen: 'regla' });
        openMenu('registro', '¡Qué bueno que quieras unirte! 🙌'); return Promise.resolve();
      }
      var ops = t.match(RE.OP_STRONG);
      if (ops) { dbg({ intencion: 'estado_operacion', tipo: 'flujo', origen: 'regla' }); askEmpresa(ops[1]); return Promise.resolve(); }
      if (RE.OP_ESTADO.test(t)) { dbg({ intencion: 'estado_operacion', tipo: 'flujo', origen: 'regla' }); askOpNumber(); return Promise.resolve(); }

      // 5. Búsqueda en FAQs
      var hint = mid && MENUS[mid].categoria;
      var res = searchFaqs(t, faqs, hint);
      var best = res.best;
      out.debug.candidatos = res.ranked.map(function (x) { return { id: x.faq.base_id || x.faq.id, score: +x.score.toFixed(3) }; });
      if (best && best.score >= cfg.threshold) {
        dbg({ intencion: 'faq' });
        answerFaq(best.faq, +best.score.toFixed(3), 'base');
        return Promise.resolve();
      }

      // 6. Sin respuesta
      out.gap = { pregunta: maskText(raw), score: best ? +best.score.toFixed(3) : 0, faqSugerida: best ? (best.faq.base_id || best.faq.id) : null };
      dbg({ intencion: 'sin_respuesta', tipo: 'gap', origen: 'base', confianza: out.gap.score });
      insufficient('baja_confianza');
      return Promise.resolve();
    }

    return run().then(finish);
  }

  return {
    CATEGORIAS: CATEGORIAS, RE: RE,
    defaults: defaults, withDefaults: withDefaults, newState: newState, respond: respond,
    normalize: normalize, tokens: tokens, stem: stem, dice: dice, score: score, searchFaqs: searchFaqs,
    normalizeDoc: normalizeDoc, maskDoc: maskDoc, maskText: maskText,
    isOpen: isOpen, nextOpenText: nextOpenText, horarioText: horarioText,
    stylize: stylize, renderMenu: renderMenu, MENUS: MENUS
  };
});
