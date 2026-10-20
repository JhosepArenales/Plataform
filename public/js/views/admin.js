import { api, session, uploadWithProgress } from '../api.js';
import { h, toast, busy, confirmAction, modal, markdown, videoEmbed, formatDate, SHAPES } from '../ui.js';
import { rememberHost } from './game.js';

const STATUS = { draft: 'Borrador', published: 'Publicado', archived: 'Archivado' };

function adminTabs(active) {
  const tab = (href, label, key) => h('a', { href: `#${href}`, class: `tab ${active === key ? 'active' : ''}` }, label);
  return h('div', { class: 'admin-bar' },
    h('span', { class: 'admin-pill' }, 'Modo administrador'),
    h('nav', { class: 'tabs' }, tab('/admin', 'Panel', 'dash'), tab('/admin/cursos', 'Cursos', 'courses'), tab('/admin/ia', '✨ Crear con IA', 'ai'), tab('/admin/usuarios', 'Personas', 'users')));
}

// ---------- Panel ----------
export async function renderAdminDashboard() {
  const m = await api('/api/admin/metrics');
  const published = m.courses.filter((c) => c.status === 'published');
  const avgCompletion = published.length ? Math.round(published.reduce((a, c) => a + c.completion_rate, 0) / published.length) : 0;
  const withQuiz = m.courses.filter((c) => c.avg_quiz != null);
  const avgQuiz = withQuiz.length ? Math.round(withQuiz.reduce((a, c) => a + c.avg_quiz, 0) / withQuiz.length) : null;
  const kpi = (label, value, hint) => h('div', { class: 'kpi card' }, h('span', { class: 'kpi-label' }, label), h('strong', {}, value), h('span', { class: 'small muted' }, hint));
  const attention = m.courses.filter((c) => c.status === 'published' && ((c.avg_quiz != null && c.avg_quiz < 70) || (c.started >= 3 && c.completion_rate < 50)));

  return h('div', { class: 'page' }, adminTabs('dash'),
    h('div', { class: 'kpis' },
      kpi('Personas aprendiendo', m.learners, 'usuarios activos con rol de aprendiz'),
      kpi('Activas esta semana', m.active_week, 'sumaron XP en los últimos 7 días'),
      kpi('Cursos publicados', published.length, `${m.courses.length - published.length} en borrador`),
      kpi('Finalización promedio', `${avgCompletion}%`, 'de quienes empezaron un curso'),
      kpi('Nota promedio en quizzes', avgQuiz == null ? '—' : `${avgQuiz}%`, 'meta sugerida: ≥ 80%')),
    attention.length > 0 && h('div', { class: 'card callout' },
      h('h3', {}, '⚠️ Necesitan atención'),
      h('ul', {}, attention.map((c) => h('li', {}, h('a', { href: `#/admin/curso/${c.id}` }, c.title), ' — ',
        c.avg_quiz != null && c.avg_quiz < 70 ? `nota promedio ${c.avg_quiz}% (contenido o preguntas poco claras)` : `solo ${c.completion_rate}% termina el curso`)))),
    h('div', { class: 'card' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Desempeño por curso'), h('a', { class: 'btn btn-primary btn-sm', href: '#/admin/ia' }, '✨ Nuevo curso con IA')),
      m.courses.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Curso', 'Estado', 'Lecciones', 'Iniciaron', 'Terminaron', 'Finalización', 'Nota quiz'].map((t) => h('th', {}, t)))),
        h('tbody', {}, m.courses.map((c) => h('tr', {},
          h('td', {}, h('a', { href: `#/admin/curso/${c.id}` }, `${c.cover_emoji} ${c.title}`)),
          h('td', {}, h('span', { class: `status status-${c.status}` }, STATUS[c.status])),
          h('td', {}, c.lessons), h('td', {}, c.started), h('td', {}, c.completed),
          h('td', {}, h('div', { class: 'mini-progress inline' }, h('span', { style: { width: `${c.completion_rate}%` } })), ` ${c.completion_rate}%`),
          h('td', {}, c.avg_quiz == null ? '—' : `${c.avg_quiz}%`))))))
        : h('p', { class: 'muted' }, 'Aún no hay cursos. Crea el primero con IA a partir de tus manuales.')));
}

// ---------- Lista de cursos ----------
export async function renderAdminCourses() {
  const courses = await api('/api/courses?all=1');
  return h('div', { class: 'page' }, adminTabs('courses'),
    h('div', { class: 'section-head' }, h('h1', {}, 'Cursos'),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-ghost', href: '#/admin/nuevo' }, '+ Curso manual'), h('a', { class: 'btn btn-primary', href: '#/admin/ia' }, '✨ Crear con IA'))),
    courses.length ? h('div', { class: 'admin-list' }, courses.map((c) => h('div', { class: 'admin-item card' },
      h('span', { class: 'big-emoji' }, c.cover_emoji),
      h('div', { class: 'grow' },
        h('h3', {}, c.title),
        h('div', { class: 'row small muted' },
          h('span', { class: `status status-${c.status}` }, STATUS[c.status]),
          h('span', {}, `v${c.version}`), h('span', {}, `${c.lesson_count} lecciones`),
          c.generated_by_ai && h('span', { class: 'tag' }, '✨ IA'), h('span', {}, `Actualizado ${formatDate(c.updated_at)}`))),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-secondary btn-sm', onclick: (e) => launchGame(c.id, e.currentTarget) }, '🎮 Juego en vivo'),
        h('a', { class: 'btn btn-primary btn-sm', href: `#/admin/curso/${c.id}` }, 'Editar')))))
      : h('div', { class: 'card empty-state' }, h('div', { class: 'empty-icon' }, '📚'), h('h2', {}, 'Todavía no hay cursos'),
        h('p', {}, 'Sube un PDF, Word, Excel o presentación y la IA arma el curso con quizzes por ti.'),
        h('a', { class: 'btn btn-primary', href: '#/admin/ia' }, '✨ Crear mi primer curso')));
}

async function launchGame(courseId, button) {
  try {
    const r = await busy(button, () => api('/api/games', { method: 'POST', body: { course_id: courseId } }), 'Creando…');
    rememberHost(r.pin, r.hostKey);
    location.hash = `#/host/${r.pin}`;
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Recolector de fuentes (archivos, URL, texto) ----------
function sourceCollector() {
  const sources = [];
  const list = h('ul', { class: 'source-list' });
  const paint = () => list.replaceChildren(...sources.map((s, i) => h('li', { class: s.error ? 'error' : '' },
    h('span', { class: 'src-kind' }, { pdf: '📕', word: '📘', excel: '📗', csv: '📗', powerpoint: '📙', web: '🌐', texto: '📝' }[s.kind] ?? '⚠️'),
    h('div', { class: 'grow' }, h('strong', {}, s.name),
      h('div', { class: 'small muted' }, s.error ? s.error : `${s.char_count.toLocaleString('es')} caracteres extraídos${s.truncated ? ' (recortado por tamaño)' : ''}`),
      s.preview && h('details', { class: 'small' }, h('summary', {}, 'Ver extracto'), h('p', { class: 'preview' }, s.preview))),
    h('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `Quitar ${s.name}`, onclick: () => { sources.splice(i, 1); paint(); } }, '✕'))));

  const fileInput = h('input', { type: 'file', multiple: true, accept: '.pdf,.docx,.xlsx,.csv,.pptx,.txt,.md,.json,.html,.htm', hidden: true });
  const addFiles = async (files) => {
    if (!files.length) return;
    const form = new FormData();
    [...files].forEach((f) => form.append('files', f));
    drop.classList.add('working');
    drop.querySelector('.drop-label').textContent = `Leyendo ${files.length} archivo(s)…`;
    try {
      const res = await api('/api/sources/files', { method: 'POST', form });
      sources.push(...res);
      const failed = res.filter((r) => r.error).length;
      toast(failed ? `${res.length - failed} leído(s), ${failed} con error` : 'Archivos leídos ✔', failed ? 'error' : 'success');
    } catch (err) { toast(err.message, 'error'); }
    drop.classList.remove('working');
    drop.querySelector('.drop-label').textContent = 'Arrastra aquí tus archivos o haz clic para elegirlos';
    fileInput.value = '';
    paint();
  };
  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  const drop = h('div', { class: 'dropzone', tabindex: 0, role: 'button',
    onclick: () => fileInput.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); } },
  h('div', { class: 'big-emoji' }, '📂'), h('strong', { class: 'drop-label' }, 'Arrastra aquí tus archivos o haz clic para elegirlos'),
  h('span', { class: 'small muted' }, 'PDF, Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx), texto, HTML · hasta 10 archivos de 50 MB'), fileInput);

  const urlInput = h('input', { type: 'url', placeholder: 'https://… (página web o PDF público)', 'aria-label': 'URL' });
  const urlBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
    if (!urlInput.value) return;
    try { sources.push(await busy(urlBtn, () => api('/api/sources/url', { method: 'POST', body: { url: urlInput.value } }), 'Leyendo…')); urlInput.value = ''; paint(); } catch (err) { toast(err.message, 'error'); }
  } }, 'Agregar URL');
  const textArea = h('textarea', { rows: 4, placeholder: 'O pega aquí texto: un procedimiento, notas de una reunión, un correo…', 'aria-label': 'Texto' });
  const textBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
    if (!textArea.value.trim()) return;
    try { sources.push(await busy(textBtn, () => api('/api/sources/text', { method: 'POST', body: { name: `Texto pegado ${sources.length + 1}`, text: textArea.value } }))); textArea.value = ''; paint(); } catch (err) { toast(err.message, 'error'); }
  } }, 'Agregar texto');

  return {
    el: h('div', { class: 'collector' }, drop,
      h('div', { class: 'row' }, urlInput, urlBtn),
      h('div', { class: 'stack' }, textArea, h('div', {}, textBtn)), list),
    ids: () => sources.filter((s) => !s.error).map((s) => s.id),
  };
}

// ---------- Asistente IA ----------
export async function renderAiWizard() {
  const status = await api('/api/ai/status');
  const collector = sourceCollector();
  const instructions = h('textarea', { rows: 3, placeholder: 'Ej.: "Enfócate en lo que un vendedor nuevo necesita en su primera semana. Tono cercano. Incluye casos prácticos."' });
  const count = h('input', { type: 'number', min: 2, max: 15, value: 6 });
  const genBtn = h('button', { class: 'btn btn-primary btn-lg' }, '✨ Generar curso');
  genBtn.addEventListener('click', async () => {
    const ids = collector.ids();
    if (!ids.length) return toast('Agrega al menos una fuente.', 'error');
    try {
      const r = await busy(genBtn, () => api('/api/ai/generate', { method: 'POST', body: { source_ids: ids, instructions: instructions.value, lesson_count: Number(count.value) } }), 'La IA está creando tu curso… (puede tardar 1–2 min)');
      toast(r.mode === 'ai' ? 'Curso generado. Revísalo y publícalo.' : 'Borrador básico generado. Revísalo antes de publicar.', 'success');
      if (r.truncated) toast('Parte del material era muy extenso y se recortó.', 'error');
      location.hash = `#/admin/curso/${r.course.id}`;
    } catch (err) { toast(err.message, 'error'); }
  });
  return h('div', { class: 'page narrow' }, adminTabs('ai'),
    h('h1', {}, '✨ Crear un curso con IA'),
    h('p', { class: 'muted' }, 'Sube tus manuales, políticas, presentaciones o planillas. La IA arma lecciones cortas y quizzes; tú revisas y publicas.'),
    !status.available && h('div', { class: 'card callout warn' }, h('strong', {}, 'IA no configurada. '), 'Se generará un borrador básico (secciones + preguntas de completar). Para cursos con redacción y preguntas de calidad, configura ANTHROPIC_API_KEY en el servidor.'),
    h('div', { class: 'card stack' }, h('h3', {}, '1. Material de origen'), collector.el),
    h('div', { class: 'card stack' }, h('h3', {}, '2. Indicaciones (opcional)'), instructions,
      h('label', { class: 'field inline' }, 'Lecciones aproximadas', count)),
    h('div', { class: 'center' }, genBtn));
}

// ---------- Editor de cursos ----------
export async function renderEditor(courseId) {
  const isNew = !courseId;
  const course = isNew
    ? { title: '', description: '', category: 'Inducción', cover_emoji: '📘', status: 'draft', version: 0, lessons: [], sources: [] }
    : await api(`/api/courses/${courseId}`);
  const state = structuredClone(course);
  let dirty = false;
  let pendingNote = '';
  const markDirty = () => { dirty = true; saveBtn.classList.add('pulse'); };

  const field = (label, key, attrs = {}) => h('label', { class: 'field' }, label, h(attrs.tag ?? 'input', {
    value: state[key] ?? '', ...attrs, tag: null,
    oninput: (e) => { state[key] = e.target.value; markDirty(); },
  }, attrs.tag === 'textarea' ? state[key] : null));

  const lessonsHost = h('div', { class: 'lessons-editor' });
  const paintLessons = () => lessonsHost.replaceChildren(...state.lessons.map((l, i) => lessonEditor(l, i)),
    h('div', { class: 'add-lesson' }, h('span', { class: 'small muted' }, 'Agregar lección:'),
      ['video', 'reading', 'quiz'].map((type) => h('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        state.lessons.push({ type, title: '', content: '', video_url: '', duration_min: type === 'quiz' ? 3 : 5, questions: type === 'quiz' ? [blankQuestion()] : [], _open: true });
        markDirty(); paintLessons();
      } }, { video: '▶ Video', reading: '📄 Lectura', quiz: '❓ Quiz' }[type]))));

  const lessonEditor = (l, i) => {
    const move = (d) => { const j = i + d; if (j < 0 || j >= state.lessons.length) return; [state.lessons[i], state.lessons[j]] = [state.lessons[j], state.lessons[i]]; markDirty(); paintLessons(); };
    const set = (k) => (e) => { l[k] = e.target.value; markDirty(); };
    const titleText = h('span', {}, l.title || 'Sin título');
    const body = h('div', { class: 'lesson-body' },
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, 'Título', h('input', { value: l.title, oninput: (e) => { set('title')(e); titleText.textContent = e.target.value || 'Sin título'; } })),
        h('label', { class: 'field' }, 'Duración (min)', h('input', { type: 'number', min: 1, value: l.duration_min, oninput: set('duration_min') }))),
      l.type === 'video' && videoField(l, markDirty),
      l.type !== 'quiz' && contentField(l, set, l.type === 'video' ? 'Notas o resumen (opcional, Markdown)' : 'Contenido (Markdown)'),
      l.type === 'quiz' && questionsEditor(l, markDirty));
    const details = h('details', { class: 'lesson-edit card', open: !!l._open, ontoggle: (e) => { l._open = e.target.open; } },
      h('summary', {},
        h('span', { class: 'lesson-type' }, { video: '▶', reading: '📄', quiz: '❓' }[l.type]),
        h('span', { class: 'grow' }, `${i + 1}. `, titleText),
        h('span', { class: 'row', onclick: (e) => e.preventDefault() },
          h('button', { class: 'icon-btn', title: 'Subir', 'aria-label': 'Subir', disabled: i === 0, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Bajar', 'aria-label': 'Bajar', disabled: i === state.lessons.length - 1, onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn danger', title: 'Eliminar', 'aria-label': 'Eliminar lección', onclick: async () => {
            if (await confirmAction('Eliminar lección', `¿Eliminar "${l.title || 'Sin título'}"? El progreso de las personas en esta lección se perderá al guardar.`, 'Eliminar', true)) {
              state.lessons.splice(i, 1); markDirty(); paintLessons();
            }
          } }, '🗑'))),
      body);
    return details;
  };

  const statusChip = h('span', { class: `status status-${state.status}` }, STATUS[state.status]);
  const versionLabel = h('span', { class: 'small muted' }, isNew ? 'Nuevo' : `Versión ${state.version}`);
  const saveBtn = h('button', { class: 'btn btn-primary' }, isNew ? 'Crear curso' : 'Guardar cambios');
  const publishBtn = !isNew && h('button', { class: 'btn btn-secondary' }, state.status === 'published' ? 'Pasar a borrador' : 'Publicar');

  const payload = () => ({
    ...state, lessons: state.lessons.map(({ _open, ...l }) => ({ ...l, video_url: l.video_url || null })),
  });

  saveBtn.addEventListener('click', async () => {
    try {
      if (isNew) {
        const created = await busy(saveBtn, () => api('/api/courses', { method: 'POST', body: payload() }), 'Guardando…');
        dirty = false;
        toast('Curso creado', 'success');
        location.hash = `#/admin/curso/${created.id}`;
        return;
      }
      const note = await askChangeNote(pendingNote);
      if (note === null) return;
      const saved = await busy(saveBtn, () => api(`/api/courses/${state.id}`, { method: 'PUT', body: { ...payload(), change_note: note } }), 'Guardando…');
      // Se adoptan los ids que asignó el servidor a las lecciones nuevas, sin re-renderizar toda la pantalla.
      saved.lessons.forEach((sl, idx) => { if (state.lessons[idx]) state.lessons[idx].id = sl.id; });
      state.version = saved.version;
      versionLabel.textContent = `Versión ${saved.version}`;
      dirty = false; pendingNote = ''; aiBanner.replaceChildren();
      saveBtn.classList.remove('pulse');
      toast(`Guardado como versión ${saved.version}`, 'success');
      refreshVersions();
    } catch (err) { toast(err.message, 'error'); }
  });

  publishBtn?.addEventListener('click', async () => {
    const target = state.status === 'published' ? 'draft' : 'published';
    if (dirty) return toast('Primero guarda los cambios.', 'error');
    const ok = await confirmAction(target === 'published' ? 'Publicar curso' : 'Despublicar curso',
      target === 'published' ? 'El curso será visible para todas las personas de la Academia.' : 'El curso dejará de verse en el catálogo. El progreso de las personas se conserva.',
      target === 'published' ? 'Publicar' : 'Pasar a borrador');
    if (!ok) return;
    try {
      await busy(publishBtn, () => api(`/api/courses/${state.id}/status`, { method: 'POST', body: { status: target } }));
      state.status = target;
      statusChip.className = `status status-${target}`; statusChip.textContent = STATUS[target];
      publishBtn.textContent = target === 'published' ? 'Pasar a borrador' : 'Publicar';
      toast(target === 'published' ? 'Curso publicado 🚀' : 'Curso en borrador', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Versiones
  const versionsList = h('ul', { class: 'versions' });
  const refreshVersions = async () => {
    if (isNew) return;
    const versions = await api(`/api/courses/${state.id}/versions`);
    versionsList.replaceChildren(...versions.map((v) => h('li', {},
      h('div', {}, h('strong', {}, `v${v.version}`), ' · ', h('span', { class: 'small muted' }, `${formatDate(v.created_at)}${v.author ? ` · ${v.author}` : ''}`), h('p', { class: 'small' }, v.change_note)),
      v.version !== state.version && h('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => {
        if (!await confirmAction('Restaurar versión', `Se creará una nueva versión con el contenido de la v${v.version}. La versión actual queda guardada en el historial.`, 'Restaurar')) return;
        try { await busy(e.currentTarget, () => api(`/api/courses/${state.id}/versions/${v.id}/restore`, { method: 'POST' })); toast('Versión restaurada', 'success'); dirty = false; location.reload(); } catch (err) { toast(err.message, 'error'); }
      } }, 'Restaurar'))));
  };
  refreshVersions();

  // Actualizar con IA
  const aiBanner = h('div');
  const aiUpdate = async () => {
    const collector = sourceCollector();
    const instr = h('textarea', { rows: 2, placeholder: 'Ej.: "La política de vacaciones cambió; actualiza solo lo necesario."' });
    const go = await modal({
      title: '✨ Actualizar con IA',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Sube el material nuevo o actualizado. La IA propondrá los cambios y tú decides si guardarlos.'), collector.el, instr),
      actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Proponer cambios', value: true, class: 'btn-primary' }],
    });
    if (!go) return;
    if (!collector.ids().length) return toast('No agregaste material.', 'error');
    aiBanner.replaceChildren(h('div', { class: 'card callout' }, h('div', { class: 'spinner sm' }), ' La IA está revisando el curso con el material nuevo…'));
    try {
      const p = await api(`/api/courses/${state.id}/ai-update`, { method: 'POST', body: { source_ids: collector.ids(), instructions: instr.value } });
      Object.assign(state, { title: p.title, description: p.description, category: p.category, cover_emoji: p.cover_emoji, lessons: p.lessons.map((l) => ({ ...l, _open: false })), source_ids: collector.ids() });
      pendingNote = p.change_summary;
      markDirty();
      metaHost.replaceChildren(...metaFields());
      paintLessons();
      aiBanner.replaceChildren(h('div', { class: 'card callout ai' }, h('strong', {}, '✨ Propuesta de la IA cargada (aún no guardada). '),
        h('p', {}, p.change_summary), h('p', { class: 'small' }, 'Revisa las lecciones y presiona "Guardar cambios" para crear la nueva versión, o recarga la página para descartarla.')));
    } catch (err) { aiBanner.replaceChildren(); toast(err.message, 'error'); }
  };

  const metaFields = () => [
    h('div', { class: 'grid-meta' },
      h('label', { class: 'field emoji-field' }, 'Ícono', h('input', { value: state.cover_emoji, maxlength: 4, oninput: (e) => { state.cover_emoji = e.target.value; markDirty(); } })),
      field('Título del curso', 'title', { placeholder: 'Ej.: Bienvenida a la empresa' }),
      field('Categoría', 'category', { placeholder: 'Inducción, Ventas, Seguridad…', list: 'cat-list' })),
    field('Descripción', 'description', { tag: 'textarea', rows: 2, placeholder: '¿Qué aprenderá la persona?' }),
  ];
  const metaHost = h('div', { class: 'stack' }, ...metaFields());
  paintLessons();

  const leaveGuard = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', leaveGuard);
  window.addEventListener('hashchange', () => window.removeEventListener('beforeunload', leaveGuard), { once: true });

  return h('div', { class: 'page' }, adminTabs('courses'),
    h('div', { class: 'editor-head' },
      h('a', { href: '#/admin/cursos', class: 'small' }, '← Cursos'),
      h('div', { class: 'row' }, statusChip, versionLabel, course.generated_by_ai && h('span', { class: 'tag' }, '✨ Generado con IA')),
      h('div', { class: 'row' },
        !isNew && h('a', { class: 'btn btn-ghost', href: `#/curso/${state.id}`, target: '_blank' }, '👁 Vista previa'),
        !isNew && h('button', { class: 'btn btn-ghost', onclick: aiUpdate }, '✨ Actualizar con IA'),
        !isNew && h('button', { class: 'btn btn-ghost', onclick: (e) => launchGame(state.id, e.currentTarget) }, '🎮 Juego en vivo'),
        publishBtn, saveBtn)),
    aiBanner,
    h('div', { class: 'editor-layout' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, metaHost),
        h('h2', {}, 'Lecciones'),
        lessonsHost),
      !isNew && h('aside', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, 'Historial de versiones'), versionsList),
        course.sources?.length > 0 && h('div', { class: 'card' }, h('h3', {}, 'Fuentes usadas'),
          h('ul', { class: 'small plain' }, course.sources.map((s) => h('li', {}, `${s.name} · ${s.char_count.toLocaleString('es')} car.`)))))),
    h('datalist', { id: 'cat-list' }, ['Inducción', 'Ventas', 'Operaciones', 'Seguridad', 'Tecnología', 'Cultura', 'Calidad'].map((c) => h('option', { value: c }))));
}

function askChangeNote(prefill) {
  const input = h('textarea', { rows: 3, placeholder: 'Ej.: Actualicé la política de reembolsos y agregué 2 preguntas.' }, prefill);
  return modal({
    title: 'Guardar nueva versión',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, '¿Qué cambió? Queda en el historial para que el equipo sepa qué se actualizó.'), input),
    actions: [{ label: 'Cancelar', value: null, class: 'btn-ghost' }, { label: 'Guardar', value: 'ok', class: 'btn-primary' }],
  }).then((v) => (v === 'ok' ? input.value.trim() || 'Edición manual' : null));
}

function contentField(l, set, label) {
  const preview = h('div', { class: 'prose preview-box', html: markdown(l.content) });
  const ta = h('textarea', { rows: 8, oninput: (e) => { set('content')(e); preview.innerHTML = markdown(e.target.value); } }, l.content);
  return h('div', { class: 'field' }, label, h('div', { class: 'md-split' }, ta, preview));
}

function videoField(l, markDirty) {
  const previewHost = h('div', { class: 'video-preview' }, l.video_url ? videoEmbed(l.video_url) : null);
  const urlInput = h('input', { value: l.video_url ?? '', placeholder: 'Pega un link de YouTube, Vimeo o Google Drive… o sube un archivo', oninput: (e) => { l.video_url = e.target.value; markDirty(); previewHost.replaceChildren(e.target.value ? videoEmbed(e.target.value) : ''); } });
  const bar = h('div', { class: 'upload-bar hidden' }, h('span'));
  const file = h('input', { type: 'file', accept: 'video/mp4,video/webm,video/quicktime,.mov,.m4v', hidden: true });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    const form = new FormData();
    form.append('video', file.files[0]);
    bar.classList.remove('hidden');
    try {
      const r = await uploadWithProgress('/api/videos', form, (p) => { bar.firstChild.style.width = `${p}%`; bar.firstChild.textContent = `${p}%`; });
      l.video_url = r.url; urlInput.value = r.url; markDirty();
      previewHost.replaceChildren(videoEmbed(r.url));
      toast('Video subido ✔ (recuerda guardar el curso)', 'success');
    } catch (err) { toast(err.message, 'error'); }
    bar.classList.add('hidden'); file.value = '';
  });
  return h('div', { class: 'field' }, 'Video',
    h('div', { class: 'row' }, urlInput, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => file.click() }, '⬆ Subir video'), file),
    bar, previewHost);
}

const blankQuestion = () => ({ prompt: '', options: ['', '', '', ''], correct_index: 0, explanation: '', time_limit_sec: 20 });

function questionsEditor(l, markDirty) {
  const host = h('div', { class: 'questions' });
  const paint = () => host.replaceChildren(...l.questions.map((q, qi) => h('div', { class: 'question-edit' },
    h('div', { class: 'row' }, h('strong', {}, `Pregunta ${qi + 1}`),
      h('label', { class: 'small row' }, '⏱', h('select', { onchange: (e) => { q.time_limit_sec = Number(e.target.value); markDirty(); } },
        [10, 20, 30, 45, 60, 90].map((s) => h('option', { value: s, selected: q.time_limit_sec === s }, `${s}s`)))),
      h('button', { class: 'icon-btn danger', 'aria-label': 'Eliminar pregunta', onclick: async () => {
        if (await confirmAction('Eliminar pregunta', '¿Eliminar esta pregunta?', 'Eliminar', true)) { l.questions.splice(qi, 1); markDirty(); paint(); }
      } }, '🗑')),
    h('input', { value: q.prompt, placeholder: 'Escribe la pregunta', oninput: (e) => { q.prompt = e.target.value; markDirty(); } }),
    h('div', { class: 'options-edit' }, [0, 1, 2, 3].map((k) => h('label', { class: `option-edit answer-${k} ${q.correct_index === k ? 'is-correct' : ''}` },
      h('input', { type: 'radio', name: `correct-${l.id ?? 'n'}-${qi}-${Math.random().toString(36).slice(2, 6)}`, checked: q.correct_index === k, title: 'Marcar como correcta',
        onchange: () => { q.correct_index = k; markDirty(); paint(); } }),
      h('span', { class: 'shape' }, SHAPES[k]),
      h('input', { value: q.options[k] ?? '', placeholder: k < 2 ? `Opción ${k + 1}` : `Opción ${k + 1} (opcional)`, oninput: (e) => { q.options[k] = e.target.value; markDirty(); } })))),
    h('input', { value: q.explanation, placeholder: 'Explicación de la respuesta correcta (se muestra al final)', oninput: (e) => { q.explanation = e.target.value; markDirty(); } }))),
  h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { l.questions.push(blankQuestion()); markDirty(); paint(); } }, '+ Agregar pregunta'));
  // Las opciones vacías se descartan al guardar; se rellenan a 4 casillas para editar.
  l.questions.forEach((q) => { while (q.options.length < 4) q.options.push(''); });
  paint();
  return host;
}

// ---------- Personas ----------
export async function renderUsers() {
  const users = await api('/api/admin/users');
  return h('div', { class: 'page' }, adminTabs('users'),
    h('h1', {}, 'Personas'),
    h('p', { class: 'muted' }, 'Cada persona entra con su correo. Puedes dar permisos de administración para que otros creen y actualicen cursos.'),
    h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Nombre', 'Correo', 'Lecciones', 'XP', 'Rol', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, users.map((u) => {
        const roleCell = h('td', {}, h('span', { class: `status ${u.role === 'admin' ? 'status-published' : 'status-draft'}` }, u.role === 'admin' ? 'Administrador' : 'Aprendiz'));
        return h('tr', {},
          h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.lessons_done), h('td', {}, u.xp), roleCell,
          h('td', {}, u.id !== session.user.id && h('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => {
            const target = u.role === 'admin' ? 'learner' : 'admin';
            if (!await confirmAction('Cambiar rol', `${u.name} pasará a ser ${target === 'admin' ? 'administrador (podrá crear, editar y publicar cursos)' : 'aprendiz'}.`, 'Cambiar')) return;
            try {
              await busy(e.currentTarget, () => api(`/api/admin/users/${u.id}/role`, { method: 'POST', body: { role: target } }));
              u.role = target;
              roleCell.firstChild.className = `status ${target === 'admin' ? 'status-published' : 'status-draft'}`;
              roleCell.firstChild.textContent = target === 'admin' ? 'Administrador' : 'Aprendiz';
              e.target.textContent = target === 'admin' ? 'Quitar admin' : 'Hacer admin';
              toast('Rol actualizado', 'success');
            } catch (err) { toast(err.message, 'error'); }
          } }, u.role === 'admin' ? 'Quitar admin' : 'Hacer admin')));
      })))));
}
