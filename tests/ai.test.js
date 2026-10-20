import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCourseTree, basicCourseFromSources } from '../server/services/ai.js';
import { startServer, sampleCourse, LONG_TEXT } from './helpers.js';

test('toCourseTree conserva ids existentes, no inventa videos y descarta preguntas inválidas', () => {
  const existing = [{ id: 'L1', type: 'video', video_url: '/media/videos/a.mp4' }, { id: 'L2', type: 'reading' }];
  const tree = toCourseTree({
    title: 'T', description: 'D', category: 'C', cover_emoji: '🧪', change_summary: 'cambios',
    lessons: [
      { existing_id: 'L1', type: 'video', title: 'Video conservado', content: '', duration_min: 3, questions: [] },
      { existing_id: null, type: 'video', title: 'Video inventado', content: '', duration_min: 3, questions: [] },
      { existing_id: 'L2', type: 'reading', title: 'Lectura editada', content: 'x', duration_min: 4, questions: [] },
      { existing_id: 'NO-EXISTE', type: 'reading', title: 'Nueva', content: 'y', duration_min: 4, questions: [] },
      { existing_id: null, type: 'quiz', title: 'Quiz', content: '', duration_min: 3, questions: [
        { prompt: 'ok', options: ['a', 'b', 'c', 'd', 'e'], correct_index: 1, explanation: '' },
        { prompt: 'mala', options: ['a', 'b'], correct_index: 5, explanation: '' },
      ] },
    ],
  }, { existingLessons: existing });
  assert.deepEqual(tree.lessons.map((l) => l.title), ['Video conservado', 'Lectura editada', 'Nueva', 'Quiz']);
  assert.equal(tree.lessons[0].id, 'L1');
  assert.equal(tree.lessons[0].video_url, '/media/videos/a.mp4');
  assert.equal(tree.lessons[2].id, null);
  assert.equal(tree.lessons[3].questions.length, 1);
  assert.equal(tree.lessons[3].questions[0].options.length, 4);
});

test('modo básico produce preguntas cuya respuesta aparece en la frase original', () => {
  const c = basicCourseFromSources([{ name: 'Manual.pdf', kind: 'pdf', extracted_text: LONG_TEXT }], 4);
  assert.match(c.title, /Manual/);
  const qs = c.lessons.filter((l) => l.type === 'quiz').flatMap((l) => l.questions);
  assert.ok(qs.length >= 2);
  for (const q of qs) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4, 'opciones únicas');
    assert.ok(q.explanation.toLowerCase().includes(q.options[q.correct_index]));
  }
});

test('actualización con IA (simulada) mantiene progreso y queda como propuesta hasta guardar', async () => {
  const fakeAi = {
    aiAvailable: () => true,
    generateCourse: async () => { throw new Error('no usado'); },
    updateCourseWithSources: async ({ course }) => toCourseTree({
      title: course.title, description: 'Actualizado', category: course.category, cover_emoji: course.cover_emoji,
      change_summary: 'Se actualizó la cultura.',
      lessons: course.lessons.map((l) => ({ existing_id: l.id, type: l.type, title: `${l.title} (v2)`, content: l.content, duration_min: l.duration_min, questions: l.questions })),
    }, { existingLessons: course.lessons }),
  };
  const srv = await startServer({ ai: fakeAi });
  try {
    const admin = await srv.login('a@e.com', 'A');
    const learner = await srv.login('b@e.com', 'B');
    const c = (await srv.call('/api/courses', { token: admin.token, method: 'POST', body: sampleCourse() })).data;
    await srv.call(`/api/courses/${c.id}/status`, { token: admin.token, method: 'POST', body: { status: 'published' } });
    await srv.call(`/api/lessons/${c.lessons[1].id}/complete`, { token: learner.token, method: 'POST' });
    const src = (await srv.call('/api/sources/text', { token: admin.token, method: 'POST', body: { name: 'Nueva política', text: LONG_TEXT } })).data;

    const proposal = (await srv.call(`/api/courses/${c.id}/ai-update`, { token: admin.token, method: 'POST', body: { source_ids: [src.id] } })).data;
    assert.equal(proposal.change_summary, 'Se actualizó la cultura.');
    assert.equal((await srv.call(`/api/courses/${c.id}`, { token: admin.token })).data.version, 1, 'la propuesta no se guarda sola');

    const saved = (await srv.call(`/api/courses/${c.id}`, { token: admin.token, method: 'PUT', body: { ...proposal, change_note: proposal.change_summary, source_ids: [src.id] } })).data;
    assert.equal(saved.version, 2);
    assert.equal(saved.lessons[1].title, 'Nuestra cultura (v2)');
    assert.equal(saved.sources.length, 1);
    const prog = (await srv.call(`/api/courses/${c.id}`, { token: learner.token })).data.progress;
    assert.equal(prog.done, 1, 'el progreso del aprendiz sobrevive a la actualización');
  } finally { await srv.stop(); }
});

test('modo básico no mezcla títulos sin puntuación con la frase siguiente', () => {
  const c = basicCourseFromSources([{ name: 'm', kind: 'texto', extracted_text: LONG_TEXT }], 3);
  for (const q of c.lessons.flatMap((l) => l.questions)) assert.doesNotMatch(q.prompt, /Manual de|vacaciones:\s/);
});
