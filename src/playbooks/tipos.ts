import type { ConectorId } from "../config.js";

export interface ContextoPlaybook {
  /** Fecha de hoy en AAAA-MM-DD, para que el prompt no dependa del reloj del modelo. */
  hoy: string;
  /** false = simulación (sólo propone), true = ejecuta las escrituras. */
  aplicar: boolean;
  /** Argumentos sueltos de la línea de comandos: --clave=valor. */
  args: Record<string, string>;
}

/**
 * Un playbook es un proceso de la empresa, escrito una vez y ejecutable siempre.
 *
 * Añadir automatización = añadir un playbook. No hace falta tocar el runner,
 * el CLI ni los conectores, y eso es justamente lo que hace que esto escale de
 * un proceso a veinte.
 */
export interface Playbook {
  /** Identificador para la línea de comandos. */
  id: string;
  nombre: string;
  descripcion: string;
  /** Conectores sin los cuales el playbook no puede correr. */
  conectores: ConectorId[];
  /** Herramientas nativas del SDK que necesita, por ejemplo Write para dejar un informe. */
  herramientasNativas?: string[];
  /** ¿Modifica sistemas externos? Si es false, --aplicar no cambia nada. */
  escribe: boolean;
  /** Cron sugerido para cuando se programe. Sólo documentación por ahora. */
  cronSugerido?: string;
  /** Argumentos obligatorios en la línea de comandos. */
  argsRequeridos?: string[];
  /** Construye la instrucción concreta para esta corrida. */
  prompt(ctx: ContextoPlaybook): string;
}

/** Bloque que se añade a todo playbook que escribe, cuando corre en simulación. */
export const AVISO_SIMULACION = `
MODO SIMULACIÓN. No tienes autorizada ninguna herramienta de escritura en esta
corrida: intentarla sólo gasta un turno. Entrega la lista de acciones que
propondrías, cada una con el sistema, el identificador exacto del objeto, el
cambio concreto y el motivo en una línea. Quien lo lea decide si se aplica.
`.trim();

export const AVISO_APLICAR = `
MODO APLICAR. Tienes autorizadas las herramientas de escritura y los cambios que
hagas son reales y visibles para el equipo. Reglas: no inventes identificadores,
verifica que el objeto existe antes de modificarlo, y no hagas nada que no esté
en el alcance descrito arriba. Si un caso es dudoso, no lo toques y anótalo
al final como pendiente de decisión humana.
`.trim();
