import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { ConectorId } from "../config.js";

/**
 * Un conector es un sistema de la empresa expuesto al agente como servidor MCP
 * en proceso.
 *
 * La separación entre `herramientasLectura` y `herramientasEscritura` es el
 * mecanismo de seguridad central del proyecto: en modo simulación el runner
 * sólo autoriza las de lectura, así que el agente no *puede* escribir aunque
 * se lo pidas. No depende de que obedezca una instrucción del prompt.
 */
export interface Conector {
  id: ConectorId;
  nombre: string;
  servidor: McpSdkServerConfigWithInstance;
  /** Nombres completos `mcp__<conector>__<herramienta>`. */
  herramientasLectura: string[];
  herramientasEscritura: string[];
  /** Comprobación de credenciales para `doctor`. Lanza si algo está mal. */
  verificar(): Promise<string>;
}

/** Prefija el nombre de una herramienta como lo hace el SDK. */
export function nombreMcp(conector: ConectorId, herramienta: string): string {
  return `mcp__${conector}__${herramienta}`;
}
