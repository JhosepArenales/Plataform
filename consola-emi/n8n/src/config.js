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
