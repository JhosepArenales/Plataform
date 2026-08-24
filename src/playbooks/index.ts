import type { Playbook } from "./tipos.js";
import { reporteSemanal } from "./reporte-semanal.js";
import { tareasEstancadas } from "./tareas-estancadas.js";
import { triageEntrada } from "./triage-entrada.js";

export type { Playbook, ContextoPlaybook } from "./tipos.js";
export { AVISO_SIMULACION, AVISO_APLICAR } from "./tipos.js";

/** Registro de procesos automatizados. Añadir uno nuevo es añadirlo aquí. */
export const playbooks: Playbook[] = [reporteSemanal, tareasEstancadas, triageEntrada];

export function buscarPlaybook(id: string): Playbook | undefined {
  return playbooks.find((p) => p.id === id);
}
