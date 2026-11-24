// Arma el negocio con las reglas acordadas (1 negocio por cliente, con Pagador #1..#N).
const n = $('Normalizar radicación').first().json;
const r = $('Resolver campos').first().json;
const props = $('HS: propiedades de negocio').first().json.results || [];
const hist = $('HS: histórico del cliente').first().json || {};
const emp = $('HS: empresas de los pagadores').first().json || {};
const c = n.condiciones || {};
const ops = n.operaciones;
const varios = ops.length > 1;
const avisos = [...r.avisos];
const faltantes = [];
const invalidos = [];

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const porEtiqueta = {};
props.forEach(p => { const k = norm(p.label); if (!porEtiqueta[k]) porEtiqueta[k] = p; });
// Unificación de campos (prueba piloto 4, 12-nov-2026): si en HubSpot la etiqueta queda "Nombre (nombre interno)",
// también se encuentra por el nombre sin el paréntesis final.
const porBase = {};
const base = t => norm(String(t == null ? '' : t).replace(/\s*\([^()]*\)\s*$/, ''));
props.forEach(p => { const k = base(p.label); if (k && !porBase[k]) porBase[k] = p; });
const buscar = label => porEtiqueta[norm(label)] || porBase[norm(label)] || porBase[base(label)] || null;
const dos = x => Math.round((Number(x) || 0) * 100) / 100;
const pct = x => dos(x).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const pesos = x => '$ ' + Math.round(Number(x) || 0).toLocaleString('es-CO');
const soloDigitos = v => String(v == null ? '' : v).replace(/\D/g, '');

const properties = {};
const SINONIMOS = { si: ['si', 'true', 'yes'], no: ['no', 'false'] };

// Escribe una propiedad buscándola por su etiqueta y convirtiendo el valor al tipo que tiene en HubSpot.
function poner(label, valor){
  const p = buscar(label);
  if (!p) { faltantes.push(label); return; }
  if (valor === null || valor === undefined || valor === '') return;
  if (p.type === 'enumeration' || p.type === 'bool') {
    const opciones = p.options || [];
    const buscados = SINONIMOS[norm(valor)] || [norm(valor)];
    const op = opciones.find(o => buscados.includes(norm(o.label)) || buscados.includes(norm(o.value)));
    // Si no hay coincidencia exacta (p. ej. la opción dice "Factoring por endoso"), se acepta la ÚNICA opción que contenga la palabra.
    if (!op) {
      const contiene = opciones.filter(o => buscados.some(b => (' ' + norm(o.label) + ' ').includes(' ' + b + ' ')));
      if (contiene.length === 1) { properties[p.name] = contiene[0].value; return; }
    }
    if (!op) { invalidos.push(label + ': "' + valor + '" no es una opción (' + opciones.map(o => o.label).join(' / ') + ')'); return; }
    properties[p.name] = op.value;
  } else if (p.type === 'number') {
    const num = Number(valor);
    if (!isFinite(num)) { invalidos.push(label + ': es numérico y no admite "' + valor + '"'); return; }
    properties[p.name] = num;
  } else {
    properties[p.name] = String(valor);
  }
}

// 1-2. Nombre (cliente - pagador o "Varios" - iniciales) y propietario
const nombreComercial = r.owner ? ((r.owner.firstName || '') + ' ' + (r.owner.lastName || '')) : n.comercial;
const iniciales = norm(nombreComercial).split(' ').filter(Boolean).map(w => w[0].toUpperCase()).join('') || 'SC';
const dealName = n.nombreEmisor + ' - ' + (varios ? 'Varios' : (ops[0].razonSocialPagador || 'NIT ' + ops[0].nitPagador)) + ' - ' + iniciales;
properties.dealname = dealName;
properties.pipeline = r.pipelineId;
properties.dealstage = r.etapaId;
if (r.owner) properties.hubspot_owner_id = String(r.owner.id);

// 3-4. Cliente del KAM = emisor
poner('Nombre empresa (cliente del KAM)', n.nombreEmisor);
poner('Nit empresa (cliente del KAM)', n.nitEmisor);

// 5-6. Ruta deal (y su desplegable siguiente) y Tipo de cliente: se copian del último negocio del cliente
const anterior = (hist.results || [])[0];
const pTipo = buscar('Tipo de cliente');
if (anterior) {
  r.copiarDelHistorico.forEach(nombre => {
    const v = anterior.properties ? anterior.properties[nombre] : null;
    if (v !== null && v !== undefined && v !== '') properties[nombre] = v;
  });
  if (!buscar('Ruta deal')) faltantes.push('Ruta deal');
  else if (!properties[buscar('Ruta deal').name]) avisos.push('El negocio anterior del cliente no tiene Ruta deal.');
} else {
  if (!buscar('Ruta deal')) faltantes.push('Ruta deal');
  avisos.push('Sin negocio anterior del cliente en HubSpot' + (hist.error ? ' (error al buscar: ' + (hist.error.message || hist.error) + ')' : '') + ': Ruta deal quedó vacía.');
}
if (!pTipo) faltantes.push('Tipo de cliente');
else if (!properties[pTipo.name]) poner('Tipo de cliente', r.config.TIPO_CLIENTE_POR_DEFECTO);

// 7-10. Tasas (prueba piloto 3, 9-nov-2026, Karen):
//  - Fee del negocio              = % Fee del período (el del panel, automático H20 o digitado)
//  - Tasa Máxima al Inversionista = tasa inversionista digitada
//  - Tasa Máxima Final al cliente = Tasa cliente (M.V.) sobre el valor del anticipo (liquidación, J7) — ajuste Karen 9-nov 4:34 p.m.
//  - Efectivo anual               = Fee Plataform (E.A.) que se ve en el panel
// Cada pagador trae sus condiciones; si el dato es igual en todos se envía, si cambia va "Varios"
// (o queda vacío con aviso cuando el campo de HubSpot es numérico).
const condOp = o => o.condiciones || c;
const aNum = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
// Sin aproximaciones (prueba piloto 3): se envía el valor tal como está en el panel.
//  - Lo digitado (tasa inversionista, % Fee del período) va exacto.
//  - Lo calculado va con los mismos decimales que muestra el panel: tasa cliente M.V. 2 decimales, Fee E.A. 3 decimales.
// dec = null -> sin redondear; texto = cómo se escribe si el campo de HubSpot es de texto.
function ponerTasa(label, vals, dec, conComa){
  const p = buscar(label);
  if (!p) { faltantes.push(label); return; }
  if (vals.some(v => !isFinite(v))) { avisos.push(label + ': el panel no envió el dato, quedó vacío.'); return; }
  const r = vals.map(v => dec == null ? v : Number(v.toFixed(dec)));
  const texto = v => { const t = dec == null ? String(v) : v.toFixed(dec); return conComa ? t.replace('.', ',') : t; };
  // Con varias operaciones el campo del negocio dice "Varios" (el detalle de cada una va en la nota).
  if (!varios) {
    poner(label, p.type === 'number' ? r[0] : texto(r[0]));
  } else if (p.type === 'number') {
    avisos.push(label + ' es un campo numérico en HubSpot y no admite "Varios": quedó vacío (cambiar la propiedad a texto).');
  } else {
    poner(label, 'Varios');
  }
}
ponerTasa('Fee del negocio', ops.map(o => aNum(condOp(o).feePeriodoPct)), 3, true);
ponerTasa('Tasa Máxima al Inversionista', ops.map(o => { const k = condOp(o); return aNum(k.tasaMaximaInversionistaEA != null ? k.tasaMaximaInversionistaEA : k.tasaInversionistaEA); }), null);
ponerTasa('Tasa Máxima Final al cliente', ops.map(o => aNum((o.liquidacion || {}).nominalMensual) * 100), 2);
ponerTasa('Efectivo anual', ops.map(o => { const k = condOp(o); return aNum(k.feeAplicadoEA != null ? k.feeAplicadoEA : k.feePlataformEA); }), 3);

// 11-13. Monto, costos, solicitud
const total = ops.reduce((a, o) => a + (Number((o.liquidacion || {}).valorFacturas) || 0), 0);
properties.amount = Math.round(total);
poner('Valor (monto del negocio)', Math.round(total));
if (String(n.tipoOperacion).toLowerCase() === 'factoring') poner('Quién asume costos de la operación', 'Emisor');
else avisos.push('Quién asume costos: la regla solo está definida para Factoring (llegó "' + n.tipoOperacion + '").');
poner('Solicitud', 'Operación');
// Plazo y desembolso de la liquidación del panel (fecha en AAAA-MM-DD, formato que acepta HubSpot).
ponerTasa('Plazo de la Op. en días', ops.map(o => aNum(condOp(o).plazoDias)), null);
// Fecha primer desembolso: la más temprana de las operaciones.
poner('Fecha primer desembolso', ops.map(o => condOp(o).fechaDesembolso).filter(Boolean).sort()[0] || c.fechaDesembolso);

// 14-22. Un bloque por pagador
const siNo = v => { const k = norm(v); return k === 'si' ? 'Sí' : k === 'no' ? 'No' : v; };
ops.forEach((o, i) => {
  const k = '#' + (i + 1);
  const L = t => t.replace('#1', k);
  poner(L('¿Pagador #1?'), 'Sí');
  poner(L('Razón social - Pagador #1'), o.razonSocialPagador);
  poner(L('Nit Pagador #1'), o.nitPagador);
  poner(L('Tipo de factoring (Pagador #1)'), 'ENDOSO');
  poner(L('¿Eventos? Pagador #1 (FE)'), 'Aceptación');
  if (o.confirmacionCorreo) poner(L('¿Confirmación de correo? - Pagador #1'), siNo(o.confirmacionCorreo));
  else avisos.push('Pagador ' + k + ': sin dato de confirmación de correo en el mapeo de Riesgo.');
  poner(L('¿Pago directo del pagador? - Pagador #1'), 'Sí');
  poner(L('¿Tiene factura para negociar? (Pagador #1)'), 'Sí');
  poner(L('¿Monto de la factura a negociar? (Pagador #1)'), Math.round(Number((o.liquidacion || {}).valorFacturas) || 0));
});

// 24. Asociar las empresas de los pagadores
const empresas = emp.results || [];
if (emp.error) avisos.push('No se pudieron buscar las empresas de los pagadores: ' + (emp.error.message || emp.error));
const associations = [];
ops.forEach(o => {
  const e = empresas.find(x => soloDigitos(x.properties && x.properties.nit).startsWith(soloDigitos(o.nitPagador)) && soloDigitos(o.nitPagador))
         || empresas.find(x => norm(x.properties && x.properties.name) === norm(o.razonSocialPagador));
  if (e) associations.push({ to: { id: e.id }, types: [ { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 } ] });
  else avisos.push('El pagador ' + (o.razonSocialPagador || o.nitPagador) + ' no existe como empresa en HubSpot: no se asoció.');
});

// 26. Nota para Lucy (prueba piloto 3, 9-nov-2026): un solo comentario con un bloque por operación
// y los valores de cada una. Del fee solo se indica "AUMENTO DE FEE" cuando el comercial lo subió.
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pctTxt = (v, dec) => isFinite(v) ? (dec == null ? String(v) : v.toFixed(dec)).replace('.', ',') + '%' : 'sin dato';
const subioFee = k => {
  const fp = aNum(k.feePeriodoPct), fa = aNum(k.feePeriodoAutomaticoPct), f30 = aNum(k.feePlataform30Pct);
  return (isFinite(fp) && isFinite(fa) && fp - fa > 1e-9) || (!!k.feePlataformAjustado && isFinite(f30) && f30 - 0.53 > 1e-9);
};
// Facturas de cada operación (pedido 23-nov-2026): mismas columnas del mapeo de Producto.
// Lo que la consulta de facturas no trae sale como "sin dato" (no se inventa).
const fechaTxt = v => { const t = String(v == null ? '' : v).trim(); const m = t.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  return m ? m[3].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[1] : (t || 'sin dato'); };
const dato = v => (v === null || v === undefined || v === '') ? 'sin dato' : esc(v);
const dinero = v => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? 'sin dato' : pesos(v);
const tablaFacturas = (o, k) => {
  const fs = Array.isArray(o.facturas) ? o.facturas : [];
  if (!fs.length) return '';
  const th = t => '<th style="border:1px solid #ccc;padding:3px 6px;text-align:left">' + t + '</th>';
  const td = t => '<td style="border:1px solid #ccc;padding:3px 6px">' + t + '</td>';
  return '<table style="border-collapse:collapse;font-size:12px"><tr>' +
    ['NUMERO FACTURA', 'FECHA VENCIMIENTO', 'FECHA APROXIMADA DE PAGO', 'FORMA PAGO', 'DESCUENTO', 'VALOR NETO CALCULADO'].map(th).join('') + '</tr>' +
    fs.map(f => '<tr>' + [
      dato(f.folio),
      fechaTxt(f.fechaVencimiento),
      fechaTxt(f.fechaAproximadaPago || k.fechaPagoEfectiva),
      dato(f.formaPago),
      dinero(f.descuento),
      dinero(f.valorNetoCalculado)
    ].map(td).join('') + '</tr>').join('') + '</table>';
};
// La carpeta se crea antes que el negocio; su enlace llega en el cuerpo del webhook.
let carpeta = {};
try { carpeta = ($('Webhook: radicar negocio').first().json.body || {}).carpeta || n.carpeta || {}; } catch (e) { carpeta = n.carpeta || {}; }
// Retenciones de la operación: nombre y tasa de las que aplican; 'ninguna' si no aplica ninguna.
const retTxt = r => {
  if (!r) return 'sin dato';
  const lista = [['reteFuente', 'Retefuente'], ['reteIca', 'Reteica'], ['reteIva', 'Reteiva']]
    .filter(([c]) => r[c] && r[c].aplica)
    .map(([c, nom]) => nom + ' ' + pctTxt(aNum(r[c].tasaPct), null));
  return lista.length ? lista.join(', ') : 'ninguna';
};
// Tipo de operación: en esta fase todo factoring va por endoso (igual que "Tipo de factoring (Pagador #N)" = ENDOSO).
const tipoOpTxt = /^factoring$/i.test(String(n.tipoOperacion || '').trim()) ? 'Factoring por endoso'
  : (n.tipoOperacion ? esc(n.tipoOperacion) + ' (modalidad por definir)' : 'sin dato');
// Si el comercial usó un anticipo menor al aprobado por Riesgo, queda escrito en la nota (Jenny, 24-nov-2026).
const anticipoVsRiesgo = k => {
  const a = aNum(k.anticipoPct), m = aNum(k.anticipoMaximoAprobado);
  if (!isFinite(m)) return ' (aprobado por Riesgo: sin dato)';
  return a < m - 1e-9 ? ' <strong>(menor al aprobado por Riesgo: ' + pctTxt(m, null) + ')</strong>' : ' (aprobado por Riesgo: ' + pctTxt(m, null) + ')';
};
const bloques = ops.map((o, i) => {
  const k = condOp(o), l = o.liquidacion || {};
  const inv = aNum(k.tasaMaximaInversionistaEA != null ? k.tasaMaximaInversionistaEA : k.tasaInversionistaEA);
  const fee = aNum(k.feeAplicadoEA != null ? k.feeAplicadoEA : k.feePlataformEA);
  return '<p><strong>Operación ' + (i + 1) + ': ' + esc(o.razonSocialPagador || 'NIT ' + o.nitPagador) + ' (NIT ' + esc(o.nitPagador) + ')</strong>' +
    // Sesión con Jenny (24-nov-2026): tipo de operación en cada bloque y número de operación para actualizar a mano.
    '<br>Tipo de operación: ' + tipoOpTxt +
    '<br>N° de operación (plataforma): pendiente, se actualiza a mano cuando se cargue en la plataforma' +
    '<br>Valor (monto del negocio): ' + pesos(l.valorFacturas) +
    '<br>Plazo de la Op. en días (Plazo en días): ' + (isFinite(aNum(k.plazoDias)) ? k.plazoDias + ' días' : 'sin dato') +
    '<br>Fee del negocio (% Fee del período): ' + pctTxt(aNum(k.feePeriodoPct), 3) +
    '<br>Tasa Máxima al Inversionista (Rentabilidad máxima): ' + pctTxt(inv, null) +
    '<br>Tasa Máxima Final al cliente (Tasa M.V. anticipo): ' + pctTxt(aNum(l.nominalMensual) * 100, 2) +
    '<br>Efectivo anual (Fee Plataform E.A.): ' + pctTxt(fee, 3) +
    // Sesión con cliente real (23-nov-2026): anticipo y spread solo mora (archivo SPREAD).
    '<br>% Anticipo: ' + pctTxt(aNum(k.anticipoPct), null) + anticipoVsRiesgo(k) +
    // Pedido de Jenny (24-nov-2026): retenciones aplicadas en la operación.
    '<br>Retenciones: ' + retTxt(k.retenciones) + (isFinite(aNum(l.totalRetenciones)) ? ' · Total ' + pesos(l.totalRetenciones) : '') +
    '<br>% Spread rent. solo mora: ' + (isFinite(aNum(k.spreadSoloMora)) ? aNum(k.spreadSoloMora).toFixed(2) : 'sin dato') +
      (isFinite(aNum(k.usuraEA)) ? ' (usura ' + esc(k.mesUsura || '') + ': ' + pctTxt(aNum(k.usuraEA), 2) + ', tope Plataform ' + pctTxt(aNum(k.topeUsuraEA), 2) + ')' : '') +
    (subioFee(k) ? '<br><strong>AUMENTO DE FEE</strong>' : '') + '</p>' +
    tablaFacturas(o, k);
});
const pagadores = ops.map(o => o.razonSocialPagador || 'NIT ' + o.nitPagador).join(', ');
const notaHtml = '<p>@' + r.config.MENCIONAR + ' cliente listo para operar. Resumen para tu validación y aprobación.</p>' +
  '<p>Cliente: ' + esc(n.nombreEmisor) + ' (NIT ' + n.nitEmisor + ')<br>Valor (monto del negocio) total: ' + pesos(total) +
  '<br>Radicado por: ' + esc(nombreComercial || 'sin nombre') + ' desde el panel comercial.' +
  // Sesión con cliente real (23-nov-2026): enlace de la carpeta de la operación (mapeo, cotización, carta de endoso).
  '<br>Carpeta de la operación: ' + (carpeta.url ? '<a href="' + esc(carpeta.url) + '">' + esc(carpeta.nombre || carpeta.url) + '</a>' : 'no se creó' + (carpeta.error ? ' (' + esc(carpeta.error) + ')' : '')) + '</p>' +
  bloques.join('');

return [{ json: { body: { properties, associations }, dealName, pagadores, notaHtml,
  ownerId: r.owner ? String(r.owner.id) : null, avisos, faltantes, invalidos } }];
