// Una fila por pagador para la hoja "Creados N8N", con las columnas y el formato de la
// fila que registra la calculadora_4 (filaParaSheetArray), más "Tasa global M.V. (%)".
const norm = $('Normalizar radicación').first().json;
// Condiciones del negocio (primera operación); cada fila usa las de su pagador si el panel las envía (6-nov-2026).
const cNegocio = norm.condiciones || {};
const ops = norm.operaciones;

const TIPO_FONDEO_LABEL = { crowd: 'Crowd', propia: 'Posición propia', estructurado: 'Fondeador estructurado' };
const fmtMoney = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const fmtPct = frac => ((Number(frac) || 0) * 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const fmtFecha = d => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const parseISO = s => { if (!s) return null; const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const siNo = v => v ? 'Sí' : 'No';


const hoy = new Date();
const vigencia = new Date(hoy); vigencia.setDate(vigencia.getDate() + 5);

return ops.map(op => {
  const c = op.condiciones || cNegocio;
  const ret = c.retenciones || {};
  const l = op.liquidacion || {};
  const desembolso = parseISO(c.fechaDesembolso);
  const pago = parseISO(c.fechaPagoEfectiva);
  return { json: {
    'Consecutivo': 'PENDIENTE',
    'Fecha emisión': fmtFecha(hoy),
    'Vigencia hasta': fmtFecha(vigencia),
    'Comercial': norm.comercial || 'Sin nombre',
    'Cliente': norm.nombreEmisor,
    'Pagador': op.razonSocialPagador,
    'Tipo de fondeo': TIPO_FONDEO_LABEL[c.tipoFondeo] || c.tipoFondeo || '',
    'Cant. facturas': l.numeroFacturas,
    'Valor factura': fmtMoney(l.valorFacturas),
    '% Anticipo': (Number(c.anticipoPct) || 0).toLocaleString('es-CO') + '%',
    'Días': c.plazoDias,
    'Tasa global E.A. (%)': fmtPct(l.tasaGlobalEA),
    'Costo total': fmtMoney(l.costoTotal),
    'Anticipo neto (recibe hoy)': fmtMoney(l.anticipoGirar),
    'Remanente': fmtMoney(l.remanente),
    'FNG aplicado': siNo(c.aplicaFNG),
    'Origen del cliente': 'Cliente antiguo (base de facturas)',
    'Facturas (folios)': (op.facturas || []).map(f => f.folio).filter(Boolean).join(', '),
    'Año': c.anio,
    'Primera operación': siNo(norm.esPrimeraOperacion),
    'Fecha desembolso': desembolso ? fmtFecha(desembolso) : '',
    'Fecha efectiva de pago': pago ? fmtFecha(pago) : '',
    'Tasa inversionista (%)': fmtPct((Number(c.tasaInversionistaEA) || 0) / 100),
    'Fee Plataform (%)': fmtPct((Number(c.feePlataformEA) || 0) / 100),
    'Retefuente aplicada': siNo(ret.reteFuente && ret.reteFuente.aplica),
    'Reteica aplicada': siNo(ret.reteIca && ret.reteIca.aplica),
    'Reteiva aplicada': siNo(ret.reteIva && ret.reteIva.aplica),
    'Ganancia inversionista': fmtMoney(l.gananciaInversionista),
    'Comisión Plataform Fee': fmtMoney(l.comisionFee),
    'Costos fijos': fmtMoney(l.costosFijos),
    'Valor FNG': fmtMoney(l.valorFNG),
    'IVA sobre comisión': fmtMoney(l.ivaComision),
    'Retenciones (total)': fmtMoney(l.totalRetenciones),
    'Decisión cliente': '',
    'Fecha decisión': '',
    'Motivo rechazo': '',
    'Tasa global M.V. (%)': fmtPct(l.nominalMensual)
  } };
});