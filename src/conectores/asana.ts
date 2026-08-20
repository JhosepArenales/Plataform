import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ConfigAsana } from "../config.js";
import { pedirJson, resultadoTexto } from "../lib/http.js";
import { nombreMcp, type Conector } from "./tipos.js";

const BASE = "https://app.asana.com/api/1.0";

/** Campos que pedimos siempre: suficientes para razonar sin traer la tarea entera. */
const CAMPOS_TAREA =
  "name,completed,completed_at,due_on,created_at,modified_at,assignee.name,permalink_url,projects.name";

export function crearConectorAsana(config: ConfigAsana): Conector {
  const cabeceras = { Authorization: `Bearer ${config.token}` };

  const get = <T>(ruta: string, params: Record<string, string | undefined> = {}) => {
    const url = new URL(`${BASE}${ruta}`);
    for (const [clave, valor] of Object.entries(params)) {
      if (valor !== undefined && valor !== "") url.searchParams.set(clave, valor);
    }
    return pedirJson<{ data: T }>("Asana", url.toString(), { cabeceras });
  };

  const escribir = <T>(
    metodo: "POST" | "PUT",
    ruta: string,
    datos: Record<string, unknown>,
  ) =>
    pedirJson<{ data: T }>("Asana", `${BASE}${ruta}`, {
      metodo,
      cabeceras,
      cuerpo: { data: datos },
    });

  const listarWorkspaces = tool(
    "listar_workspaces",
    "Lista los workspaces de Asana a los que da acceso el token. Útil para descubrir el GID del workspace.",
    {},
    async () => {
      const r = await get<Array<{ gid: string; name: string }>>("/workspaces");
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const listarProyectos = tool(
    "listar_proyectos",
    "Lista los proyectos de un workspace de Asana. Devuelve gid y nombre de cada uno.",
    {
      workspace_gid: z
        .string()
        .optional()
        .describe("GID del workspace. Si se omite se usa el configurado en ASANA_WORKSPACE_GID."),
      archivados: z.boolean().optional().describe("Incluir proyectos archivados. Por defecto no."),
    },
    async ({ workspace_gid, archivados }) => {
      const workspace = workspace_gid ?? config.workspaceGid;
      if (!workspace) {
        return {
          content: [
            {
              type: "text",
              text: "No hay workspace. Llama primero a listar_workspaces o define ASANA_WORKSPACE_GID.",
            },
          ],
          isError: true,
        };
      }
      const r = await get<Array<{ gid: string; name: string }>>("/projects", {
        workspace,
        archived: String(archivados ?? false),
        opt_fields: "name,archived,current_status.text",
        limit: "100",
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const listarTareas = tool(
    "listar_tareas",
    "Lista las tareas de un proyecto de Asana con fecha límite, responsable y última modificación.",
    {
      proyecto_gid: z.string().describe("GID del proyecto."),
      incluir_completadas: z
        .boolean()
        .optional()
        .describe("Por defecto false: sólo tareas abiertas."),
      modificadas_desde: z
        .string()
        .optional()
        .describe("Fecha ISO 8601. Sólo tareas modificadas desde entonces."),
    },
    async ({ proyecto_gid, incluir_completadas, modificadas_desde }) => {
      const r = await get<Array<Record<string, unknown>>>("/tasks", {
        project: proyecto_gid,
        opt_fields: CAMPOS_TAREA,
        limit: "100",
        ...(incluir_completadas ? {} : { completed_since: "now" }),
        ...(modificadas_desde ? { modified_since: modificadas_desde } : {}),
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const obtenerTarea = tool(
    "obtener_tarea",
    "Trae el detalle completo de una tarea de Asana, incluidas las notas.",
    { tarea_gid: z.string().describe("GID de la tarea.") },
    async ({ tarea_gid }) => {
      const r = await get<Record<string, unknown>>(`/tasks/${tarea_gid}`, {
        opt_fields: `${CAMPOS_TAREA},notes,num_subtasks`,
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const listarComentarios = tool(
    "listar_comentarios",
    "Lista los comentarios y el historial de una tarea de Asana. Sirve para ver si hay movimiento real.",
    { tarea_gid: z.string().describe("GID de la tarea.") },
    async ({ tarea_gid }) => {
      const r = await get<Array<Record<string, unknown>>>(`/tasks/${tarea_gid}/stories`, {
        opt_fields: "text,type,created_at,created_by.name",
        limit: "50",
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const crearTarea = tool(
    "crear_tarea",
    "ESCRITURA. Crea una tarea nueva en un proyecto de Asana.",
    {
      proyecto_gid: z.string().describe("GID del proyecto donde crearla."),
      nombre: z.string().describe("Título de la tarea, en imperativo y concreto."),
      notas: z.string().optional().describe("Descripción. Incluye el contexto de origen."),
      responsable: z
        .string()
        .optional()
        .describe("Correo o GID del responsable. Omitir si no está claro."),
      fecha_limite: z.string().optional().describe("Fecha límite en formato AAAA-MM-DD."),
    },
    async ({ proyecto_gid, nombre, notas, responsable, fecha_limite }) => {
      const r = await escribir<{ gid: string; permalink_url?: string }>("POST", "/tasks", {
        projects: [proyecto_gid],
        name: nombre,
        ...(notas ? { notes: notas } : {}),
        ...(responsable ? { assignee: responsable } : {}),
        ...(fecha_limite ? { due_on: fecha_limite } : {}),
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const actualizarTarea = tool(
    "actualizar_tarea",
    "ESCRITURA. Modifica una tarea de Asana: fecha límite, responsable, título o completado.",
    {
      tarea_gid: z.string().describe("GID de la tarea."),
      nombre: z.string().optional(),
      notas: z.string().optional(),
      responsable: z.string().optional().describe("Correo o GID del nuevo responsable."),
      fecha_limite: z.string().optional().describe("Nueva fecha límite AAAA-MM-DD."),
      completada: z.boolean().optional(),
    },
    async ({ tarea_gid, nombre, notas, responsable, fecha_limite, completada }) => {
      const datos: Record<string, unknown> = {};
      if (nombre !== undefined) datos.name = nombre;
      if (notas !== undefined) datos.notes = notas;
      if (responsable !== undefined) datos.assignee = responsable;
      if (fecha_limite !== undefined) datos.due_on = fecha_limite;
      if (completada !== undefined) datos.completed = completada;

      if (Object.keys(datos).length === 0) {
        return {
          content: [{ type: "text", text: "No se indicó ningún campo que cambiar." }],
          isError: true,
        };
      }
      const r = await escribir<Record<string, unknown>>("PUT", `/tasks/${tarea_gid}`, datos);
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const comentarTarea = tool(
    "comentar_tarea",
    "ESCRITURA. Añade un comentario a una tarea de Asana. El comentario lo lee una persona: sé breve y concreto.",
    {
      tarea_gid: z.string().describe("GID de la tarea."),
      texto: z.string().describe("Texto del comentario."),
    },
    async ({ tarea_gid, texto }) => {
      const r = await escribir<Record<string, unknown>>("POST", `/tasks/${tarea_gid}/stories`, {
        text: texto,
      });
      return { content: [{ type: "text", text: resultadoTexto(r.data) }] };
    },
  );

  const servidor = createSdkMcpServer({
    name: "asana",
    version: "0.1.0",
    tools: [
      listarWorkspaces,
      listarProyectos,
      listarTareas,
      obtenerTarea,
      listarComentarios,
      crearTarea,
      actualizarTarea,
      comentarTarea,
    ],
  });

  return {
    id: "asana",
    nombre: "Asana",
    servidor,
    herramientasLectura: [
      "listar_workspaces",
      "listar_proyectos",
      "listar_tareas",
      "obtener_tarea",
      "listar_comentarios",
    ].map((h) => nombreMcp("asana", h)),
    herramientasEscritura: ["crear_tarea", "actualizar_tarea", "comentar_tarea"].map((h) =>
      nombreMcp("asana", h),
    ),
    async verificar() {
      const r = await get<Array<{ gid: string; name: string }>>("/workspaces");
      const nombres = r.data.map((w) => `${w.name} (${w.gid})`).join(", ");
      const aviso = config.workspaceGid
        ? ""
        : " — falta ASANA_WORKSPACE_GID, cópialo de la lista anterior";
      return `${r.data.length} workspace(s): ${nombres}${aviso}`;
    },
  };
}
