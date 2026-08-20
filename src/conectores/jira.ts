import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ConfigJira } from "../config.js";
import { pedirJson, resultadoTexto } from "../lib/http.js";
import { nombreMcp, type Conector } from "./tipos.js";

/** Campos que pedimos siempre; la respuesta completa de Jira es enorme. */
const CAMPOS = [
  "summary",
  "status",
  "assignee",
  "duedate",
  "priority",
  "created",
  "updated",
  "issuetype",
  "project",
];

/**
 * La API v3 de Jira exige Atlassian Document Format en los campos de texto
 * enriquecido (descripciones y comentarios). Envolvemos texto plano.
 */
function adf(texto: string) {
  return {
    type: "doc",
    version: 1,
    content: texto
      .split("\n\n")
      .filter((p) => p.trim() !== "")
      .map((parrafo) => ({
        type: "paragraph",
        content: [{ type: "text", text: parrafo }],
      })),
  };
}

export function crearConectorJira(config: ConfigJira): Conector {
  const base = `https://${config.site}.atlassian.net/rest/api/3`;
  const cabeceras = {
    Authorization:
      "Basic " + Buffer.from(`${config.email}:${config.token}`).toString("base64"),
  };

  const get = <T>(ruta: string, params: Record<string, string> = {}) => {
    const url = new URL(`${base}${ruta}`);
    for (const [clave, valor] of Object.entries(params)) url.searchParams.set(clave, valor);
    return pedirJson<T>("Jira", url.toString(), { cabeceras });
  };

  const enviar = <T>(metodo: "POST" | "PUT", ruta: string, cuerpo: unknown) =>
    pedirJson<T>("Jira", `${base}${ruta}`, { metodo, cabeceras, cuerpo });

  const buscar = tool(
    "buscar",
    "Busca incidencias de Jira con JQL. Ejemplos: 'project = OPS AND status != Done', 'assignee = currentUser() AND duedate < now()'.",
    {
      jql: z.string().describe("Consulta JQL."),
      maximo: z.number().optional().describe("Máximo de resultados. Por defecto 50, tope 100."),
    },
    async ({ jql, maximo }) => {
      const r = await enviar<{ issues?: unknown[] }>("POST", "/search/jql", {
        jql,
        maxResults: Math.min(maximo ?? 50, 100),
        fields: CAMPOS,
      });
      return { content: [{ type: "text", text: resultadoTexto(r.issues ?? r) }] };
    },
  );

  const listarProyectos = tool(
    "listar_proyectos",
    "Lista los proyectos de Jira visibles con la cuenta configurada. Devuelve clave y nombre.",
    {},
    async () => {
      const r = await get<{ values?: unknown[] }>("/project/search", { maxResults: "100" });
      return { content: [{ type: "text", text: resultadoTexto(r.values ?? r) }] };
    },
  );

  const obtenerIncidencia = tool(
    "obtener_incidencia",
    "Trae el detalle de una incidencia de Jira, incluida la descripción.",
    { clave: z.string().describe("Clave de la incidencia, por ejemplo OPS-142.") },
    async ({ clave }) => {
      const r = await get<unknown>(`/issue/${clave}`, {
        fields: [...CAMPOS, "description"].join(","),
      });
      return { content: [{ type: "text", text: resultadoTexto(r) }] };
    },
  );

  const listarComentarios = tool(
    "listar_comentarios",
    "Lista los comentarios de una incidencia de Jira. Sirve para ver si hay movimiento real.",
    { clave: z.string().describe("Clave de la incidencia.") },
    async ({ clave }) => {
      const r = await get<unknown>(`/issue/${clave}/comment`, { maxResults: "50" });
      return { content: [{ type: "text", text: resultadoTexto(r) }] };
    },
  );

  const listarTransiciones = tool(
    "listar_transiciones",
    "Lista las transiciones de estado disponibles para una incidencia. Consúltala antes de transicionar: los ids varían por flujo de trabajo.",
    { clave: z.string().describe("Clave de la incidencia.") },
    async ({ clave }) => {
      const r = await get<unknown>(`/issue/${clave}/transitions`);
      return { content: [{ type: "text", text: resultadoTexto(r) }] };
    },
  );

  const crearIncidencia = tool(
    "crear_incidencia",
    "ESCRITURA. Crea una incidencia en Jira.",
    {
      proyecto: z.string().describe("Clave del proyecto, por ejemplo OPS."),
      tipo: z.string().describe("Nombre del tipo de incidencia: Task, Bug, Story..."),
      resumen: z.string().describe("Título, en imperativo y concreto."),
      descripcion: z.string().optional().describe("Descripción. Incluye el contexto de origen."),
      fecha_limite: z.string().optional().describe("Fecha límite AAAA-MM-DD."),
    },
    async ({ proyecto, tipo, resumen, descripcion, fecha_limite }) => {
      const r = await enviar<unknown>("POST", "/issue", {
        fields: {
          project: { key: proyecto },
          issuetype: { name: tipo },
          summary: resumen,
          ...(descripcion ? { description: adf(descripcion) } : {}),
          ...(fecha_limite ? { duedate: fecha_limite } : {}),
        },
      });
      return { content: [{ type: "text", text: resultadoTexto(r) }] };
    },
  );

  const actualizarIncidencia = tool(
    "actualizar_incidencia",
    "ESCRITURA. Modifica campos de una incidencia de Jira.",
    {
      clave: z.string().describe("Clave de la incidencia."),
      resumen: z.string().optional(),
      descripcion: z.string().optional(),
      fecha_limite: z.string().optional().describe("Nueva fecha límite AAAA-MM-DD."),
    },
    async ({ clave, resumen, descripcion, fecha_limite }) => {
      const fields: Record<string, unknown> = {};
      if (resumen !== undefined) fields.summary = resumen;
      if (descripcion !== undefined) fields.description = adf(descripcion);
      if (fecha_limite !== undefined) fields.duedate = fecha_limite;

      if (Object.keys(fields).length === 0) {
        return {
          content: [{ type: "text", text: "No se indicó ningún campo que cambiar." }],
          isError: true,
        };
      }
      await enviar<unknown>("PUT", `/issue/${clave}`, { fields });
      return { content: [{ type: "text", text: `${clave} actualizada.` }] };
    },
  );

  const comentar = tool(
    "comentar",
    "ESCRITURA. Añade un comentario a una incidencia de Jira. Lo lee una persona: sé breve y concreto.",
    {
      clave: z.string().describe("Clave de la incidencia."),
      texto: z.string().describe("Texto del comentario."),
    },
    async ({ clave, texto }) => {
      const r = await enviar<unknown>("POST", `/issue/${clave}/comment`, { body: adf(texto) });
      return { content: [{ type: "text", text: resultadoTexto(r) }] };
    },
  );

  const transicionar = tool(
    "transicionar",
    "ESCRITURA. Mueve una incidencia a otro estado. Llama antes a listar_transiciones para obtener el id válido.",
    {
      clave: z.string().describe("Clave de la incidencia."),
      transicion_id: z.string().describe("Id de la transición, sacado de listar_transiciones."),
    },
    async ({ clave, transicion_id }) => {
      await enviar<unknown>("POST", `/issue/${clave}/transitions`, {
        transition: { id: transicion_id },
      });
      return { content: [{ type: "text", text: `${clave} transicionada.` }] };
    },
  );

  const servidor = createSdkMcpServer({
    name: "jira",
    version: "0.1.0",
    tools: [
      buscar,
      listarProyectos,
      obtenerIncidencia,
      listarComentarios,
      listarTransiciones,
      crearIncidencia,
      actualizarIncidencia,
      comentar,
      transicionar,
    ],
  });

  return {
    id: "jira",
    nombre: "Jira Cloud",
    servidor,
    herramientasLectura: [
      "buscar",
      "listar_proyectos",
      "obtener_incidencia",
      "listar_comentarios",
      "listar_transiciones",
    ].map((h) => nombreMcp("jira", h)),
    herramientasEscritura: [
      "crear_incidencia",
      "actualizar_incidencia",
      "comentar",
      "transicionar",
    ].map((h) => nombreMcp("jira", h)),
    async verificar() {
      const r = await get<{ displayName?: string; emailAddress?: string }>("/myself");
      return `autenticado como ${r.displayName ?? r.emailAddress ?? "usuario desconocido"} en ${config.site}.atlassian.net`;
    },
  };
}
