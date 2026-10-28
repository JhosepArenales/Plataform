/* Configuración de los flujos de n8n de Emi. Es el ÚNICO lugar que hay que editar.
 * `node n8n/build.js` la incrusta en el nodo "Config" de cada flujo
 * (también se puede editar directamente ese nodo en n8n).
 *
 * Todo valor 'POR_DEFINIR' bloquea el flujo: responde {error:"not_configured"} y Emi ofrece asesor,
 * así nunca se inventa un estado por una regla mal configurada. */
module.exports = {
  metabase: {
    baseUrl: 'https://bi.mesfix.com',
    cardClientes: 2346,      // inversionistas-clientes
    cardOperaciones: 3794,   // participacion-operaciones-inversionistas
    // Si Álvaro agrega una variable de filtro a la pregunta, escribe aquí su nombre (ej. 'documento')
    // para filtrar en Metabase en vez de traer todas las filas.
    parametroDocumento: null,
    parametroOperacion: null
  },

  clientes: {
    // Nombre de la columna en la pregunta 2346 (se compara sin tildes ni mayúsculas).
    columnaDocumento: 'POR_DEFINIR',
    columnaNombre: 'POR_DEFINIR',
    columnaEmail: null,       // opcional: para asociar el ticket al contacto de HubSpot
    // Reglas en orden: gana la primera que se cumpla en alguna fila del documento.
    // op: 'in' (valor dentro de la lista) | 'notEmpty' | 'gt' (mayor que número) | 'truthy' (sí/true/1/x)
    reglas: [
      { estado: 'mora', columna: 'POR_DEFINIR', op: 'truthy' },
      { estado: 'inversionista+contratos_pendientes', columna: 'POR_DEFINIR', op: 'truthy' },
      { estado: 'inversionista', columna: 'POR_DEFINIR', op: 'gt', valor: 0 }
    ],
    estadoPorDefecto: 'prospecto' // documento encontrado que no cumple ninguna regla
  },

  operaciones: {
    columnaNumero: 'POR_DEFINIR',
    columnaNit: 'POR_DEFINIR',
    columnaRazonSocial: 'POR_DEFINIR',
    columnaEstado: 'POR_DEFINIR',
    columnaFechaPago: null,
    columnaTipoSocietario: null,
    columnaExpediente: null,
    columnaTipoProceso: null,
    // Valor de la columna de estado (sin tildes, minúsculas) → estado de Emi.
    mapaEstados: {
      'al dia': 'al_dia', 'vigente': 'al_dia', 'pagada': 'al_dia',
      'prejuridico': 'prejuridico', 'cobro prejuridico': 'prejuridico',
      'juridico': 'juridico', 'cobro juridico': 'juridico'
    }
  },

  // Canal WhatsApp con Evolution API (flujo emi-whatsapp).
  whatsapp: {
    evolutionUrl: 'POR_DEFINIR',          // ej. https://evolution.plataform.com
    instancia: 'emi',                     // nombre de la instancia creada en Evolution
    // Parte secreta de la URL del webhook (Evolution no envía cabeceras de autenticación).
    // Genera una con: openssl rand -hex 16
    webhookToken: 'POR_DEFINIR',
    emiWebhookBase: 'https://n8n.plataform.com', // donde viven los webhooks emi/client-lookup, etc.
    emiSecret: 'POR_DEFINIR',             // el mismo valor de la credencial "Emi · secreto del webhook"
    sesionHoras: 24,                      // sin mensajes por este tiempo → conversación nueva
    silencioHoras: 12,                    // tras escalar o si escribe un asesor, Emi no responde (el cliente reactiva con "menú")
    ventanaEcoSeg: 120,
    retrasoEscrituraMs: 1200,             // "escribiendo…" antes de cada respuesta
    crearContacto: true,                  // número desconocido → se crea el contacto en HubSpot para guardar el histórico
    enmascararDocumentos: true,           // cédulas/NIT escritos por el cliente quedan como ***1234 en HubSpot (Ley 1581)
    diasRetencionEstado: 7
  },

  // Ajustes del motor de Emi en WhatsApp (mismos campos que la consola: nombre, mensajes, horario, threshold…).
  emi: {},

  hubspot: {
    // Correos "Actualización estado del proceso…" que se envían a los inversionistas.
    remitenteCorreos: 'info@mesfix.com',
    palabraAsunto: 'Actualización',
    maxCorreos: 50,
    ticketPipeline: 'POR_DEFINIR',
    ticketEtapa: 'POR_DEFINIR',
    ticketOwnerId: null,
    // Propiedad personalizada de tickets (texto) para no duplicar: crearla en HubSpot.
    propiedadConversacion: 'emi_conversation_id'
  }
};
