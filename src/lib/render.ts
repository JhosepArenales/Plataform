import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const gris = (t: string) => `\x1b[90m${t}\x1b[0m`;
const azul = (t: string) => `\x1b[34m${t}\x1b[0m`;
const rojo = (t: string) => `\x1b[31m${t}\x1b[0m`;
const verde = (t: string) => `\x1b[32m${t}\x1b[0m`;
const negrita = (t: string) => `\x1b[1m${t}\x1b[0m`;

export { negrita, gris, verde, rojo, azul };

export interface ResumenCorrida {
  herramientasUsadas: string[];
  resultado: "exito" | "error" | "sin-resultado";
  texto?: string;
  turnos?: number;
  costeUsd?: number;
  duracionMs?: number;
  sesionId?: string;
  errores?: string[];
}

/**
 * Imprime el flujo de mensajes del agente de forma legible y va acumulando el
 * resumen que después va a la bitácora.
 */
export function crearRenderizador(verboso: boolean) {
  const resumen: ResumenCorrida = { herramientasUsadas: [], resultado: "sin-resultado" };

  function procesar(mensaje: SDKMessage): void {
    switch (mensaje.type) {
      case "system": {
        if (mensaje.subtype !== "init") return;
        resumen.sesionId = mensaje.session_id;
        const caidos = mensaje.mcp_servers.filter(
          (s) => s.status === "failed" || s.status === "needs-auth",
        );
        for (const s of caidos) {
          console.error(rojo(`  ! conector "${s.name}" no disponible (${s.status})`));
        }
        if (verboso) {
          const activos = mensaje.mcp_servers
            .map((s) => `${s.name}:${s.status}`)
            .join(", ");
          console.log(gris(`  conectores: ${activos || "ninguno"}`));
          console.log(gris(`  modelo: ${mensaje.model}`));
        }
        return;
      }

      case "assistant": {
        for (const bloque of mensaje.message.content) {
          if (bloque.type === "text" && bloque.text.trim()) {
            console.log(bloque.text);
          } else if (bloque.type === "tool_use") {
            resumen.herramientasUsadas.push(bloque.name);
            const etiqueta = bloque.name.replace(/^mcp__/, "");
            console.log(gris(`  · ${etiqueta}`));
            if (verboso) console.log(gris(`    ${JSON.stringify(bloque.input)}`));
          }
        }
        return;
      }

      case "result": {
        resumen.turnos = mensaje.num_turns;
        resumen.costeUsd = mensaje.total_cost_usd;
        resumen.duracionMs = mensaje.duration_ms;
        if (mensaje.subtype === "success") {
          resumen.resultado = "exito";
          resumen.texto = mensaje.result;
        } else {
          resumen.resultado = "error";
          resumen.errores = mensaje.errors;
          console.error(rojo(`\n  Falló: ${mensaje.subtype}`));
          for (const e of mensaje.errors) console.error(rojo(`  ${e}`));
        }
        return;
      }

      default:
        return;
    }
  }

  return { procesar, resumen };
}

export function formatearCoste(usd: number | undefined): string {
  if (usd === undefined) return "coste desconocido";
  return `$${usd.toFixed(4)}`;
}
