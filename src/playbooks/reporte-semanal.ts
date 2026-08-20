import type { Playbook } from "./tipos.js";

/**
 * Sólo lectura: recorre el trabajo del periodo y deja un informe en disco.
 * Es el playbook para empezar, porque no puede romper nada.
 */
export const reporteSemanal: Playbook = {
  id: "reporte-semanal",
  nombre: "Reporte semanal de estado",
  descripcion:
    "Revisa el trabajo de los últimos 7 días y escribe un informe de estado en salidas/. Sólo lectura.",
  conectores: [],
  herramientasNativas: ["Write"],
  escribe: false,
  cronSugerido: "0 8 * * 1", // lunes 08:00
  prompt: ({ hoy, args }) => {
    const dias = args.dias ?? "7";
    const alcance = args.proyecto
      ? `Limítate al proyecto: ${args.proyecto}.`
      : "Cubre todos los proyectos activos a los que tengas acceso.";

    return `
Elabora el reporte de estado de los últimos ${dias} días. Hoy es ${hoy}.

${alcance}

Procedimiento:
1. Descubre qué proyectos existen y qué tareas se movieron en la ventana de ${dias} días.
2. Para cada proyecto reúne: cerrado en el periodo, abierto y en curso, vencido,
   y lo que vence en los próximos 7 días.
3. Cuando algo parezca atascado, mira los comentarios antes de afirmarlo: una
   tarea sin cambios de campos puede tener actividad real en la conversación.

Escribe el informe en salidas/reporte-${hoy}.md con esta estructura:

# Reporte de estado — ${hoy}

## Resumen
Tres a cinco frases sobre el estado real. Si algo va mal, dilo en la primera frase.

## Por proyecto
Para cada proyecto: cerrado / en curso / vencido, con nombres y enlaces de las tareas.

## Riesgos y bloqueos
Sólo lo que de verdad amenaza una fecha. Cada punto con el dato que lo respalda.

## Vence esta semana
Lista con responsable y fecha.

Reglas de redacción:
- Cifras exactas, sacadas de las herramientas. Si un dato no está disponible, escribe
  "sin dato" en lugar de estimarlo.
- Nada de relleno motivacional. Esto lo lee alguien que decide con ello.
- Si la ventana de ${dias} días no tuvo movimiento en un proyecto, dilo en una línea
  en vez de rellenar la sección.
`.trim();
  },
};
