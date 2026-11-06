// Pruebas del panel de radicación comercial (node:test, sin dependencias).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function leerHtml() {
  const candidatos = [path.join(__dirname, 'index.html'), path.join(process.cwd(), 'index.html')];
  for (const p of candidatos) { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); }
  throw new Error('No se encontró index.html');
}

// DOM mínimo: cada id devuelve un objeto con las propiedades que usa el panel.
function crearDom() {
  const els = {};
  const el = () => ({
    value: '', checked: false, disabled: false, title: '', textContent: '', className: '', innerHTML: '',
    style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, querySelectorAll() { return []; }
  });
  return {
    document: { getElementById: (id) => (els[id] = els[id] || el()) },
    els
  };
}

function cargarPanel() {
  const html = leerHtml();
  const script = html.split('<script>')[1].split('</script>')[0];
  const { document, els } = crearDom();
  // Valores por defecto como en el HTML.
  Object.assign(document.getElementById('c_anticipo'), { value: '90' });
  Object.assign(document.getElementById('c_dias'), { value: '60' });
  Object.assign(document.getElementById('c_modo_plazo'), { value: 'dias' });
  Object.assign(document.getElementById('c_fondeo'), { value: 'crowd' });
  Object.assign(document.getElementById('c_anio'), { value: '2026' });
  Object.assign(document.getElementById('c_tasa_rf'), { value: '11' });
  Object.assign(document.getElementById('c_tasa_ri'), { value: '0.966' });
  Object.assign(document.getElementById('c_tasa_riva'), { value: '15' });
  const localStorage = { getItem() { return null; }, setItem() {} };
  const fetch = () => Promise.reject(new Error('sin red en pruebas'));
  const fn = new Function('document', 'localStorage', 'fetch',
    script + '\n;return { setFeeManual: function(v){ feeManualPct = v; }, setOperaciones: function(o){ operaciones = o; }, datosCotizacion, construirCotizacionPDF, crearCarpetaYCotizacion, setFetch: function(f){ fetch = f; }, setEmisorRiesgo: function(e){ emisorRiesgo = e; }, pintar_validaciones, setFee30: function(v){ fee30Pct = v; }, feeEAAplicado, pintar_liquidacion, postBigQuery, listarPagadores, getPagadores: function(){ return pagadoresDisponibles; }, setToken: function(v){ consultaEmisorToken = v; }, setEsperaBQ: function(v){ ESPERA_BQ_MS = v; }, PdfSimple, mapeoFacturasCSV, esSi, CARPETA_WEBHOOK_URL, feeAplicado, feeEsManual, liquidar, feePeriodo, tasaMaximaFinalCliente, tasaMaximaInversionista, PARAMS, ' +
    'CUPO_WEBHOOK_URL, LISTAR_PAGADORES_WEBHOOK_URL, LISTAR_FACTURAS_WEBHOOK_URL, RADICAR_WEBHOOK_URL, MAX_PAGADORES };');
  return { api: fn(document, localStorage, fetch), els };
}

test('el panel carga sin errores', () => {
  assert.doesNotThrow(() => cargarPanel());
});

test('los webhooks apuntan a n8n de Plataform y el máximo de pagadores es 10', () => {
  const { api } = cargarPanel();
  for (const url of [api.CUPO_WEBHOOK_URL, api.LISTAR_PAGADORES_WEBHOOK_URL, api.LISTAR_FACTURAS_WEBHOOK_URL, api.RADICAR_WEBHOOK_URL]) {
    assert.match(url, /^https:\/\/webhooks\.n8n\.plataform\.com\/webhook\//);
  }
  assert.equal(api.MAX_PAGADORES, 10);
});

test('tasa máxima final = Tasa Total (P17): (1 + inversionista) × (1 + 6,643 %) − 1', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '16.2';
  assert.equal(api.tasaMaximaFinalCliente(), 23.92);   // hoja: Tasa Total E.A. 23,92 %
  assert.equal(api.tasaMaximaInversionista(), 16.2);
});

test('en posición propia la tasa máxima del inversionista es 0', () => {
  const { api, els } = cargarPanel();
  els.c_fondeo.value = 'propia';
  els.c_tasa_inv.value = '17';
  assert.equal(api.tasaMaximaInversionista(), 0);
});

test('% Fee del período = "% FEE" (H20)', () => {
  const { api } = cargarPanel();
  assert.equal(api.feePeriodo(48), 0.0085);   // 48 días -> 0,850 %
  assert.equal(api.feePeriodo(30), 0.0053);   // 30 días -> 0,530 %
  assert.equal(api.feePeriodo(20), 0.0053);   // menos de 30 días -> 0,530 %
});

test('liquidación cuadra al peso con la calculadora comercial (ejemplo de Sergio)', () => {
  // Factura 76.160.000 · anticipo 95 % · 48 días (F35) · inversionista 16,20 % · 1 factura ·
  // retefuente sí · pago − desembolso = 453 días (PTG).
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  const l = api.liquidar({ facturas: [{ valor: 76160000 }] }, 0, { dias: 48, diasPTG: 453 });
  const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);
  cerca(l.valorAnticipo, 72352000, 0.5);      // C12
  assert.equal(l.tasaFee, 0.0085);            // H20
  cerca(l.ptg, 20438, 0);                     // D18
  cerca(l.valorComision, 637930, 0.5);        // D14
  cerca(l.ivaComision, 121207, 0.5);          // D15
  cerca(l.totalRetenciones, 70172, 0.5);      // D20
  cerca(l.costosOperacionales, 688964, 0.5);  // D23
  cerca(l.anticipoNeto, 72352000 - 637930 - 121207, 1); // COTIZADOR B31 (sin sumar retenciones, B26 = 0)
  cerca(l.gananciaInv, 1442772, 0.5);         // G10
  cerca(l.remanente, 2365228, 0.5);           // D25
  cerca(l.costoTotal, 2131736, 0.5);          // G16
  cerca(l.tasaClienteEA, 0.2317, 0.00005);    // K7 23,17 %
  cerca(l.nominalMensual, 0.0175, 0.00005);   // J7 1,75 %
  cerca(l.tasaFacturaEA, 0.2191, 0.00005);    // G7 21,91 %
  cerca(l.tasaFacturaMV, 0.0166, 0.00005);    // F7 1,66 %
});

test('comisión mínima de $100.000', () => {
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '90';
  els.c_tasa_inv.value = '15';
  const l = api.liquidar({ facturas: [{ valor: 1000000 }] }, 0, { dias: 30, diasPTG: 30 });
  assert.equal(l.comisionFee, 100000);
});

test('Efectivo anual cuadra con el ejemplo de la calculadora (K7 = 18,4389 %)', () => {
  const ea = Math.pow(1 + (14774329.75 + 1158254.521) / 1137533521, 365 / 30) - 1;
  assert.ok(Math.abs(ea - 0.1843890374) < 1e-9);
});

test('con desembolso = cotización (13-oct-2026) el PTG baja y K7 queda en 23,14 %', () => {
  // Mismo caso de Sergio pero con la fecha de desembolso al día: pago − desembolso = 48 días.
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  const l = api.liquidar({ facturas: [{ valor: 76160000 }] }, 0, { dias: 48, diasPTG: 48 });
  assert.equal(l.ptg, 17388);
  assert.ok(Math.abs(l.tasaClienteEA - 0.2314) <= 0.00005, String(l.tasaClienteEA));
});

test('el resumen de la tasa no muestra la tasa sobre el valor de la factura', () => {
  assert.ok(!leerHtml().includes('Sobre el valor de la factura'));
});

test('fee del período editable: si el comercial lo baja, se usa el digitado y se marca como manual', () => {
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  api.setFeeManual(0.7);
  const l = api.liquidar({ facturas: [{ valor: 76160000 }] }, 0, { dias: 48, diasPTG: 48 });
  assert.equal(l.tasaFee, 0.007);
  assert.equal(api.feeEsManual(48), true);
  api.setFeeManual(null);
  assert.equal(api.feeEsManual(48), false);
  assert.equal(api.feeAplicado(48), 0.0085);
});

test('cuadra al peso con la hoja COTIZADOR de Sergio (fee 1,04 %, desembolso 03-sep-2025)', () => {
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  api.setFeeManual(1.04);
  const l = api.liquidar({ facturas: [{ valor: 76160000 }] }, 0, { dias: 48, diasPTG: 453 });
  const cerca = (a, b) => assert.ok(Math.abs(a - b) <= 0.5, a + ' vs ' + b);
  cerca(l.valorAnticipo, 72352000);        // B20
  cerca(l.valorComision, 775399);          // B22
  cerca(l.ivaComision, 147326);            // B23
  cerca(l.costosCotizador, 922725);        // B21
  cerca(l.anticipoNeto, 71429275);         // B31
  cerca(l.saldoBrutoRemanente, 3808000);   // B32
  cerca(l.gananciaInv, 1442772);           // B33
  cerca(l.remanente, 2365228);             // B34
  cerca(l.valorVencimiento, 73794772);     // B36
  assert.ok(Math.abs(l.nominalMensual - 0.0186) <= 0.00005);  // A16 1,86 % M.V.
  assert.ok(Math.abs(l.tasaClienteEA - 0.2472) <= 0.00005);   // B16 24,72 % E.A.
});

test('cuadra al peso con la calculadora de Karen (365-ajustes KAREN BACK 1.2 IVA-FEE, 15-oct-2026)', () => {
  // Factura 94.179.218 · anticipo 90 % · 16 % inversionista · 1 factura · 41 días · desembolso = cotización · retefuente.
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '90';
  els.c_tasa_inv.value = '16';
  els.c_rf.checked = true;
  const l = api.liquidar({ facturas: [{ valor: 94179218 }] }, 0, { dias: 41, diasPTG: 41 });
  const cerca = (a, b) => assert.ok(Math.abs(a - b) <= 0.5, a + ' vs ' + b);
  assert.equal(l.tasaFee, 0.0073);          // H20 0,730 %
  cerca(l.valorAnticipo, 84761296);         // C12
  cerca(l.ptg, 17336);                      // D18
  cerca(l.valorComision, 638593);           // D14
  cerca(l.ivaComision, 121333);             // D15
  cerca(l.totalRetenciones, 70245);         // D20
  cerca(l.costosOperacionales, 689681);     // D23
  cerca(l.gananciaInv, 1424972);            // G10
  cerca(l.costoTotal, 2114653);             // G16
  cerca(l.anticipoNetoLiq, 84071615);       // D24
  cerca(l.remanente, 7992950);              // D25
  assert.ok(Math.abs(l.nominalMensual - 0.0174) <= 0.00005);  // J7 1,74 %
  assert.ok(Math.abs(l.tasaFacturaEA - 0.2050) <= 0.00005);   // G7 20,50 %
  assert.ok(Math.abs(l.tasaFacturaMV - 0.0157) <= 0.00005);   // F7 1,57 %
});

test('el botón dice "Crear radicación y carpeta" y la carpeta va al flujo de n8n de Plataform', () => {
  const html = leerHtml();
  assert.ok(html.includes('>Crear radicación y carpeta</button>'));
  assert.ok(!html.includes('Crear borrador de radicación'));
  const { api } = cargarPanel();
  assert.equal(api.CARPETA_WEBHOOK_URL, 'https://webhooks.n8n.plataform.com/webhook/Crear_carpeta_radicacion');
});

test('cotización PDF: mismas cifras de la hoja COTIZADOR (caso de Sergio, fee 1,04 %)', () => {
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  api.setFeeManual(1.04);
  api.setOperaciones([{ nit: '900', razon_social: 'COMPANIA DE GALLETAS NOEL', pagoDirecto: 'SI', facturas: [{ valor: 76160000, folio: 'F1', cufe: 'abc', vencimiento: '2026-11-30' }] }]);
  const plazo = { dias: 48, diasPTG: 453, pagoAjustado: new Date(2026, 10, 30) };
  const [c] = api.datosCotizacion(plazo);
  const fila = (n) => c.detalle.find((f) => f[0] === n)[1];
  const ini = (n) => c.inicial.find((f) => f[0] === n)[1];
  assert.equal(ini('Valor Factura'), '$ 76.160.000');
  assert.equal(ini('Porcentaje de anticipo'), '95%');
  assert.equal(ini('Dias de operacion'), '48');
  assert.equal(ini('Fecha de pago Aproximada'), '30/11/2026');
  assert.equal(fila('ANTICIPO BRUTO'), '$ 72.352.000');
  assert.equal(fila('(-) Costos operacionales'), '$ 922.725');
  assert.equal(fila('Comision de corretaje'), '$ 775.399');
  assert.equal(fila('Iva Comision de corretaje'), '$ 147.326');
  assert.equal(fila('ANTICIPO NETO'), '$ 71.429.275');
  assert.equal(fila('(+) Saldo Bruto Remanente de la factura'), '$ 3.808.000');
  assert.equal(fila('(-) Costo maximo de financiacion (sin mora)*'), '$ 1.442.772');
  assert.equal(fila('(=) Saldo neto estimado'), '$ 2.365.228');
  assert.equal(fila('Valor al pagar al vencimiento'), '$ 73.794.772');
  assert.equal(c.tasaMV, '1,86%');
  assert.equal(c.tasaEA, '24,72%');
});

test('cotización PDF: sin pago directo no aparece el saldo neto estimado (regla del anexo)', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '16';
  api.setOperaciones([{ nit: '1', razon_social: 'P', pagoDirecto: 'NO', facturas: [{ valor: 1000000 }] }]);
  const [c] = api.datosCotizacion({ dias: 41, diasPTG: 41, pagoAjustado: new Date(2026, 10, 25) });
  assert.ok(!c.detalle.some((f) => f[0] === '(=) Saldo neto estimado'));
  assert.equal(api.esSi('Sí'), true);
  assert.equal(api.esSi(null), false);
});

test('mapeo de facturas: una fila por factura, separado por ; y con BOM para Excel', () => {
  const { api, els } = cargarPanel();
  els.c_razon_emisor = { value: 'SIA FOODS S.A.S.' };
  els.c_nit = { value: '900.123' };
  api.setOperaciones([
    { nit: '800.1', razon_social: 'ALPINA', facturas: [{ folio: 'A1', cufe: 'c1', vencimiento: '2026-11-01', valor: 100.4 }, { folio: 'A2', cufe: 'c;2', vencimiento: '2026-11-02', valor: 200 }] },
    { nit: '900', razon_social: 'NOEL', facturas: [{ folio: 'N1', cufe: 'c3', vencimiento: '2026-11-03', valor: 300 }] }
  ]);
  const csv = api.mapeoFacturasCSV({ pagoAjustado: new Date(2026, 11, 21) });
  const filas = csv.replace(/^\ufeff/, '').split('\r\n');
  assert.ok(csv.startsWith('\ufeff'));
  assert.equal(filas.length, 4);
  assert.equal(filas[0], 'Emisor;NIT emisor;Pagador;NIT pagador;Folio;CUFE;Vencimiento;Fecha aproximada de pago;Valor');
  assert.equal(filas[1], 'SIA FOODS S.A.S.;900123;ALPINA;8001;A1;c1;2026-11-01;2026.12.21;100');
  assert.equal(filas[2], 'SIA FOODS S.A.S.;900123;ALPINA;8001;A2;"c;2";2026-11-02;2026.12.21;200');
  assert.equal(filas[3], 'SIA FOODS S.A.S.;900123;NOEL;900;N1;c3;2026-11-03;2026.12.21;300');
});

test('el PDF se genera sin librerías externas y es un PDF válido (xref correcto, una página por pagador)', () => {
  const html = leerHtml();
  assert.ok(!/<script[^>]+src=/.test(html), 'no debe cargar scripts externos');
  const { api, els } = cargarPanel();
  els.c_razon_emisor = { value: 'SIA FOODS S.A.S.' };
  els.c_nit = { value: '900123' };
  els.c_comercial = { value: 'Sergio Rubiano' };
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  api.setFeeManual(1.04);
  api.setOperaciones([
    { nit: '1', razon_social: 'ALPINA', pagoDirecto: 'SI', facturas: [{ valor: 76160000 }] },
    { nit: '2', razon_social: 'NOEL (Galletas)', pagoDirecto: 'NO', facturas: [{ valor: 1000000 }] }
  ]);
  const pdf = api.construirCotizacionPDF({ dias: 48, diasPTG: 453, pagoAjustado: new Date(2026, 10, 30) }).salida();
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.ok(pdf.includes('/Count 2'));
  assert.ok(pdf.includes('(ANTICIPO NETO) Tj'));
  assert.ok(pdf.includes('($ 71.429.275) Tj'));
  assert.ok(pdf.includes('(Pagador: NOEL \\(Galletas\\)   NIT: 2) Tj'), 'escapa paréntesis');
  assert.ok(pdf.includes('(Cotizaci\xf3n de factoring) Tj'), 'tildes en WinAnsi');
  // Cada entrada del xref apunta exactamente al inicio de su objeto.
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(xref).startsWith('xref'));
  const entradas = pdf.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
  entradas.forEach((l, k) => assert.ok(pdf.slice(Number(l.slice(0, 10))).startsWith((k + 1) + ' 0 obj'), 'objeto ' + (k + 1)));
  for (const c of pdf) assert.ok(c.charCodeAt(0) <= 255, 'solo bytes');
});

test('la carpeta recibe las facturas seleccionadas para armar el mapeo de Producto (fecha YYYY.MM.DD)', async () => {
  const { api, els } = cargarPanel();
  els.c_razon_emisor = { value: 'SIA FOODS S.A.S.' };
  els.c_nit = { value: '901314381' };
  els.c_comercial = { value: 'Sergio Rubiano' };
  els.c_tasa_inv.value = '16';
  api.setOperaciones([{ nit: '900497538', razon_social: 'CPNS SAS', facturas: [{ folio: 'SIA9016', cufe: 'abc', vencimiento: '2026.11.17', valor: 13796000 }] }]);
  let enviado = null;
  api.setFetch((url, op) => { enviado = JSON.parse(op.body); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }); });
  global.URL = { createObjectURL() { return ''; }, revokeObjectURL() {} };
  global.Blob = function () {};
  global.btoa = (s) => Buffer.from(s, 'latin1').toString('base64');
  await api.crearCarpetaYCotizacion({ dias: 55, diasPTG: 55, pagoAjustado: new Date(2026, 11, 21) }, []);
  assert.equal(enviado.mapeo.nitEmisor, '901314381');
  assert.equal(enviado.mapeo.fechaAproximadaPago, '2026.12.21');
  assert.deepEqual(enviado.mapeo.facturas, [{ cufe: 'abc', numeroFactura: 'SIA9016', nitPagador: '900497538' }]);
});

test('bloqueo por mora suspendido para pruebas: la mora se avisa en amarillo y no bloquea', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '15';
  api.setEmisorRiesgo({ diasMora: 4, anticipoPactado: 95, plazoPactado: 90, cupoDisponible: 874801824 });
  api.setOperaciones([{ nit: '1', razon_social: 'HARINERA DEL VALLE S.A.', diasMora: 3, cupoDisponible: 5000000000, facturas: [{ valor: 4192697 }] }]);
  const bloqueos = api.pintar_validaciones({ dias: 56, diasPTG: 56, fechaInvalida: false });
  const html = els.caja_validaciones.innerHTML;
  assert.equal(bloqueos, 0, 'la mora no debe bloquear mientras la regla esté suspendida');
  assert.ok(html.includes('pv_val_avi"><span class="pv_punto"></span><span>Cliente con 4 días de mora'));
  assert.ok(html.includes('pagador con 3 días de mora'));
  assert.ok(leerHtml().includes('var BLOQUEAR_POR_MORA = false;'));
});

test('retenciones: la base propone pero se pueden cambiar, y el cambio queda como alerta', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '15';
  api.setEmisorRiesgo({ diasMora: 0, anticipoPactado: 95, plazoPactado: 90, cupoDisponible: 1e10, retenciones: { reteFuente: false, reteIca: false, reteIva: false } });
  api.setOperaciones([{ nit: '1', razon_social: 'P', cupoDisponible: 1e10, facturas: [{ valor: 1000000 }] }]);
  els.c_rf.checked = true;
  const bloqueos = api.pintar_validaciones({ dias: 56, diasPTG: 56, fechaInvalida: false });
  assert.equal(bloqueos, 0);
  assert.ok(els.caja_validaciones.innerHTML.includes('Retefuente aplicada a mano (la base de Riesgo dice que no aplica)'));
  assert.ok(!els.caja_validaciones.innerHTML.includes('Reteica aplicada'));
  assert.ok(!leerHtml().includes('$(m[0]).disabled = true'), 'las casillas de retenciones ya no se bloquean');
});

test('fee ajustado según la matriz: la tasa máxima final se recalcula con ese fee', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '16';
  assert.equal(api.tasaMaximaFinalCliente(46), 23.71);          // automático: (1,16)(1,06643) - 1
  assert.equal(api.feePeriodo(46), 0.0081);                       // automático: 0,810 % para 46 días (igual que la hoja de Karen)
  api.setFeeManual(0.7);                                         // ajustado según la matriz
  const ea = Math.pow(1.007, 365 / 46) - 1;
  assert.equal(api.tasaMaximaFinalCliente(46), Math.round((1.16 * (1 + ea) - 1) * 10000) / 100);
  assert.notEqual(api.tasaMaximaFinalCliente(46), 23.71);
  api.setFeeManual(null);
  assert.equal(api.tasaMaximaFinalCliente(46), 23.71);
});

test('Fee Plataform se muestra en dos campos: cada 30 días (editable, 0,530 % por defecto) y E.A.', () => {
  const { els } = cargarPanel();
  assert.equal(els.c_fee.value, '0.530');
  assert.equal(els.c_fee_ea.value, '6,643%');
  const html = leerHtml();
  assert.ok(html.includes('<input type="number" id="c_fee" step="0.001" min="0" value="0.530">'));
  assert.ok(html.includes('Fee Plataform (E.A.)'));
});

test('Fee Plataform cada 30 días editable: cambia el E.A., el fee del período y avisa', () => {
  const { api, els } = cargarPanel();
  els.c_tasa_inv.value = '16';
  assert.equal(api.feePeriodo(46), 0.0081);
  api.setFee30(0.6);                                              // 0,600 % cada 30 días
  const ea = Math.round((Math.pow(1.006, 365 / 30) - 1) * 100000) / 100000;
  assert.equal(api.feeEAAplicado(46), ea);
  assert.equal(api.feePeriodo(46), Math.round((Math.pow(1 + ea, 46 / 365) - 1) * 10000) / 10000);
  assert.equal(api.tasaMaximaFinalCliente(46), Math.round((1.16 * (1 + ea) - 1) * 10000) / 100);
  api.setEmisorRiesgo({ diasMora: 0 });
  api.pintar_validaciones({ dias: 46, diasPTG: 46, fechaInvalida: false });
  assert.ok(els.caja_validaciones.innerHTML.includes('Fee Plataform ajustado: 0,600% cada 30 días (por defecto 0,530%)'));
  api.setFee30(null);
  assert.equal(api.feeEAAplicado(46), api.PARAMS.feeEA);
});

test('tasa máxima final oculta de la vista y tasa cliente M.V./E.A. visible en Tasas de la operación', () => {
  const html = leerHtml();
  assert.ok(html.includes('<div id="w_tasa_max_cliente" style="display:none">'));
  assert.ok(html.includes('id="c_tasa_cliente_mv"') && html.includes('id="c_tasa_cliente_ea"'));
  const { api, els } = cargarPanel();
  els.c_anticipo.value = '95';
  els.c_tasa_inv.value = '16.2';
  els.c_rf.checked = true;
  api.setFeeManual(1.04);
  api.setOperaciones([{ nit: '900', razon_social: 'NOEL', facturas: [{ valor: 76160000 }] }]);
  api.pintar_liquidacion({ dias: 48, diasPTG: 453, pagoAjustado: new Date(2026, 10, 30) });
  assert.equal(els.c_tasa_cliente_mv.value, '1,86% M.V.');
  assert.equal(els.c_tasa_cliente_ea.value, '24,72% E.A.');
});

test('consulta por partes: si n8n responde pendiente, el panel vuelve a preguntar con el jobId', async () => {
  const { api } = cargarPanel();
  api.setEsperaBQ(1);
  const urls = [];
  const resp = (d) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d) });
  api.setFetch((url) => {
    urls.push(url);
    return urls.length < 3 ? resp({ pendiente: true, jobId: 'job_1', location: 'us-east1' }) : resp({ encontrado: true, razon_social: 'ACME' });
  });
  let esperas = 0;
  const data = await api.postBigQuery('https://x/webhook/Consulta_Big_query?nit=1', () => { esperas++; });
  assert.deepEqual(data, { encontrado: true, razon_social: 'ACME' });
  assert.equal(esperas, 2);
  assert.equal(urls[0], 'https://x/webhook/Consulta_Big_query?nit=1');
  assert.equal(urls[1], 'https://x/webhook/Consulta_Big_query?nit=1&jobId=job_1&location=us-east1');
  assert.equal(urls[2], urls[1]);
});

test('consulta por partes: sin pendiente responde igual que antes y tiene tope de preguntas', async () => {
  const { api } = cargarPanel();
  api.setEsperaBQ(1);
  const resp = (d) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d) });
  api.setFetch(() => resp({ encontrado: false }));
  assert.deepEqual(await api.postBigQuery('https://x?a=1'), { encontrado: false });
  api.setFetch(() => resp({ pendiente: true, jobId: 'j', location: 'us-east1' }));
  await assert.rejects(api.postBigQuery('https://x?a=1'), /no termin/);
});

test('pagadores viables sin facturas también aparecen (marcados con 0), después de los que tienen facturas', async () => {
  const { api, els } = cargarPanel();
  const resp = (d) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d) });
  api.setFetch((url) => url.includes('Listar_facturas')
    ? resp({ encontrado: true, facturas: [{ nitPagador: '222', folio: 'F1', valor: 100 }] })
    : resp({ encontrado: true, emisor: { razon_social: 'E' }, pagadores: [
        { nit: '111', razon_social: 'SIN FACTURAS', viabilidad: 'VIABLE' },
        { nit: '222', razon_social: 'CON FACTURAS', viabilidad: 'VIABLE' },
        { nit: '333', razon_social: 'NO VIABLE', viabilidad: 'NO VIABLE' } ] }));
  api.setToken(1);
  api.listarPagadores('900', 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(api.getPagadores().map((p) => p.nit), ['222', '111']);
  assert.ok(els.nota_pagadores.textContent.includes('1 pagador(es) viables aún no tienen facturas'));
  assert.ok(els.nota_pagadores.textContent.includes('no son viables'));
  assert.ok(leerHtml().includes("' (0 – sin facturas en la base)'"));
});

test('index.html llegó idéntico al probado (huella SHA-256)', () => {
  const contenido = leerHtml().replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const huella = require('node:crypto').createHash('sha256').update(contenido).digest('hex');
  assert.equal(huella, 'd8d167dc027c9967792c1c2841f7b74a5b9aeb71d6d39692a3e20d38e136628e');
});
