import type { Playbook } from "./tipos.js";

/**
 * Persigue pendientes: el trabajo repetitivo que nadie hace y por el que se
 * escapan las fechas. Escribe, así que por defecto corre en simulación.
 */
export const tareasEstancadas: Playbook = {
  id: "tareas-estancadas",
  nombre: "Seguimiento de tareas estancadas",
  descripcion:
    "Encuentra tareas vencidas o sin movimiento y deja un comentario de seguimiento en cada una. Escribe.",
  conectores: [],
  escribe: true,
  cronSugerido: "0 9 * * 2", // martes 09:00
  prompt: ({ hoy, args }) => {
    const umbral = args.dias ?? "10";
    const alcance = args.proyecto
      ? `Limítate al proyecto: ${args.proyecto}.`
      : "Cubre todos los proyectos activos a los que tengas acceso.";

    return `
Encuentra el trabajo estancado y hazle seguimiento. Hoy es ${hoy}.

${alcance}

Qué cuenta como actividad, y qué no:
- Actividad real = un comentario escrito por una persona.
- NO es actividad: la fecha 'modified_at' de la tarea, ni los eventos de sistema
  del historial. Asana dispara avisos automáticos ("due_today") cada mañana y
  cada uno le sube 'modified_at' a la tarea. Una tarea que nadie ha tocado en
  semanas aparece modificada hoy mismo. Si te fías de 'modified_at' no vas a
  detectar nada de lo que este proceso existe para detectar.
  La herramienta de comentarios ya te separa los dos grupos: usa
  'ultimo_comentario_humano', nunca 'modified_at'.

Una tarea está estancada si está abierta y cumple alguna de estas condiciones:
- Su fecha límite ya pasó.
- Tiene responsable y lleva más de ${umbral} días sin ningún comentario humano.
- Vence en los próximos 3 días y no tiene comentarios humanos de los últimos
  ${umbral} días.

Procedimiento:
1. Lista las tareas abiertas y quédate con las candidatas por fechas.
2. Antes de marcar una como estancada, consulta sus comentarios y mira
   'ultimo_comentario_humano'. Un comentario humano reciente la descarta; una
   'modified_at' reciente no la descarta.
3. Para cada tarea confirmada, deja un comentario dirigido a su responsable con:
   qué se está esperando, cuántos días lleva parada, y una pregunta concreta
   contestable en una línea.

Reglas:
- Un comentario por tarea, máximo 3 frases. Tono de colega, no de auditoría.
- No cambies fechas límite ni responsables: sólo comentas. Reasignar o mover una
  fecha es decisión de una persona.
- Sin responsable asignado, no comentes: repórtala aparte como "sin dueño".
- Si una tarea ya tiene un comentario de seguimiento tuyo de los últimos 7 días,
  sáltala. Insistir cada día es la forma más rápida de que el equipo silencie
  las notificaciones.
- Tope de 25 tareas por corrida. Si hay más, atiende las más vencidas y di
  cuántas quedaron fuera.

Termina con un resumen: cuántas revisaste, cuántas comentaste, cuántas sin dueño,
y cuántas quedaron fuera del tope.
`.trim();
  },
};
