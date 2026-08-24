import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.js";
import { construirConectores, faltantes, type Conector } from "./conectores/index.js";
import { registrar } from "./lib/audit.js";
import { crearRenderizador, formatearCoste, gris, negrita, verde } from "./lib/render.js";
import { AVISO_APLICAR, AVISO_SIMULACION, type Playbook } from "./playbooks/index.js";

const INSTRUCCION_BASE = `
Eres el agente de automatización de procesos internos de la empresa. Operas sobre
los sistemas de gestión de proyectos a través de las herramientas que tengas
autorizadas.

Cómo trabajas:
- Los datos vienen de las herramientas, nunca de tu memoria. Si no lo has
  consultado, no lo afirmas.
- No inventas identificadores, nombres de personas ni fechas. Un dato que falta
  se reporta como faltante.
- Antes de escribir algo, compruebas que el objeto existe y que el cambio no está
  hecho ya.
- Cuando una decisión es ambigua, no eliges por tu cuenta: la dejas anotada como
  pendiente de una persona.
- Tus salidas las lee alguien que va a tomar una decisión con ellas. Datos
  concretos, sin relleno.
- Respondes en español.
`.trim();

export interface OpcionesCorrida {
  playbook: Playbook;
  config: Config;
  aplicar: boolean;
  args: Record<string, string>;
  verboso: boolean;
  maxTurnos: number;
}

export interface ResultadoCorrida {
  ok: boolean;
  texto?: string;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Autoriza herramientas. Este es el punto donde el modo simulación se hace real:
 * las herramientas de escritura simplemente no entran en `allowedTools`, así que
 * el agente no las tiene disponibles, no es que le pidamos que se abstenga.
 */
export function autorizarHerramientas(
  playbook: Playbook,
  conectores: Conector[],
  aplicar: boolean,
): string[] {
  const herramientas = conectores.flatMap((c) => c.herramientasLectura);
  if (aplicar && playbook.escribe) {
    herramientas.push(...conectores.flatMap((c) => c.herramientasEscritura));
  }
  herramientas.push(...(playbook.herramientasNativas ?? []));
  return herramientas;
}

export async function correrPlaybook(opciones: OpcionesCorrida): Promise<ResultadoCorrida> {
  const { playbook, config, aplicar, args, verboso, maxTurnos } = opciones;

  const conectores = construirConectores(config);
  if (conectores.length === 0) {
    throw new Error(
      "No hay ningún conector configurado. Copia .env.example a .env y rellena las " +
        "credenciales de Asana o de Jira; luego comprueba con `npm run agente -- doctor`.",
    );
  }

  const sinCubrir = faltantes(playbook.conectores, conectores);
  if (sinCubrir.length > 0) {
    throw new Error(
      `El playbook "${playbook.id}" requiere estos conectores y no están configurados: ${sinCubrir.join(", ")}.`,
    );
  }

  const escrituraReal = aplicar && playbook.escribe;
  const herramientas = autorizarHerramientas(playbook, conectores, aplicar);

  const partesPrompt = [playbook.prompt({ hoy: hoyISO(), aplicar, args })];
  if (playbook.escribe) {
    partesPrompt.push(escrituraReal ? AVISO_APLICAR : AVISO_SIMULACION);
  }

  const mcpServers = Object.fromEntries(conectores.map((c) => [c.id, c.servidor]));

  const options: Options = {
    model: config.modelo,
    systemPrompt: INSTRUCCION_BASE,
    mcpServers,
    allowedTools: herramientas,
    // El agente sólo tiene lo que le damos aquí: sin ajustes de usuario ni
    // .mcp.json del entorno, una corrida es reproducible y auditable.
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: "default",
    maxTurns: maxTurnos,
    persistSession: false,
  };

  console.log(negrita(`\n${playbook.nombre}`));
  console.log(
    gris(
      `modo ${escrituraReal ? "APLICAR (los cambios son reales)" : "simulación (no escribe nada)"} · ` +
        `conectores: ${conectores.map((c) => c.nombre).join(", ")}\n`,
    ),
  );

  const { procesar, resumen } = crearRenderizador(verboso);

  try {
    for await (const mensaje of query({ prompt: partesPrompt.join("\n\n"), options })) {
      procesar(mensaje);
    }
  } finally {
    await registrar({
      instante: new Date().toISOString(),
      playbook: playbook.id,
      modo: escrituraReal ? "aplicar" : "simulacion",
      args,
      conectores: conectores.map((c) => c.id),
      herramientasAutorizadas: herramientas,
      herramientasUsadas: resumen.herramientasUsadas,
      resultado: resumen.resultado,
      turnos: resumen.turnos,
      costeUsd: resumen.costeUsd,
      duracionMs: resumen.duracionMs,
      sesionId: resumen.sesionId,
      errores: resumen.errores,
    });
  }

  const ok = resumen.resultado === "exito";
  console.log(
    gris(
      `\n${ok ? verde("listo") : "terminado con error"} · ${resumen.turnos ?? "?"} turnos · ` +
        `${formatearCoste(resumen.costeUsd)}`,
    ),
  );
  if (!escrituraReal && playbook.escribe && ok) {
    console.log(gris("Para ejecutar de verdad estas acciones, repite con --aplicar"));
  }

  return { ok, texto: resumen.texto };
}

/**
 * Pregunta suelta sobre los sistemas conectados. Siempre de sólo lectura: para
 * cambiar cosas existen los playbooks, que son revisables y repetibles.
 */
export async function preguntar(
  config: Config,
  pregunta: string,
  verboso: boolean,
): Promise<ResultadoCorrida> {
  const conectores = construirConectores(config);
  if (conectores.length === 0) {
    throw new Error("No hay ningún conector configurado. Revisa .env y corre `doctor`.");
  }

  const options: Options = {
    model: config.modelo,
    systemPrompt: INSTRUCCION_BASE,
    mcpServers: Object.fromEntries(conectores.map((c) => [c.id, c.servidor])),
    allowedTools: conectores.flatMap((c) => c.herramientasLectura),
    settingSources: [],
    strictMcpConfig: true,
    maxTurns: 20,
    persistSession: false,
  };

  const { procesar, resumen } = crearRenderizador(verboso);
  const prompt = `${pregunta}\n\nHoy es ${hoyISO()}. Sólo tienes herramientas de lectura: responde con datos consultados, y si algo no se puede consultar, dilo.`;

  for await (const mensaje of query({ prompt, options })) {
    procesar(mensaje);
  }

  return { ok: resumen.resultado === "exito", texto: resumen.texto };
}
