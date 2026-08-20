#!/usr/bin/env node
// Debe ser el primer import: carga .env antes de inicializar el resto.
import "./lib/env.js";

import { correrPlaybook, preguntar } from "./agente.js";
import { cargarConfig, claveApiPresente, jiraIncompleto } from "./config.js";
import { construirConectores } from "./conectores/index.js";
import { rutaBitacora } from "./lib/audit.js";
import { gris, negrita, rojo, verde } from "./lib/render.js";
import { buscarPlaybook, playbooks } from "./playbooks/index.js";

interface Argumentos {
  comando: string;
  posicionales: string[];
  banderas: Set<string>;
  opciones: Record<string, string>;
}

function parsear(argv: string[]): Argumentos {
  const posicionales: string[] = [];
  const banderas = new Set<string>();
  const opciones: Record<string, string> = {};

  for (const bruto of argv) {
    if (!bruto.startsWith("--")) {
      posicionales.push(bruto);
      continue;
    }
    const cuerpo = bruto.slice(2);
    const igual = cuerpo.indexOf("=");
    if (igual === -1) banderas.add(cuerpo);
    else opciones[cuerpo.slice(0, igual)] = cuerpo.slice(igual + 1);
  }

  return { comando: posicionales.shift() ?? "ayuda", posicionales, banderas, opciones };
}

function ayuda(): void {
  console.log(`
${negrita("Agente de automatización de procesos")}

  npm run agente -- <comando> [opciones]

${negrita("Comandos")}
  doctor                    Comprueba credenciales y conexión con cada sistema
  list                      Lista los procesos automatizados disponibles
  run <playbook>            Ejecuta un proceso (por defecto en simulación)
  chat "<pregunta>"         Pregunta suelta sobre los sistemas conectados (sólo lectura)
  ayuda                     Muestra esto

${negrita("Opciones de run")}
  --aplicar                 Ejecuta las escrituras de verdad. Sin esta bandera
                            el agente sólo propone y no puede modificar nada.
  --proyecto=<nombre|clave> Limita el alcance a un proyecto
  --dias=<n>                Ventana temporal del proceso
  --texto="..."             Texto de entrada (triage-entrada)
  --archivo=<ruta>          Archivo de entrada (triage-entrada)
  --max-turnos=<n>          Tope de turnos del agente (por defecto 40)
  --verboso                 Muestra argumentos de cada herramienta

${negrita("Ejemplos")}
  npm run agente -- doctor
  npm run agente -- run reporte-semanal --dias=7
  npm run agente -- run tareas-estancadas
  npm run agente -- run tareas-estancadas --aplicar
  npm run agente -- run triage-entrada --archivo=notas-reunion.txt
  npm run agente -- chat "¿qué vence esta semana y quién lo tiene?"
`);
}

function listar(): void {
  console.log(negrita("\nProcesos disponibles\n"));
  for (const p of playbooks) {
    const etiqueta = p.escribe ? rojo("escribe") : verde("sólo lectura");
    console.log(`  ${negrita(p.id)}  ${gris(`[${etiqueta}]`)}`);
    console.log(`    ${p.descripcion}`);
    if (p.cronSugerido) console.log(gris(`    cron sugerido: ${p.cronSugerido}`));
    console.log();
  }
  console.log(gris("Cada proceso vive en src/playbooks/. Añadir uno es añadir un archivo.\n"));
}

async function doctor(): Promise<number> {
  const config = cargarConfig();
  let problemas = 0;

  console.log(negrita("\nRevisión de configuración\n"));

  if (claveApiPresente()) {
    console.log(`  ${verde("ok")}    ANTHROPIC_API_KEY presente`);
  } else {
    console.log(`  ${rojo("falta")} ANTHROPIC_API_KEY — el agente no puede arrancar sin ella`);
    problemas++;
  }
  console.log(`  ${gris("·")}     modelo: ${config.modelo}`);

  if (jiraIncompleto()) {
    console.log(
      `  ${rojo("aviso")} Jira a medias: hacen falta JIRA_SITE, JIRA_EMAIL y JIRA_TOKEN, los tres`,
    );
    problemas++;
  }

  const conectores = construirConectores(config);
  if (conectores.length === 0) {
    console.log(
      `  ${rojo("falta")} ningún conector configurado — rellena Asana o Jira en .env`,
    );
    problemas++;
  }

  for (const conector of conectores) {
    process.stdout.write(`  ${gris("...")}   ${conector.nombre}: conectando`);
    try {
      const detalle = await conector.verificar();
      process.stdout.write(`\r  ${verde("ok")}    ${conector.nombre}: ${detalle}\n`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      process.stdout.write(`\r  ${rojo("error")} ${conector.nombre}: ${mensaje}\n`);
      problemas++;
    }
  }

  console.log(gris(`\n  bitácora de corridas: ${rutaBitacora}`));
  console.log(
    problemas === 0
      ? verde("\nTodo listo.\n")
      : rojo(`\n${problemas} problema(s) que resolver antes de operar.\n`),
  );
  return problemas === 0 ? 0 : 1;
}

/** Valida `argsRequeridos`, admitiendo alternativas con "a|b". */
function validarArgs(requeridos: string[] | undefined, args: Record<string, string>): string[] {
  if (!requeridos) return [];
  return requeridos.filter((requisito) => {
    const alternativas = requisito.split("|");
    return !alternativas.some((a) => args[a] !== undefined && args[a] !== "");
  });
}

async function ejecutar(argumentos: Argumentos): Promise<number> {
  const id = argumentos.posicionales[0];
  if (!id) {
    console.error(rojo("Falta el nombre del proceso. `list` muestra los disponibles."));
    return 1;
  }

  const playbook = buscarPlaybook(id);
  if (!playbook) {
    console.error(rojo(`No existe el proceso "${id}". Los disponibles:`));
    for (const p of playbooks) console.error(`  ${p.id}`);
    return 1;
  }

  const sinCubrir = validarArgs(playbook.argsRequeridos, argumentos.opciones);
  if (sinCubrir.length > 0) {
    for (const requisito of sinCubrir) {
      const opciones = requisito
        .split("|")
        .map((a) => `--${a}=`)
        .join(" o ");
      console.error(rojo(`Falta un argumento obligatorio: ${opciones}`));
    }
    return 1;
  }

  const maxTurnos = Number(argumentos.opciones["max-turnos"] ?? "40");
  if (!Number.isFinite(maxTurnos) || maxTurnos < 1) {
    console.error(rojo("--max-turnos debe ser un entero positivo."));
    return 1;
  }

  const resultado = await correrPlaybook({
    playbook,
    config: cargarConfig(),
    aplicar: argumentos.banderas.has("aplicar"),
    args: argumentos.opciones,
    verboso: argumentos.banderas.has("verboso"),
    maxTurnos,
  });

  return resultado.ok ? 0 : 1;
}

async function principal(): Promise<number> {
  const argumentos = parsear(process.argv.slice(2));

  switch (argumentos.comando) {
    case "doctor":
      return doctor();
    case "list":
    case "listar":
      listar();
      return 0;
    case "run":
    case "correr":
      return ejecutar(argumentos);
    case "chat": {
      const pregunta = argumentos.posicionales.join(" ").trim();
      if (!pregunta) {
        console.error(rojo('Escribe la pregunta entre comillas: chat "¿qué vence esta semana?"'));
        return 1;
      }
      const resultado = await preguntar(
        cargarConfig(),
        pregunta,
        argumentos.banderas.has("verboso"),
      );
      return resultado.ok ? 0 : 1;
    }
    case "ayuda":
    case "help":
      ayuda();
      return 0;
    default:
      console.error(rojo(`Comando desconocido: ${argumentos.comando}`));
      ayuda();
      return 1;
  }
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(rojo(`\n${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });
