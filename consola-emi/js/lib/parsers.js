/* Ingesta de documentos y exportar/importar.
 * CSV/TXT → FAQs directas. DOCX/XLSX → texto/filas → borrador de FAQs que exige revisión humana.
 * PDF no se extrae en el navegador (ver README, pendiente para n8n). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiParsers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CATEGORIAS = ['Producto e inversión', 'Pagos y facturación', 'Requisitos y documentos', 'Estados y tiempos', 'Horarios', 'Otro'];

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  function matchCategoria(c) {
    var n = norm(c);
    if (!n) return 'Otro';
    for (var i = 0; i < CATEGORIAS.length; i++) if (norm(CATEGORIAS[i]) === n) return CATEGORIAS[i];
    for (var j = 0; j < CATEGORIAS.length; j++) if (norm(CATEGORIAS[j]).indexOf(n) === 0) return CATEGORIAS[j];
    return 'Otro';
  }

  // CSV con comillas, separador "," o ";" (Excel en español usa ";").
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(function (c) { return c.trim(); })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim(); })) rows.push(row);
    return rows;
  }

  // Filas con encabezado (Pregunta, Respuesta, Categoría, Palabras clave) → FAQs.
  function rowsToFaqs(rows) {
    if (!rows.length) return { faqs: [], errors: ['El archivo está vacío.'] };
    var hdr = rows[0].map(norm);
    function col(names) { for (var i = 0; i < hdr.length; i++) if (names.indexOf(hdr[i]) !== -1) return i; return -1; }
    var iP = col(['pregunta', 'question', 'preguntas']);
    var iR = col(['respuesta', 'answer', 'respuestas']);
    var iC = col(['categoria', 'category']);
    var iK = col(['palabras clave', 'keywords', 'palabras', 'claves']);
    var errors = [];
    var body = rows;
    if (iP === -1 || iR === -1) {
      // Sin encabezado reconocible: se asume Pregunta, Respuesta, Categoría, Palabras clave.
      iP = 0; iR = 1; iC = 2; iK = 3;
    } else body = rows.slice(1);
    var faqs = [];
    body.forEach(function (r, n) {
      var p = (r[iP] || '').trim(), a = (r[iR] || '').trim();
      if (!p && !a) return;
      if (!p || !a) { errors.push('Fila ' + (n + 2) + ': falta la pregunta o la respuesta.'); return; }
      faqs.push({ pregunta: p, respuesta: a, categoria: matchCategoria(iC >= 0 ? r[iC] : ''), keywords: iK >= 0 ? (r[iK] || '').trim() : '' });
    });
    return { faqs: faqs, errors: errors };
  }

  function csvToFaqs(text) { return rowsToFaqs(parseCSV(text)); }

  // Texto libre: pares "P:/R:" o una línea que termina en "?" seguida de su respuesta.
  function textToFaqs(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.trim(); });
    var faqs = [], cur = null;
    function push() { if (cur && cur.pregunta && cur.respuesta.trim()) faqs.push({ pregunta: cur.pregunta, respuesta: cur.respuesta.trim(), categoria: 'Otro', keywords: '' }); cur = null; }
    lines.forEach(function (l) {
      if (!l) return;
      var mP = l.match(/^(p|pregunta)\s*[:.-]\s*(.+)$/i);
      var mR = l.match(/^(r|respuesta)\s*[:.-]\s*(.+)$/i);
      if (mP) { push(); cur = { pregunta: mP[2].trim(), respuesta: '' }; return; }
      if (mR && cur) { cur.respuesta += (cur.respuesta ? ' ' : '') + mR[2].trim(); return; }
      if (/[?¿].*\?$|\?$/.test(l) && l.length <= 220) { push(); cur = { pregunta: l.replace(/^\d+[.)-]\s*/, ''), respuesta: '' }; return; }
      if (cur) cur.respuesta += (cur.respuesta ? ' ' : '') + l;
    });
    push();
    return { faqs: faqs, errors: faqs.length ? [] : ['No encontré pares de pregunta y respuesta. Usa líneas "P: …" y "R: …" o preguntas que terminen en "?".'] };
  }

  function decodeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); }).replace(/&amp;/g, '&');
  }

  // word/document.xml → texto, un párrafo por línea.
  function docxXmlToText(xml) {
    return (String(xml).match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).map(function (p) {
      return (p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map(function (t) { return decodeXml(t.replace(/<[^>]+>/g, '')); }).join('');
    }).join('\n');
  }

  // xl/sharedStrings.xml + xl/worksheets/sheet1.xml → matriz de celdas.
  function xlsxToRows(sharedXml, sheetXml) {
    var shared = (String(sharedXml || '').match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      return (si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return decodeXml(t.replace(/<[^>]+>/g, '')); }).join('');
    });
    function colIndex(ref) { var letters = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }
    var rows = [];
    (String(sheetXml).match(/<row[\s\S]*?<\/row>/g) || []).forEach(function (r) {
      var row = [];
      (r.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
        var ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
        var type = (c.match(/ t="(\w+)"/) || [])[1];
        var v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var inline = (c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        var val = type === 's' ? shared[+v] : type === 'inlineStr' ? decodeXml(inline || '') : decodeXml(v || '');
        row[ref ? colIndex(ref) : row.length] = val == null ? '' : val;
      });
      for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      if (row.some(function (x) { return String(x).trim(); })) rows.push(row);
    });
    return rows;
  }

  // Lector mínimo de ZIP (DOCX/XLSX) con DecompressionStream nativo.
  function readZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error('No es un archivo ZIP válido'));
    var count = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), entries = [];
    for (var n = 0; n < count; n++) {
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      var local = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
      entries.push({ name: name, method: method, csize: csize, local: local });
      off += 46 + nlen + xlen + clen;
    }
    var files = {};
    return Promise.all(entries.map(function (e) {
      var lnl = dv.getUint16(e.local + 26, true), lxl = dv.getUint16(e.local + 28, true);
      var data = u8.subarray(e.local + 30 + lnl + lxl, e.local + 30 + lnl + lxl + e.csize);
      if (e.method === 0) { files[e.name] = data; return null; }
      if (e.method !== 8) return null;
      var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (ab) { files[e.name] = new Uint8Array(ab); });
    })).then(function () { return files; });
  }

  function extractOffice(buf, ext) {
    return readZip(buf).then(function (files) {
      var td = new TextDecoder();
      if (ext === 'docx') {
        if (!files['word/document.xml']) throw new Error('El DOCX no tiene contenido legible');
        return textToFaqs(docxXmlToText(td.decode(files['word/document.xml'])));
      }
      var sheet = files['xl/worksheets/sheet1.xml'];
      if (!sheet) throw new Error('El XLSX no tiene una primera hoja legible');
      return rowsToFaqs(xlsxToRows(files['xl/sharedStrings.xml'] ? td.decode(files['xl/sharedStrings.xml']) : '', td.decode(sheet)));
    });
  }

  // ───────────── Exportar / Importar ─────────────
  var SCHEMA = 'emi-console';
  var SCHEMA_VERSION = 1;

  function buildExport(data) {
    return {
      schema: SCHEMA, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      config: data.config,
      faqs: (data.faqs || []).map(function (f) {
        return { base_id: f.base_id || null, pregunta: f.pregunta, respuesta: f.respuesta, categoria: f.categoria, keywords: f.keywords || '', fuente: f.fuente || '', activa: f.activa !== false };
      }),
      holidays: (data.holidays || []).map(function (h) { return { fecha: h.fecha, nombre: h.nombre }; })
    };
  }

  function validateImport(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['El archivo no es un JSON de objeto.'] };
    if (obj.schema !== SCHEMA) errors.push('Campo "schema" debe ser "' + SCHEMA + '".');
    if (obj.version !== SCHEMA_VERSION) errors.push('Versión de esquema no soportada: ' + obj.version + '.');
    if (obj.config !== undefined) {
      var c = obj.config;
      if (typeof c !== 'object' || c === null) errors.push('"config" debe ser un objeto.');
      else {
        if (c.threshold !== undefined && !(typeof c.threshold === 'number' && c.threshold > 0 && c.threshold < 1)) errors.push('"config.threshold" debe ser un número entre 0 y 1.');
        if (c.horario && !/^\d{2}:\d{2}$/.test(c.horario.inicio || '')) errors.push('"config.horario.inicio" debe tener formato HH:MM.');
        if (c.horario && !/^\d{2}:\d{2}$/.test(c.horario.fin || '')) errors.push('"config.horario.fin" debe tener formato HH:MM.');
        if (c.horario && !Array.isArray(c.horario.dias)) errors.push('"config.horario.dias" debe ser una lista.');
      }
    }
    if (obj.faqs !== undefined) {
      if (!Array.isArray(obj.faqs)) errors.push('"faqs" debe ser una lista.');
      else obj.faqs.forEach(function (f, i) {
        if (!f || typeof f.pregunta !== 'string' || !f.pregunta.trim()) errors.push('FAQ ' + (i + 1) + ': falta "pregunta".');
        if (!f || typeof f.respuesta !== 'string' || !f.respuesta.trim()) errors.push('FAQ ' + (i + 1) + ': falta "respuesta".');
        if (f && CATEGORIAS.indexOf(f.categoria) === -1) errors.push('FAQ ' + (i + 1) + ': categoría no válida "' + f.categoria + '".');
      });
    }
    if (obj.holidays !== undefined) {
      if (!Array.isArray(obj.holidays)) errors.push('"holidays" debe ser una lista.');
      else obj.holidays.forEach(function (h, i) { if (!h || !/^\d{4}-\d{2}-\d{2}$/.test(h.fecha || '')) errors.push('Festivo ' + (i + 1) + ': "fecha" debe ser AAAA-MM-DD.'); });
    }
    return { ok: errors.length === 0, errors: errors.slice(0, 20), data: obj };
  }

  return {
    CATEGORIAS: CATEGORIAS, parseCSV: parseCSV, rowsToFaqs: rowsToFaqs, csvToFaqs: csvToFaqs, textToFaqs: textToFaqs,
    docxXmlToText: docxXmlToText, xlsxToRows: xlsxToRows, readZip: readZip, extractOffice: extractOffice,
    buildExport: buildExport, validateImport: validateImport, matchCategoria: matchCategoria
  };
});
