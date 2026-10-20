/* Árbol de menús de Emi.
 * Cada opción hace una de estas cosas:
 *   goto   → abre otro menú
 *   faq    → responde con la FAQ de ese N° (base_id), así el texto vive solo en la base de conocimiento
 *   action → dispara un flujo del motor: validar_doc | op_estado | agente | libre | inicio
 * `categoria` sirve como pista para la búsqueda en FAQs mientras el usuario está dentro del menú. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmiMenus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var MENUS = {
    inicio: {
      titulo: 'Menú principal',
      texto: 'Elige una opción escribiendo su número:',
      opciones: [
        { key: '1', label: 'Registro', goto: 'registro' },
        { key: '2', label: 'Quiero invertir', goto: 'invertir' },
        { key: '3', label: 'Ya soy inversionista', action: 'validar_doc', next: 'inversionista' },
        { key: '4', label: 'Mercado Mesfix', goto: 'mercado' },
        { key: '5', label: 'Quiero financiar mi empresa (vender facturas)', goto: 'financiar' },
        { key: '6', label: 'Otra consulta', action: 'libre' },
        { key: '0', label: 'Hablar con un asesor', action: 'agente' }
      ]
    },
    registro: {
      titulo: 'Registro',
      categoria: 'Requisitos y documentos',
      texto: '¿Con qué parte del registro te ayudo?',
      opciones: [
        { key: '1', label: '¿Qué necesito para registrarme?', faq: 67 },
        { key: '2', label: 'Registro como empresa (persona jurídica)', faq: 68 },
        { key: '3', label: 'Validar mi identidad', faq: 96 },
        { key: '4', label: 'Falló la validación de identidad', faq: 118 },
        { key: '5', label: 'Documentos', goto: 'documentos' },
        { key: '6', label: 'Contratos', goto: 'contratos' }
      ]
    },
    documentos: {
      titulo: 'Documentos',
      categoria: 'Requisitos y documentos',
      texto: '¿Qué documento necesitas?',
      opciones: [
        { key: '1', label: 'Certificación bancaria', faq: 32 },
        { key: '2', label: 'Declaración de renta', faq: 33 },
        { key: '3', label: 'No declaro renta', faq: 119 },
        { key: '4', label: 'No resido en Colombia', faq: 34 },
        { key: '5', label: 'Documentos para persona jurídica', faq: 120 }
      ]
    },
    contratos: {
      titulo: 'Contratos',
      categoria: 'Otro',
      texto: '¿Sobre qué contrato tienes dudas?',
      opciones: [
        { key: '1', label: '¿Cómo firmo los contratos?', faq: 98 },
        { key: '2', label: 'Contrato de mandato', faq: 124 },
        { key: '3', label: 'Contrato de corretaje', faq: 122 },
        { key: '4', label: 'Términos y condiciones', faq: 123 },
        { key: '5', label: 'Copia en PDF de mis contratos', faq: 42 }
      ]
    },
    invertir: {
      titulo: 'Quiero invertir',
      categoria: 'Producto e inversión',
      texto: '¿Qué quieres saber sobre invertir en Mesfix?',
      opciones: [
        { key: '1', label: '¿Cómo invierto paso a paso?', faq: 101 },
        { key: '2', label: 'Monto mínimo', faq: 61 },
        { key: '3', label: 'Rentabilidad', faq: 59 },
        { key: '4', label: 'Plazo de las inversiones', faq: 60 },
        { key: '5', label: '¿Cómo funciona la subasta?', faq: 77 },
        { key: '6', label: 'Riesgos y garantías', goto: 'riesgos' }
      ]
    },
    riesgos: {
      titulo: 'Riesgos y garantías',
      categoria: 'Producto e inversión',
      texto: '¿Qué te gustaría revisar?',
      opciones: [
        { key: '1', label: '¿Cuál es el riesgo de esta inversión?', faq: 62 },
        { key: '2', label: 'Garantías y qué pasa si la empresa no paga', faq: 78 },
        { key: '3', label: '¿Y si la empresa pagadora quiebra?', faq: 127 },
        { key: '4', label: '¿Qué riesgos acepto al invertir?', faq: 121 },
        { key: '5', label: 'Etapas del cobro prejurídico y jurídico', faq: 133 }
      ]
    },
    inversionista: {
      titulo: 'Inversionista',
      categoria: 'Estados y tiempos',
      texto: '¿En qué te ayudo con tu cuenta?',
      opciones: [
        { key: '1', label: 'Estado de una operación', action: 'op_estado' },
        { key: '2', label: '¿Cómo retiro mi dinero?', faq: 23 },
        { key: '3', label: '¿Cuándo se refleja un pago en mi cuenta?', faq: 28 },
        { key: '4', label: 'Certificados', goto: 'certificados' },
        { key: '5', label: 'Contratos', goto: 'contratos' }
      ]
    },
    certificados: {
      titulo: 'Certificados',
      categoria: 'Requisitos y documentos',
      texto: '¿Qué certificado necesitas?',
      opciones: [
        { key: '1', label: 'Certificado anual', faq: 100 },
        { key: '2', label: 'Certificados de operación', faq: 132 },
        { key: '3', label: 'Certificado tributario', faq: 36 }
      ]
    },
    mercado: {
      titulo: 'Mercado Mesfix',
      categoria: 'Producto e inversión',
      texto: '¿Qué quieres saber del mercado?',
      opciones: [
        { key: '1', label: '¿Qué es el mercado de Mesfix?', faq: 70 },
        { key: '2', label: '¿Quién ve el Mercado Mesfix?', faq: 128 },
        { key: '3', label: '¿Cuánto se ha fondeado de una subasta?', faq: 73 },
        { key: '4', label: '¿Qué es un remate?', faq: 86 }
      ]
    },
    financiar: {
      titulo: 'Financiar mi empresa',
      categoria: 'Producto e inversión',
      texto: '¿Qué quieres saber sobre vender tus facturas?',
      opciones: [
        { key: '1', label: '¿Cómo vendo mis facturas?', faq: 113 },
        { key: '2', label: '¿Qué es el confirming?', faq: 112 },
        { key: '3', label: '¿Afecta mi capacidad de endeudamiento?', faq: 114 },
        { key: '4', label: 'Inscribir a mis clientes pagadores', faq: 115 },
        { key: '5', label: 'Descuentos de la operación', faq: 129 }
      ]
    },
    no_encontrado: {
      titulo: 'Documento no encontrado',
      texto: '¿Qué quieres hacer?',
      opciones: [
        { key: '1', label: 'Intentar con otro documento', action: 'validar_doc', next: 'inversionista' },
        { key: '2', label: 'Registrarme', goto: 'registro' },
        { key: '0', label: 'Hablar con un asesor', action: 'agente' }
      ]
    }
  };

  // Palabras que abren o mueven el menú en cualquier momento, incluso con un flujo abierto.
  var ALIAS_INICIO = /^(men[uú]( principal)?|inicio|opciones|empezar|comenzar)$/i;
  var ALIAS_VOLVER = /^(9|volver|atr[aá]s|regresar|volver al men[uú] anterior|men[uú] anterior)$/i;

  return { MENUS: MENUS, ALIAS_INICIO: ALIAS_INICIO, ALIAS_VOLVER: ALIAS_VOLVER };
});
