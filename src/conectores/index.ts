import type { Config, ConectorId } from "../config.js";
import { crearConectorAsana } from "./asana.js";
import { crearConectorJira } from "./jira.js";
import type { Conector } from "./tipos.js";

export type { Conector } from "./tipos.js";
export { nombreMcp } from "./tipos.js";

/** Construye los conectores que tienen credenciales completas. */
export function construirConectores(config: Config): Conector[] {
  const conectores: Conector[] = [];
  if (config.asana) conectores.push(crearConectorAsana(config.asana));
  if (config.jira) conectores.push(crearConectorJira(config.jira));
  return conectores;
}

export function faltantes(requeridos: ConectorId[], disponibles: Conector[]): ConectorId[] {
  const ids = new Set(disponibles.map((c) => c.id));
  return requeridos.filter((r) => !ids.has(r));
}
