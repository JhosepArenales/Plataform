/**
 * Cliente HTTP mínimo para las APIs REST de los conectores.
 *
 * Cada conector expone sus operaciones como herramientas MCP en proceso, así
 * que necesitamos dos cosas de este módulo: mensajes de error que el agente
 * pueda entender y accionar, y un tope de tamaño para que una respuesta enorme
 * no se coma la ventana de contexto.
 */

export class ErrorApi extends Error {
  constructor(
    readonly servicio: string,
    readonly estado: number,
    readonly cuerpo: string,
  ) {
    super(`${servicio} respondió ${estado}: ${cuerpo.slice(0, 500)}`);
    this.name = "ErrorApi";
  }
}

export interface OpcionesPeticion {
  metodo?: "GET" | "POST" | "PUT" | "DELETE";
  cabeceras: Record<string, string>;
  cuerpo?: unknown;
  /** Segundos antes de abandonar la petición. */
  tiempoLimite?: number;
}

export async function pedirJson<T = unknown>(
  servicio: string,
  url: string,
  opciones: OpcionesPeticion,
): Promise<T> {
  const { metodo = "GET", cabeceras, cuerpo, tiempoLimite = 30 } = opciones;

  const respuesta = await fetch(url, {
    method: metodo,
    headers: {
      Accept: "application/json",
      ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
      ...cabeceras,
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    signal: AbortSignal.timeout(tiempoLimite * 1000),
  });

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    throw new ErrorApi(servicio, respuesta.status, texto);
  }

  if (!texto) return undefined as T;

  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorApi(servicio, respuesta.status, `respuesta no era JSON: ${texto}`);
  }
}

/** Límite de caracteres por resultado de herramienta, muy por debajo del tope de MCP. */
const MAX_CARACTERES = 40_000;

/**
 * Serializa el resultado de una herramienta. Si se pasa del límite, recorta y
 * lo dice explícitamente, para que el agente sepa que debe filtrar más en vez
 * de asumir que vio todo.
 */
export function resultadoTexto(valor: unknown): string {
  const json = typeof valor === "string" ? valor : JSON.stringify(valor, null, 2);
  if (json.length <= MAX_CARACTERES) return json;
  return (
    json.slice(0, MAX_CARACTERES) +
    `\n\n[RECORTADO: la respuesta tenía ${json.length} caracteres. ` +
    `Vuelve a consultar con un filtro más estrecho en vez de asumir que esta lista está completa.]`
  );
}
