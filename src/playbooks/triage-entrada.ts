import type { Playbook } from "./tipos.js";

/**
 * Convierte texto libre (un correo, notas de reunión, un mensaje) en tareas.
 * Es el playbook que más tiempo devuelve al día, y el que más se equivoca si se
 * deja suelto: por eso el modo simulación importa aquí más que en ningún otro.
 */
export const triageEntrada: Playbook = {
  id: "triage-entrada",
  nombre: "Triage de entrada a tareas",
  descripcion:
    "Convierte texto libre (correo, notas de reunión, mensaje) en tareas concretas. Escribe.",
  conectores: [],
  herramientasNativas: ["Read"],
  escribe: true,
  argsRequeridos: ["texto|archivo"],
  prompt: ({ hoy, args }) => {
    const fuente = args.archivo
      ? `Lee el texto de origen del archivo: ${args.archivo}`
      : `Texto de origen:\n---\n${args.texto ?? ""}\n---`;
    const destino = args.proyecto
      ? `Crea las tareas en el proyecto: ${args.proyecto}.`
      : "Elige el proyecto más adecuado entre los existentes y justifica la elección en una línea. Si ninguno encaja, no crees nada y dilo.";

    return `
Convierte el siguiente texto en tareas accionables. Hoy es ${hoy}.

${fuente}

${destino}

Procedimiento:
1. Extrae únicamente compromisos reales: algo que alguien tiene que hacer.
   Opiniones, contexto y decisiones ya cerradas no son tareas.
2. Antes de crear nada, busca si ya existe una tarea que cubra ese punto. Si
   existe, no dupliques: anótalo como "ya cubierto por X".
3. Para cada tarea nueva: título en imperativo y concreto, descripción con el
   fragmento del texto que la origina, responsable sólo si el texto lo nombra
   sin ambigüedad, y fecha límite sólo si el texto da una fecha o un plazo.

Reglas:
- No inventes responsables ni fechas. "Cuanto antes" no es una fecha.
- Un compromiso vago ("hay que revisar el proceso") no se convierte en tarea:
  va a una lista de "requiere aclaración" al final.
- Máximo 15 tareas por corrida.

Termina con: tareas creadas (o propuestas), duplicados detectados, y puntos que
requieren aclaración antes de poder convertirse en tarea.
`.trim();
  },
};
