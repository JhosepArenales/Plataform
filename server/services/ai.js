// Generación y actualización de cursos con IA (Claude).
// Si no hay ANTHROPIC_API_KEY, se usa un generador básico local para que la
// plataforma siga siendo usable; el borrador queda marcado para revisión.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// ~150k tokens de material fuente por solicitud; el resto se recorta y se avisa.
const MAX_PROMPT_CHARS = 600_000;

const QuestionSchema = z.object({
  prompt: z.string(),
  options: z.array(z.string()),
  correct_index: z.number().int(),
  explanation: z.string(),
});

const LessonSchema = z.object({
  existing_id: z.string().nullable(),
  type: z.enum(['reading', 'quiz', 'video']),
  title: z.string(),
  content: z.string(),
  duration_min: z.number().int(),
  questions: z.array(QuestionSchema),
});

const CourseSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  cover_emoji: z.string(),
  change_summary: z.string(),
  lessons: z.array(LessonSchema),
});

const SYSTEM = `Eres diseñador instruccional senior de la empresa. Conviertes material interno (manuales, políticas, procesos, hojas de cálculo, presentaciones) en cursos de inducción claros, prácticos y amigables en español para personas nuevas.

Principios:
- Usa SOLO la información del material entregado. Si algo no está en el material, no lo inventes; si es importante y falta, menciónalo en "change_summary" como vacío detectado.
- Lecciones cortas (3–8 minutos), una idea central cada una, tono cercano y directo.
- "content" de lecciones de lectura en Markdown simple: títulos ##, listas, **negritas**, y al final una sección "## Para recordar" con 3 puntos clave.
- Después de cada 2–3 lecciones de lectura incluye una lección "quiz" con preguntas de opción múltiple (4 opciones, una sola correcta, distractores plausibles, explicación breve de por qué la correcta lo es). Las lecciones que no son quiz llevan "questions": [].
- Las preguntas evalúan comprensión y aplicación en situaciones reales del trabajo, no memorización de frases.
- cover_emoji: un solo emoji representativo.`;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function sourcesBlock(sources) {
  let budget = MAX_PROMPT_CHARS;
  let truncated = false;
  const parts = sources.map((s) => {
    const text = s.extracted_text.slice(0, Math.max(0, budget));
    if (text.length < s.extracted_text.length) truncated = true;
    budget -= text.length;
    return `<documento nombre="${s.name.replace(/"/g, "'")}" tipo="${s.kind}">\n${text}\n</documento>`;
  });
  return { text: parts.join('\n\n'), truncated };
}

async function callClaude(userPrompt) {
  const client = new Anthropic();
  // Streaming: la salida de un curso completo puede ser larga.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: zodOutputFormat(CourseSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw Object.assign(new Error('La IA no pudo procesar este material. Revisa el contenido o usa otra fuente.'), { status: 422 });
  }
  if (message.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('El material es demasiado extenso para un solo curso. Divídelo en varias fuentes o cursos.'), { status: 413 });
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return CourseSchema.parse(JSON.parse(text));
}

// Convierte la respuesta de la IA al formato del repositorio de cursos,
// descartando preguntas mal formadas en lugar de fallar el curso completo.
export function toCourseTree(draft, { existingLessons = [] } = {}) {
  const byId = new Map(existingLessons.map((l) => [l.id, l]));
  const lessons = draft.lessons.map((l) => {
    const existing = l.existing_id ? byId.get(l.existing_id) : null;
    // Los videos los sube una persona: la IA puede reordenarlos o retitularlos, nunca inventar uno.
    if (l.type === 'video' && !existing?.video_url) return null;
    const questions = l.type === 'quiz' ? l.questions
      .map((q) => ({ ...q, options: q.options.filter((o) => o.trim()).slice(0, 4) }))
      .filter((q) => q.prompt.trim() && q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length)
      .map((q) => ({ ...q, time_limit_sec: 20 })) : [];
    if (l.type === 'quiz' && !questions.length) return null;
    return {
      id: existing ? existing.id : null,
      type: l.type, title: l.title, content: l.content,
      video_url: l.type === 'video' ? existing.video_url : null,
      duration_min: l.duration_min, questions,
    };
  }).filter(Boolean);
  return {
    title: draft.title, description: draft.description, category: draft.category,
    cover_emoji: draft.cover_emoji || '📘', lessons, change_summary: draft.change_summary,
  };
}

export async function generateCourse({ sources, instructions = '', lessonCount = 6 }) {
  const { text, truncated } = sourcesBlock(sources);
  if (!aiAvailable()) return { ...basicCourseFromSources(sources, lessonCount), mode: 'basic', truncated };
  const prompt = `${text}

Crea un curso de inducción a partir de los documentos anteriores.
- Número aproximado de lecciones de lectura: ${lessonCount} (más los quizzes intermedios y un quiz final de repaso con 5–8 preguntas).
- "existing_id" siempre null (curso nuevo).
- "change_summary": 2–3 frases sobre qué cubre el curso y cualquier vacío detectado en el material.
${instructions ? `- Indicaciones adicionales de quien crea el curso: ${instructions}` : ''}`;
  return { ...toCourseTree(await callClaude(prompt)), mode: 'ai', truncated };
}

export async function updateCourseWithSources({ course, sources, instructions = '' }) {
  const { text, truncated } = sourcesBlock(sources);
  if (!aiAvailable()) {
    throw Object.assign(new Error('Actualizar con IA requiere configurar ANTHROPIC_API_KEY en el servidor. Puedes editar el curso manualmente.'), { status: 503 });
  }
  const current = {
    title: course.title, description: course.description, category: course.category, cover_emoji: course.cover_emoji,
    lessons: course.lessons.map((l) => ({
      existing_id: l.id, type: l.type, title: l.title, content: l.content, duration_min: l.duration_min,
      questions: l.questions.map(({ prompt, options, correct_index, explanation }) => ({ prompt, options, correct_index, explanation })),
    })),
  };
  const prompt = `<curso_actual>\n${JSON.stringify(current)}\n</curso_actual>

<material_nuevo>
${text}
</material_nuevo>

Actualiza el curso actual con el material nuevo (por ejemplo, una política o proceso que cambió).
- Conserva las lecciones que siguen vigentes con su mismo "existing_id"; modifica las que cambian manteniendo su "existing_id"; usa existing_id null solo para lecciones nuevas.
- Elimina (omite) lecciones que el material nuevo deja obsoletas.
- Las lecciones "video" existentes se conservan con su existing_id salvo que el material indique que su contenido ya no aplica.
- Ajusta las preguntas de los quizzes para que reflejen la información vigente.
- "change_summary": lista breve y concreta de qué cambió y por qué (será visible para el equipo como nota de versión).
${instructions ? `- Indicaciones adicionales: ${instructions}` : ''}`;
  return { ...toCourseTree(await callClaude(prompt), { existingLessons: course.lessons }), mode: 'ai', truncated };
}

// ---------- Generador básico (sin IA) ----------
// Divide el material en secciones y arma preguntas de "completar la frase".
// Es deliberadamente simple: da un primer borrador editable, no un curso final.
export function basicCourseFromSources(sources, lessonCount = 6) {
  const fullText = sources.map((s) => s.extracted_text).join('\n\n');
  const sections = splitSections(fullText, lessonCount);
  const lessons = [];
  const vocab = keywords(fullText);
  sections.forEach((sec, i) => {
    lessons.push({
      id: null, type: 'reading', title: sec.title, video_url: null,
      content: `## ${sec.title}\n\n${sec.body}`, duration_min: Math.max(2, Math.round(sec.body.split(/\s+/).length / 180)), questions: [],
    });
    if ((i + 1) % 2 === 0 || i === sections.length - 1) {
      const qs = clozeQuestions(sections.slice(Math.max(0, i - 1), i + 1).map((s) => s.body).join('\n'), vocab, 3);
      if (qs.length) lessons.push({ id: null, type: 'quiz', title: `Repaso: ${sec.title}`, content: '', video_url: null, duration_min: 3, questions: qs });
    }
  });
  const first = sources[0]?.name?.replace(/\.[a-z0-9]+$/i, '') ?? 'Nuevo curso';
  return {
    title: `Inducción: ${first}`.slice(0, 120),
    description: `Curso generado automáticamente a partir de ${sources.length} documento(s). Revísalo antes de publicarlo.`,
    category: 'Inducción', cover_emoji: '📘', lessons,
    change_summary: 'Borrador generado en modo básico (sin IA). Configura ANTHROPIC_API_KEY para cursos con redacción y preguntas de mayor calidad.',
  };
}

function splitSections(text, target) {
  const lines = text.split('\n');
  const headingRe = /^(#{1,3}\s+.+|[A-ZÁÉÍÓÚÑ0-9][^.!?]{2,70}:?|\d+(\.\d+)*[.)]\s+.{3,80})$/;
  const sections = [];
  let current = { title: 'Introducción', body: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (headingRe.test(line) && line.split(/\s+/).length <= 10 && current.body.join(' ').length > 300) {
      sections.push(current);
      current = { title: line.replace(/^#+\s*/, '').replace(/:$/, ''), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);
  let merged = sections.map((s) => ({ title: s.title.slice(0, 80), body: s.body.join('\n') })).filter((s) => s.body.length > 80);
  if (!merged.length) merged = [{ title: 'Contenido', body: text }];
  // Ajusta al número de lecciones pedido: une secciones pequeñas o parte las grandes.
  while (merged.length > target) {
    let idx = 0;
    merged.forEach((s, i) => { if (i < merged.length - 1 && s.body.length + merged[i + 1].body.length < merged[idx].body.length + merged[idx + 1].body.length) idx = i; });
    merged.splice(idx, 2, { title: merged[idx].title, body: `${merged[idx].body}\n\n${merged[idx + 1].body}` });
  }
  return merged.map((s, i) => ({ title: s.title || `Parte ${i + 1}`, body: s.body.slice(0, 6000) }));
}

const STOP = new Set('sobre entre cuando donde desde hasta porque también tienen pueden deben debemos cualquier través durante mediante algunas algunos nuestra nuestro nuestros nuestras siempre ademas además mismo misma otros otras todas todos cada parte forma según hacia tiene puede debe estos estas aquel aquella'.split(' '));

function keywords(text) {
  const freq = new Map();
  for (const w of text.toLowerCase().match(/[a-záéíóúñü]{7,}/g) ?? []) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([w]) => w);
}

function clozeQuestions(text, vocab, n) {
  // Los saltos de línea también cortan frase: así un título suelto no se cuela en la pregunta.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 50 && s.length < 260 && /[.!?]$/.test(s));
  const out = [];
  const used = new Set();
  for (const s of sentences) {
    if (out.length >= n) break;
    const words = (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü]{7,}/g) ?? []).filter((w) => vocab.includes(w.toLowerCase()) && !used.has(w.toLowerCase()));
    if (!words.length) continue;
    const answer = words.sort((a, b) => b.length - a.length)[0];
    const distractors = vocab.filter((w) => w !== answer.toLowerCase() && Math.abs(w.length - answer.length) <= 4).slice(out.length * 3, out.length * 3 + 3);
    if (distractors.length < 3) continue;
    used.add(answer.toLowerCase());
    const options = [answer.toLowerCase(), ...distractors];
    const shift = (s.length + out.length) % 4;
    const rotated = options.slice(shift).concat(options.slice(0, shift));
    out.push({
      prompt: `Completa la frase: "${s.replace(answer, '_____')}"`,
      options: rotated, correct_index: rotated.indexOf(answer.toLowerCase()),
      explanation: `La frase original dice: "${s}"`, time_limit_sec: 20,
    });
  }
  return out;
}
