import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const RUTA = join(process.cwd(), "bitacora", "corridas.jsonl");

export interface RegistroCorrida {
  instante: string;
  playbook: string;
  modo: "simulacion" | "aplicar";
  args: Record<string, string>;
  conectores: string[];
  herramientasAutorizadas: string[];
  /** Herramientas que el agente llegó a invocar, en orden. */
  herramientasUsadas: string[];
  resultado: "exito" | "error" | "sin-resultado";
  turnos?: number;
  costeUsd?: number;
  duracionMs?: number;
  sesionId?: string;
  errores?: string[];
}

/**
 * Toda corrida queda registrada. Cuando un agente escribe en los sistemas de la
 * empresa, "¿quién hizo este cambio y por qué?" tiene que tener respuesta.
 */
export async function registrar(registro: RegistroCorrida): Promise<void> {
  await mkdir(dirname(RUTA), { recursive: true });
  await appendFile(RUTA, JSON.stringify(registro) + "\n", "utf8");
}

export const rutaBitacora = RUTA;
