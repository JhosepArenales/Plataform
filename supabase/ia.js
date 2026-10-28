// Formación IA por niveles: examen IA First, ruta personal, evidencias, mentorías,
// Demo Days, mapa de calor y panel de administración. Se registra en la app con
// ACADEMIA_EXT (rutas, menú y pestaña de administración). Todas las reglas y
// permisos se validan en la base (supabase/schema.sql, funciones app_ia_*).

const IA_LEVELS = {
  explorador: {
    name: 'Explorador', icon: '🧭', range: '0–40',
    content: 'Pedirle bien las cosas a la IA y qué datos nunca compartir.',
    format: 'Microcapacitaciones y talleres presenciales.',
    evidence: 'Usa IA en una tarea diaria.', kind: 'tarea',
  },
  practicante: {
    name: 'Practicante', icon: '⚙️', range: '41–70',
    content: 'Automatizar tareas de tu propio trabajo.',
    format: 'Talleres por área.',
    evidence: 'Automatiza 1 tarea y registra las horas ahorradas.', kind: 'tarea',
  },
  constructor: {
    name: 'Constructor', icon: '🏗️', range: '71–100',
    content: 'Crear artefactos y agentes seguros, con ficha de control IA y publicación con el Plataform Deployer.',
    format: null,
    evidence: 'Publica 1 artefacto con impacto medido.', kind: 'artefacto',
  },
};
const IA_ORDER = ['explorador', 'practicante', 'constructor'];
const ORG_ROLES = { director: 'Director', lider: 'Líder', analista: 'Analista' };
const ROLE_FOCUS = {
  director: 'Como Director, tu foco es decidir y gobernar la IA en tu área.',
  lider: 'Como Líder, tu foco es la adopción de la IA en tu equipo.',
  analista: 'Como Analista, tu foco es la ejecución: usar la IA en tu trabajo.',
};
const DIFFICULTY = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
const EVIDENCE_STATUS = { pendiente: '⏳ En revisión', validada: '✅ Validada', rechazada: '↩️ Por ajustar' };
const levelChip = (l) => h('span', { class: `ia-chip lvl-${l ?? 'none'}` }, l ? `${IA_LEVELS[l].icon} ${IA_LEVELS[l].name}` : 'Sin examen');
const canSeeHeatmap = (u) => u?.role === 'admin' || u?.org_role === 'director';

// ---------- Ruta personal ----------
async function renderIaHome() {
  if (!session.user?.area_id) { location.hash = '#/area'; return h('div'); }
  const [me, courses, sessions] = await Promise.all([api('/api/ia/me'), api('/api/courses'), api('/api/ia/sessions')]);
  const page = h('div', { class: 'page narrow ia-page' });

  if (me.in_progress) {
    page.append(h('div', { class: 'card ia-hero' },
      h('div', { class: 'big-emoji' }, '⏱️'), h('h1', {}, 'Tienes un examen en curso'),
      h('p', { class: 'muted' }, 'El tiempo de cada pregunta sigue corriendo.'),
      h('a', { class: 'btn btn-primary btn-lg', href: '#/ia/examen' }, 'Continuar examen')));
    return page;
  }

  if (!me.level) {
    page.append(examIntro(me));
    if (canSeeHeatmap(session.user)) page.append(heatmapLink());
    return page;
  }

  const info = IA_LEVELS[me.level];
  const last = me.attempts[me.attempts.length - 1];
  page.append(
    h('section', { class: `card ia-level-card lvl-${me.level}` },
      h('div', { class: 'ia-level-icon' }, info.icon),
      h('div', { class: 'grow' },
        h('p', { class: 'eyebrow' }, 'Tu nivel IA'),
        h('h1', {}, info.name),
        h('p', { class: 'muted' }, `${last.score} de 100 puntos · examen ${last.attempt_no} · ${formatDate(last.finished_at)}`),
        me.attempts.length > 1 && h('p', { class: 'small' }, 'Tu camino: ', me.attempts.map((a, i) => [i ? ' → ' : '', levelChip(a.level)])))),
    nextStepCard(me, info),
    routeCard(me, info, courses),
    evidenceCard(me, info),
    mentorCard(me),
    sessionsTeaser(sessions),
    canSeeHeatmap(session.user) && heatmapLink());
  return page;
}

function examIntro(me) {
  const start = h('button', { class: 'btn btn-primary btn-lg' }, 'Empezar examen');
  start.addEventListener('click', async () => {
    if (!await confirmAction('Examen IA First', 'Tienes 60 segundos por pregunta. Si sales o recargas la página, el tiempo sigue corriendo.', 'Empezar')) return;
    try { await busy(start, () => api('/api/ia/start', { method: 'POST', body: {} }), 'Preparando…'); location.hash = '#/ia/examen'; } catch (err) { toast(err.message, 'error'); }
  });
  return h('section', { class: 'card ia-hero' },
    h('div', { class: 'big-emoji' }, '🚀'),
    h('p', { class: 'eyebrow' }, 'Formación IA'),
    h('h1', {}, 'Descubre tu nivel en IA'),
    h('p', { class: 'muted' }, 'Un examen corto define tu nivel y tu ruta de aprendizaje.'),
    h('ul', { class: 'ia-facts' },
      h('li', {}, h('strong', {}, '10'), h('span', {}, 'preguntas')),
      h('li', {}, h('strong', {}, '60 s'), h('span', {}, 'por pregunta')),
      h('li', {}, h('strong', {}, '100'), h('span', {}, 'puntos'))),
    h('div', { class: 'ia-levels-row' }, IA_ORDER.map((k) => h('div', { class: `ia-mini lvl-${k}` },
      h('span', {}, IA_LEVELS[k].icon), h('strong', {}, IA_LEVELS[k].name), h('span', { class: 'small muted' }, `${IA_LEVELS[k].range} pts`)))),
    me.can_start ? start : h('p', { class: 'muted' }, 'El examen se habilita cuando la administración active el banco de preguntas.'));
}

function nextStepCard(me, info) {
  const validatedAfter = me.can_start;
  const pending = me.evidences.find((e) => e.status === 'pendiente');
  let title; let text; let action = null;
  if (validatedAfter) {
    title = '🎯 Listo para subir de nivel';
    text = 'Tu evidencia fue validada. Presenta de nuevo el examen IA First.';
    action = h('button', { class: 'btn btn-primary' }, 'Presentar examen');
    action.addEventListener('click', async () => {
      if (!await confirmAction('Examen IA First', 'Tienes 60 segundos por pregunta.', 'Empezar')) return;
      try { await busy(action, () => api('/api/ia/start', { method: 'POST', body: {} })); location.hash = '#/ia/examen'; } catch (err) { toast(err.message, 'error'); }
    });
  } else if (pending) {
    title = '⏳ Tu evidencia está en revisión';
    text = `"${pending.title}". Cuando la validen, podrás presentar el examen para subir de nivel.`;
  } else if (me.level === 'constructor' && me.evidences.some((e) => e.kind === 'artefacto' && e.status === 'validada')) {
    title = '🏆 Tu artefacto ya tiene impacto medido';
    text = 'Compártelo en el próximo Demo Day y acompaña a alguien como mentor.';
    action = h('a', { class: 'btn btn-secondary', href: '#/ia/sesiones' }, 'Ver Demo Days');
  } else {
    title = '👉 Tu próximo paso';
    text = info.evidence;
    action = h('button', { class: 'btn btn-primary', onclick: () => openEvidenceForm(info.kind) }, 'Registrar evidencia');
  }
  return h('section', { class: 'card ia-next' }, h('div', { class: 'grow' }, h('h2', {}, title), h('p', {}, text)), action);
}

function routeCard(me, info, courses) {
  const own = courses.filter((c) => /^ia\b/i.test(c.category) && c.category.toLowerCase().includes(info.name.toLowerCase()));
  return h('section', { class: 'card' },
    h('h2', {}, `Tu ruta ${info.name}`),
    h('dl', { class: 'ia-route' },
      h('dt', {}, '📚 Contenido'), h('dd', {}, info.content),
      info.format && [h('dt', {}, '🗓️ Formato'), h('dd', {}, info.format)],
      h('dt', {}, '✅ Evidencia para subir'), h('dd', {}, info.evidence),
      me.org_role && [h('dt', {}, '👤 Tu rol'), h('dd', {}, ROLE_FOCUS[me.org_role])]),
    own.length
      ? h('div', { class: 'ia-courses' }, h('h3', {}, 'Cursos de tu ruta'), own.map((c) => h('a', { class: 'ia-course', href: `#/curso/${c.id}` },
        h('span', {}, c.cover_emoji), h('span', { class: 'grow' }, c.title), h('span', { class: 'small muted' }, `${c.done_count}/${c.lesson_count}`))))
      : h('p', { class: 'small muted' }, 'Pronto aparecerán aquí los cursos de tu ruta.'));
}

function evidenceCard(me) {
  return h('section', { class: 'card' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Mis evidencias'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openEvidenceForm(IA_LEVELS[me.level].kind) }, '+ Registrar')),
    me.evidences.length
      ? h('ul', { class: 'plain ia-list' }, me.evidences.map((e) => h('li', {},
        h('span', { class: 'ia-kind' }, e.kind === 'artefacto' ? '🧩' : '📝'),
        h('div', { class: 'grow' }, h('strong', {}, e.title),
          h('div', { class: 'small muted' }, [e.hours_month > 0 && `${e.hours_month} h/mes`, e.quality].filter(Boolean).join(' · ')),
          e.review_note && h('div', { class: 'small' }, `Nota: ${e.review_note}`)),
        h('span', { class: `ia-status st-${e.status}` }, EVIDENCE_STATUS[e.status]))))
      : h('p', { class: 'small muted' }, 'Aún no registras evidencias. Cada evidencia validada te acerca al siguiente nivel.'));
}

async function openEvidenceForm(defaultKind) {
  const form = h('form', { class: 'stack ia-form' },
    h('div', { class: 'seg', role: 'radiogroup' },
      ['tarea', 'artefacto'].map((k) => h('label', { class: 'seg-opt' },
        h('input', { type: 'radio', name: 'kind', value: k, checked: k === defaultKind }), k === 'tarea' ? '📝 Tarea' : '🧩 Artefacto'))),
    h('label', { class: 'field' }, '¿Qué hiciste con IA?', h('input', { name: 'title', required: true, maxlength: 200, placeholder: 'Ej.: Resumo con IA los correos de clientes cada mañana' })),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, 'Horas ahorradas al mes', h('input', { name: 'hours_month', type: 'number', min: 0, max: 744, step: 0.5, value: 0 })),
      h('label', { class: 'field' }, 'Enlace (opcional)', h('input', { name: 'link', type: 'url', placeholder: 'https://…' }))),
    h('label', { class: 'field' }, 'Mejora en calidad (opcional)', h('input', { name: 'quality', maxlength: 500, placeholder: 'Ej.: menos errores de digitación' })));
  const ok = await modal({ title: 'Registrar evidencia', body: form, actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Enviar a revisión', value: true, class: 'btn-primary' }] });
  if (!ok) return;
  const data = Object.fromEntries(new FormData(form));
  try { await api('/api/ia/evidences', { method: 'POST', body: data }); toast('Evidencia enviada a revisión', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
}

function mentorCard(me) {
  if (me.level === 'constructor') {
    return h('section', { class: 'card' }, h('h2', {}, '🤝 Mentoría'),
      me.mentees.length
        ? [h('p', {}, 'Acompañas a:'), h('ul', {}, me.mentees.map((m) => h('li', {}, `${m.name} · desde ${formatDate(m.since)}`)))]
        : h('p', { class: 'muted' }, 'Como Constructor puedes ser mentor. La administración te asignará aprendices.'));
  }
  if (me.mentorship) {
    return h('section', { class: 'card' }, h('h2', {}, '🤝 Mentoría'),
      me.mentorship.status === 'activa'
        ? h('p', {}, 'Tu mentor es ', h('strong', {}, me.mentorship.mentor), `, desde ${formatDate(me.mentorship.started_at)}.`)
        : h('p', { class: 'muted' }, 'Solicitaste un mentor. La administración te asignará un Constructor pronto.'));
  }
  const btn = h('button', { class: 'btn btn-ghost' }, 'Solicitar mentor');
  btn.addEventListener('click', async () => {
    const note = h('textarea', { rows: 2, maxlength: 300, placeholder: '¿En qué te gustaría que te acompañen? (opcional)' });
    const go = await modal({ title: 'Solicitar mentor', body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Es voluntario. Un Constructor te acompañará en tu ruta.'), note),
      actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Solicitar', value: true, class: 'btn-primary' }] });
    if (!go) return;
    try { await api('/api/ia/mentorships', { method: 'POST', body: { note: note.value } }); toast('Solicitud enviada', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
  });
  return h('section', { class: 'card ia-next' }, h('div', { class: 'grow' }, h('h2', {}, '🤝 ¿Quieres un mentor?'), h('p', { class: 'muted' }, 'Un Constructor puede acompañarte. Es voluntario.')), btn);
}

function sessionsTeaser(sessions) {
  const upcoming = sessions.filter((s) => !s.past).slice(0, 2);
  return h('section', { class: 'card' },
    h('div', { class: 'section-head' }, h('h2', {}, '🎤 Demo Days y microaprendizajes'), h('a', { class: 'btn btn-ghost btn-sm', href: '#/ia/sesiones' }, 'Ver calendario')),
    upcoming.length ? h('ul', { class: 'plain ia-list' }, upcoming.map((s) => h('li', {}, h('span', { class: 'ia-kind' }, s.kind === 'demo_day' ? '🎤' : '💡'),
      h('div', { class: 'grow' }, h('strong', {}, s.title), h('div', { class: 'small muted' }, formatDate(s.starts_at))))))
      : h('p', { class: 'small muted' }, 'No hay sesiones programadas todavía.'));
}

const heatmapLink = () => h('a', { class: 'card ia-next ia-link', href: '#/ia/mapa' }, h('span', { class: 'big-emoji' }, '🗺️'),
  h('div', { class: 'grow' }, h('h2', {}, 'Mapa de calor'), h('p', { class: 'muted' }, 'Cuántas personas hay en cada nivel, por área.')), h('span', {}, '→'));

// ---------- Examen ----------
async function renderIaExam() {
  const root = h('div', { class: 'page narrow ia-exam' });
  let timer = null;
  const stop = () => clearInterval(timer);
  window.addEventListener('hashchange', stop, { once: true });

  const paint = (s) => {
    stop();
    if (s.status === 'none') { location.hash = '#/ia'; return; }
    if (s.status !== 'question') { root.replaceChildren(resultView(s)); return; }
    const endAt = Date.now() + s.remaining_ms;
    const bar = h('div', { class: 'ia-timer' }, h('span'));
    const secs = h('strong', { class: 'ia-secs' }, Math.ceil(s.remaining_ms / 1000));
    const answers = h('div', { class: 'answer-grid' }, s.options.map((opt, k) => h('button', {
      class: `answer answer-${k}`,
      onclick: async (e) => {
        answers.querySelectorAll('button').forEach((b) => { b.disabled = true; if (b !== e.currentTarget) b.classList.add('dim'); });
        stop();
        try { paint(await api('/api/ia/answer', { method: 'POST', body: { attempt_id: s.attempt_id, position: s.position, choice: k } })); } catch (err) { toast(err.message, 'error'); paint(await api('/api/ia/current')); }
      },
    }, h('span', { class: 'shape' }, SHAPES[k]), h('span', {}, opt))));
    root.replaceChildren(
      h('div', { class: 'quiz-progress' }, Array.from({ length: s.total }, (_, i) => h('span', { class: i + 1 < s.position ? 'done' : i + 1 === s.position ? 'current' : '' }))),
      h('div', { class: 'ia-exam-head' }, h('span', {}, `Pregunta ${s.position} de ${s.total}`), h('span', { class: 'tag' }, `${DIFFICULTY[s.difficulty]} · ${s.points} pts`), secs),
      bar,
      h('h2', { class: 'quiz-q' }, s.prompt),
      answers);
    const tick = async () => {
      const left = Math.max(0, endAt - Date.now());
      bar.firstChild.style.width = `${(left / 60000) * 100}%`;
      bar.classList.toggle('low', left < 10000);
      secs.textContent = Math.ceil(left / 1000);
      if (left <= 0) {
        stop();
        answers.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        toast('Se acabó el tiempo de esta pregunta', 'error');
        setTimeout(async () => { try { paint(await api('/api/ia/current')); } catch (err) { toast(err.message, 'error'); } }, 3200);
      }
    };
    tick();
    timer = setInterval(tick, 200);
  };

  paint(await api('/api/ia/current'));
  return root;
}

function resultView(r) {
  const info = IA_LEVELS[r.level];
  if (r.level === 'constructor') setTimeout(confetti, 300);
  return h('div', { class: 'card ia-result' },
    h('div', { class: 'ia-level-icon big' }, info.icon),
    h('p', { class: 'eyebrow' }, 'Tu nivel IA'),
    h('h1', {}, info.name),
    h('div', { class: 'score-ring', style: { '--pct': `${r.score}` } }, h('span', {}, r.score)),
    h('p', { class: 'muted' }, 'de 100 puntos'),
    h('div', { class: 'ia-breakdown' }, (r.by_difficulty ?? []).map((d) => h('div', {},
      h('strong', {}, DIFFICULTY[d.difficulty]), h('span', {}, `${d.correct} de ${d.total} · ${d.earned}/${d.possible} pts`)))),
    r.unanswered > 0 && h('p', { class: 'small muted' }, `${r.unanswered} sin responder por tiempo.`),
    h('a', { class: 'btn btn-primary btn-lg', href: '#/ia' }, 'Ver mi ruta'));
}

// ---------- Demo Days y microaprendizajes ----------
async function renderIaSessions() {
  const sessions = await api('/api/ia/sessions');
  const upcoming = sessions.filter((s) => !s.past);
  const past = sessions.filter((s) => s.past).reverse();
  const isAdmin = session.user?.role === 'admin';
  const card = (s) => {
    const actions = h('div', { class: 'row' });
    if (!s.past && s.kind === 'demo_day') {
      if (s.my_pitch) {
        actions.append(h('span', { class: 'small' }, `🎤 Presentas: ${s.my_pitch}`), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => signup(s, '') }, 'Cancelar'));
      } else {
        actions.append(h('button', { class: 'btn btn-primary btn-sm', onclick: () => askPitch(s) }, 'Inscribirme para presentar'));
      }
    }
    if (s.past) {
      actions.append(s.my_rating
        ? h('span', { class: 'small' }, `Tu calificación: ${'★'.repeat(s.my_rating)}${'☆'.repeat(5 - s.my_rating)}`)
        : h('button', { class: 'btn btn-secondary btn-sm', onclick: () => askFeedback(s) }, 'Calificar la sesión'));
      if (isAdmin && s.feedback_count) actions.append(h('span', { class: 'small muted' }, `Promedio ${s.avg_rating} ★ (${s.feedback_count})`));
    }
    return h('article', { class: 'card ia-session' },
      h('div', { class: 'ia-date' }, h('strong', {}, new Date(s.starts_at).toLocaleDateString('es', { day: '2-digit' })),
        h('span', {}, new Date(s.starts_at).toLocaleDateString('es', { month: 'short' }))),
      h('div', { class: 'grow' },
        h('span', { class: 'tag' }, s.kind === 'demo_day' ? 'Demo Day' : 'Microaprendizaje'),
        h('h3', {}, s.title), h('p', { class: 'small muted' }, formatDate(s.starts_at)),
        s.description && h('p', { class: 'small' }, s.description),
        s.presenters.length > 0 && h('p', { class: 'small' }, '🎤 ', s.presenters.map((p) => `${p.name}: ${p.pitch}`).join(' · ')),
        isAdmin && s.comments?.length > 0 && h('details', { class: 'small' }, h('summary', {}, 'Comentarios'), h('ul', {}, s.comments.map((c) => h('li', {}, c)))),
        actions));
  };
  const signup = async (s, pitch) => {
    try { await api(`/api/ia/sessions/${s.id}/signup`, { method: 'POST', body: { pitch } }); toast(pitch ? '¡Inscrito! Prepara 5 min de pitch + 5 de preguntas' : 'Inscripción cancelada', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
  };
  const askPitch = async (s) => {
    const input = h('input', { maxlength: 150, placeholder: 'Ej.: Bot que concilia pagos en 5 minutos' });
    const go = await modal({ title: 'Presentar en el Demo Day', body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Pitch de 5 minutos + 5 minutos de preguntas.'), h('label', { class: 'field' }, '¿Qué vas a mostrar?', input)),
      actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Inscribirme', value: true, class: 'btn-primary' }] });
    if (go && input.value.trim()) signup(s, input.value.trim());
  };
  const askFeedback = async (s) => {
    let rating = 0;
    const stars = h('div', { class: 'ia-stars', role: 'radiogroup', 'aria-label': 'Calificación' });
    const paintStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: n <= rating ? 'on' : '', 'aria-label': `${n} de 5`, onclick: () => { rating = n; paintStars(); } }, '★')));
    paintStars();
    const comment = h('textarea', { rows: 2, maxlength: 500, placeholder: '¿Qué mejorarías? (opcional)' });
    const go = await modal({ title: `¿Cómo estuvo "${s.title}"?`, body: h('div', { class: 'stack' }, stars, comment),
      actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Enviar', value: true, class: 'btn-primary' }] });
    if (!go) return;
    if (!rating) { toast('Elige de 1 a 5 estrellas', 'error'); return; }
    try { await api(`/api/ia/sessions/${s.id}/feedback`, { method: 'POST', body: { rating, comment: comment.value } }); toast('¡Gracias por tu opinión!', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
  };
  return h('div', { class: 'page narrow' },
    h('a', { href: '#/ia', class: 'small' }, '← Mi nivel IA'),
    h('h1', {}, '🎤 Demo Days y microaprendizajes'),
    h('p', { class: 'muted' }, 'Sesiones cada 2–3 semanas. En los Demo Days cada persona presenta su caso: 5 minutos de pitch y 5 de preguntas.'),
    h('h2', {}, 'Próximas'),
    upcoming.length ? upcoming.map(card) : h('p', { class: 'muted' }, 'No hay sesiones programadas todavía.'),
    past.length > 0 && [h('h2', {}, 'Anteriores'), past.map(card)]);
}

// ---------- Mapa de calor ----------
async function renderIaHeatmap(embedded = false) {
  const isAdmin = session.user?.role === 'admin';
  const areas = isAdmin ? await api('/api/areas?all=1') : [];
  const filters = { area: '', role: '', from: '', to: '' };
  const out = h('div', { class: 'stack' });
  const load = async () => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    out.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
    try { out.replaceChildren(...heatmapView(await api(`/api/ia/heatmap?${q}`), isAdmin)); } catch (err) { out.replaceChildren(h('div', { class: 'card empty-state' }, h('p', {}, err.message))); }
  };
  const sel = (key, label, options) => h('label', { class: 'field' }, label, h('select', { onchange: (e) => { filters[key] = e.target.value; load(); } },
    options.map(([v, t]) => h('option', { value: v }, t))));
  const date = (key, label) => h('label', { class: 'field' }, label, h('input', { type: 'date', onchange: (e) => { filters[key] = e.target.value; load(); } }));
  load();
  return h('div', { class: embedded ? 'stack' : 'page' },
    !embedded && h('a', { href: '#/ia', class: 'small' }, '← Mi nivel IA'),
    !embedded && h('h1', {}, '🗺️ Mapa de calor IA'),
    h('p', { class: 'muted' }, isAdmin ? 'Último examen de cada persona, por área y nivel.' : 'Datos agregados de tu área. Los puntajes individuales no se muestran.'),
    h('div', { class: 'card ia-filters' },
      isAdmin && sel('area', 'Área', [['', 'Todas'], ...areas.map((a) => [a.id, `${a.icon} ${a.name}`])]),
      sel('role', 'Rol', [['', 'Todos'], ...Object.entries(ORG_ROLES)]),
      date('from', 'Desde'), date('to', 'Hasta')),
    out);
}

function heatmapView(data, isAdmin) {
  const total = data.rows.reduce((s, r) => s + (r.hidden ? 0 : r.total), 0);
  const cell = (r, k) => {
    if (r.hidden) return h('td', { class: 'ia-cell muted' }, '—');
    const pct = r.total ? Math.round((100 * r[k]) / r.total) : 0;
    return h('td', { class: `ia-cell lvl-${k}`, style: { '--alpha': `${pct / 100}` } }, h('strong', {}, r[k]), h('span', {}, `${pct}%`));
  };
  const p = data.progress;
  return [
    h('div', { class: 'card table-wrap' }, data.rows.length ? h('table', { class: 'table ia-heat' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Área'), IA_ORDER.map((k) => h('th', {}, `${IA_LEVELS[k].icon} ${IA_LEVELS[k].name}`)), h('th', {}, 'Personas'))),
      h('tbody', {}, data.rows.map((r) => h('tr', {}, h('td', {}, `${r.icon} ${r.area}`), IA_ORDER.map((k) => cell(r, k)),
        h('td', {}, r.hidden ? h('span', { class: 'small muted' }, 'Menos de 3 personas') : r.total))))) : h('p', { class: 'muted' }, 'Todavía no hay exámenes con estos filtros.'),
    total > 0 && h('p', { class: 'small muted' }, `${total} ${total === 1 ? 'persona' : 'personas'} con examen.`)),
    h('div', { class: 'card' }, h('h2', {}, '📈 Primer vs. segundo examen'),
      p.hidden ? h('p', { class: 'muted' }, 'Hay menos de 3 personas con dos exámenes: el dato se mostrará cuando haya más.')
        : p.with_two === 0 ? h('p', { class: 'muted' }, 'Nadie ha presentado el segundo examen todavía.')
          : [h('div', { class: 'kpis' },
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Subieron de nivel'), h('strong', {}, `${Math.round((100 * p.up) / p.with_two)}%`), h('span', { class: 'small muted' }, `${p.up} de ${p.with_two}`)),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Se mantuvieron'), h('strong', {}, p.same)),
            h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Bajaron'), h('strong', {}, p.down))),
          isAdmin && p.people.length > 0 && h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, ['Persona', 'Área', '1.er examen', '2.º examen', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, p.people.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.area ?? '—'), h('td', {}, levelChip(x.first)), h('td', {}, levelChip(x.second)),
              h('td', {}, x.delta > 0 ? '⬆️ Subió' : x.delta < 0 ? '⬇️ Bajó' : '＝'))))))]),
  ];
}

// ---------- Administración ----------
const IA_ADMIN_TABS = [['indicadores', '📊 Indicadores'], ['mapa', '🗺️ Mapa de calor'], ['evidencias', '✅ Evidencias'], ['mentorias', '🤝 Mentorías'], ['sesiones', '🎤 Sesiones'], ['preguntas', '❓ Preguntas'], ['roles', '👤 Roles']];

async function renderIaAdmin(tab = 'indicadores') {
  const views = { indicadores: iaKpis, mapa: () => renderIaHeatmap(true), evidencias: iaEvidences, mentorias: iaMentorships, sesiones: iaSessionsAdmin, preguntas: iaQuestions, roles: iaRoles };
  const view = views[tab] ?? iaKpis;
  return h('div', { class: 'page' }, adminTabs('formacion'),
    h('nav', { class: 'chips ia-subtabs' }, IA_ADMIN_TABS.map(([k, label]) => h('a', { class: `chip ${k === tab ? 'active' : ''}`, href: `#/admin/formacion/${k}` }, label))),
    await view());
}

async function iaKpis() {
  const k = await api('/api/ia/kpis');
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const kpi = (label, value, detail, meta, freq) => h('div', { class: 'card kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', {}, value),
    h('span', { class: 'small muted' }, detail), h('span', { class: 'small' }, `Meta: ${meta} · ${freq}`));
  const total = h('input', { type: 'number', min: 0, value: k.total_from_config ? k.total_personal : '', placeholder: String(k.total_personal), style: { width: '110px' } });
  const saveTotal = h('button', { class: 'btn btn-ghost btn-sm' }, 'Guardar');
  saveTotal.addEventListener('click', async () => {
    try { await busy(saveTotal, () => api('/api/ia/total', { method: 'POST', body: { total: Number(total.value) || 0 } })); toast('Total actualizado', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
  });
  const demoBtn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Preparar usuarios de prueba');
  demoBtn.addEventListener('click', async () => {
    try {
      const r = await busy(demoBtn, () => api('/api/ia/demo-setup', { method: 'POST', body: {} }));
      toast(r.missing.length ? `Faltan por crear: ${r.missing.join(', ')}` : 'Usuarios de prueba listos', r.missing.length ? 'error' : 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('Cobertura del diagnóstico', pct(k.tested, k.total_personal), `${k.tested} de ${k.total_personal} personas con examen`, '100% al 30-nov', 'semanal'),
      kpi('Subida de nivel', pct(k.up, k.with_two), `${k.up} de ${k.with_two} con dos exámenes`, '≥ 30%', 'trimestral'),
      kpi('Impacto medido', pct(k.artifacts_measured, k.artifacts), `${k.artifacts_measured} de ${k.artifacts} artefactos con horas o calidad`, '100%', 'mensual'),
      kpi('Horas ahorradas al mes', `${Number(k.hours_month)} h`, 'Suma de evidencias validadas', 'línea base en dic', 'mensual')),
    h('div', { class: 'card' }, h('h3', {}, 'Personas por nivel'),
      h('div', { class: 'ia-levels-row' }, IA_ORDER.map((l) => h('div', { class: `ia-mini lvl-${l}` }, h('span', {}, IA_LEVELS[l].icon), h('strong', {}, k.levels[l]), h('span', { class: 'small muted' }, IA_LEVELS[l].name))))),
    (k.pending_evidences > 0 || k.pending_mentorships > 0) && h('div', { class: 'card callout' }, h('strong', {}, 'Por atender: '),
      k.pending_evidences > 0 && h('a', { href: '#/admin/formacion/evidencias' }, `${k.pending_evidences} evidencias por validar`),
      k.pending_evidences > 0 && k.pending_mentorships > 0 && ' · ',
      k.pending_mentorships > 0 && h('a', { href: '#/admin/formacion/mentorias' }, `${k.pending_mentorships} solicitudes de mentoría`)),
    h('div', { class: 'card stack' },
      h('label', { class: 'field inline' }, 'Total del personal', total, saveTotal),
      h('p', { class: 'small muted' }, k.total_from_config ? 'Se usa el número oficial que registraste.' : 'Mientras no registres el número oficial, se usa el total de personas con cuenta.'),
      h('div', { class: 'row' }, demoBtn, h('span', { class: 'small muted' }, 'Crea primero las cuentas demo.explorador@, demo.practicante@ y demo.constructor@ desde la pantalla de ingreso. No cuentan en los indicadores.'))));
}

async function iaEvidences() {
  let status = 'pendiente';
  const list = h('div', { class: 'stack' });
  const load = async () => {
    const items = await api(`/api/ia/evidences?status=${status}`);
    list.replaceChildren(...(items.length ? items.map((e) => {
      const review = async (target) => {
        let note = '';
        if (target === 'rechazada') {
          const input = h('input', { maxlength: 200, placeholder: '¿Qué debe ajustar?' });
          if (!await modal({ title: 'Pedir ajustes', body: input, actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: 'Enviar', value: true, class: 'btn-primary' }] })) return;
          note = input.value;
        }
        try { await api(`/api/ia/evidences/${e.id}/review`, { method: 'POST', body: { status: target, note } }); toast(target === 'validada' ? 'Evidencia validada' : 'Se pidieron ajustes', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
      };
      return h('div', { class: 'card ia-evidence' },
        h('div', { class: 'grow' },
          h('div', { class: 'row small muted' }, h('strong', {}, e.person), e.area && h('span', {}, e.area), levelChip(e.level), h('span', {}, formatDate(e.created_at))),
          h('h3', {}, `${e.kind === 'artefacto' ? '🧩' : '📝'} ${e.title}`),
          h('p', { class: 'small' }, [e.hours_month > 0 && `${e.hours_month} h/mes`, e.quality].filter(Boolean).join(' · ') || 'Sin horas ni calidad registradas'),
          e.link && h('a', { href: e.link, target: '_blank', rel: 'noopener', class: 'small' }, 'Abrir enlace ↗')),
        e.status === 'pendiente'
          ? h('div', { class: 'row' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => review('rechazada') }, 'Pedir ajustes'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => review('validada') }, 'Validar'))
          : h('span', { class: `ia-status st-${e.status}` }, EVIDENCE_STATUS[e.status]));
    }) : [h('p', { class: 'muted' }, 'No hay evidencias en este estado.')]));
  };
  const seg = h('div', { class: 'seg' }, Object.entries({ pendiente: 'Por validar', validada: 'Validadas', rechazada: 'Con ajustes' }).map(([k, label]) => h('button', {
    class: k === status ? 'active' : '', onclick: (e) => { status = k; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget)); load(); },
  }, label)));
  await load();
  return h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Una evidencia validada habilita a la persona para presentar de nuevo el examen y subir de nivel.'), seg, list);
}

async function iaMentorships() {
  const { items, mentors } = await api('/api/ia/mentorships');
  const statusLabel = { solicitada: '🙋 Solicitada', activa: '🤝 Activa', cerrada: '✔ Cerrada' };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Exploradores y Practicantes pueden pedir un mentor. Asigna una persona de nivel Constructor.'),
    items.length ? items.map((m) => {
      const select = h('select', {}, h('option', { value: '' }, 'Elige un Constructor'), mentors.map((x) => h('option', { value: x.id }, `${x.name}${x.area ? ` · ${x.area}` : ''} (${x.active} activas)`)));
      const assign = h('button', { class: 'btn btn-primary btn-sm' }, 'Asignar');
      assign.addEventListener('click', async () => {
        if (!select.value) return toast('Elige un mentor', 'error');
        try { await busy(assign, () => api(`/api/ia/mentorships/${m.id}/assign`, { method: 'POST', body: { mentor_id: select.value } })); toast('Mentor asignado', 'success'); router(); } catch (err) { toast(err.message, 'error'); }
      });
      const close = h('button', { class: 'btn btn-ghost btn-sm' }, 'Cerrar');
      close.addEventListener('click', async () => {
        try { await busy(close, () => api(`/api/ia/mentorships/${m.id}/close`, { method: 'POST', body: {} })); router(); } catch (err) { toast(err.message, 'error'); }
      });
      return h('div', { class: 'card ia-evidence' },
        h('div', { class: 'grow' },
          h('div', { class: 'row small muted' }, h('span', {}, statusLabel[m.status]), h('span', {}, formatDate(m.requested_at))),
          h('h3', {}, m.mentee, ' ', levelChip(m.mentee_level)),
          m.mentee_area && h('p', { class: 'small muted' }, m.mentee_area),
          m.note && h('p', { class: 'small' }, `"${m.note}"`),
          m.mentor && h('p', { class: 'small' }, `Mentor: ${m.mentor}`)),
        m.status === 'solicitada' && h('div', { class: 'row' }, select, assign),
        m.status === 'activa' && close);
    }) : h('p', { class: 'muted' }, 'No hay solicitudes de mentoría.'),
    mentors.length === 0 && h('p', { class: 'small muted' }, 'Todavía no hay personas de nivel Constructor para asignar.'));
}

async function iaSessionsAdmin() {
  const sessions = await api('/api/ia/sessions');
  const form = h('form', { class: 'card stack' },
    h('h3', {}, 'Programar sesión'),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, 'Tipo', h('select', { name: 'kind' }, h('option', { value: 'demo_day' }, '🎤 Demo Day'), h('option', { value: 'micro' }, '💡 Microaprendizaje'))),
      h('label', { class: 'field' }, 'Fecha y hora', h('input', { name: 'starts_at', type: 'datetime-local', required: true }))),
    h('label', { class: 'field' }, 'Título', h('input', { name: 'title', required: true, maxlength: 120 })),
    h('label', { class: 'field' }, 'Descripción (opcional)', h('input', { name: 'description', maxlength: 300 })),
    h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Programar')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      await busy(form.querySelector('button[type=submit]'), () => api('/api/ia/sessions', { method: 'POST', body: { ...data, starts_at: new Date(data.starts_at).toISOString() } }));
      toast('Sesión programada', 'success'); router();
    } catch (err) { toast(err.message, 'error'); }
  });
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Sesiones cada 2–3 semanas. Las personas se inscriben para presentar y califican la sesión al terminar. ', h('a', { href: '#/ia/sesiones' }, 'Ver como participante')),
    form,
    sessions.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Fecha', 'Sesión', 'Presentan', 'Encuesta', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, sessions.map((s) => h('tr', {},
        h('td', {}, formatDate(s.starts_at)),
        h('td', {}, `${s.kind === 'demo_day' ? '🎤' : '💡'} ${s.title}`),
        h('td', {}, s.presenters.length),
        h('td', {}, s.feedback_count ? `${s.avg_rating} ★ (${s.feedback_count})` : '—'),
        h('td', {}, h('button', { class: 'icon-btn danger', 'aria-label': 'Eliminar', onclick: async () => {
          if (!await confirmAction('Eliminar sesión', `¿Eliminar "${s.title}"? Se borran sus inscripciones y encuestas.`, 'Eliminar', true)) return;
          try { await api(`/api/ia/sessions/${s.id}`, { method: 'DELETE' }); router(); } catch (err) { toast(err.message, 'error'); }
        } }, '🗑'))))))) : h('p', { class: 'muted' }, 'No hay sesiones programadas.'));
}

async function iaQuestions() {
  const bank = await api('/api/ia/questions');
  const need = { facil: 3, media: 3, dificil: 4 };
  const editor = (q) => {
    const state = q ? { ...q, options: [...q.options] } : { difficulty: 'facil', prompt: '', options: ['', '', '', ''], correct_index: 0, explanation: '', active: true };
    while (state.options.length < 4) state.options.push('');
    const name = `ok-${q?.id ?? 'nueva'}`;
    const save = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, q ? 'Guardar' : 'Agregar pregunta');
    const body = h('div', { class: 'stack' },
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, 'Dificultad', h('select', { onchange: (e) => { state.difficulty = e.target.value; } },
          Object.entries(DIFFICULTY).map(([k, t]) => h('option', { value: k, selected: k === state.difficulty }, `${t} · ${{ facil: 6, media: 10, dificil: 13 }[k]} pts`)))),
        h('label', { class: 'field inline' }, h('input', { type: 'checkbox', checked: state.active, onchange: (e) => { state.active = e.target.checked; }, style: { width: 'auto' } }), 'Activa')),
      h('label', { class: 'field' }, 'Pregunta', h('input', { value: state.prompt, oninput: (e) => { state.prompt = e.target.value; } })),
      h('div', { class: 'options-edit' }, [0, 1, 2, 3].map((k) => h('label', { class: `option-edit answer-${k}` },
        h('input', { type: 'radio', name, checked: state.correct_index === k, title: 'Correcta', onchange: () => { state.correct_index = k; } }),
        h('span', { class: 'shape' }, SHAPES[k]),
        h('input', { value: state.options[k], placeholder: k < 2 ? `Opción ${k + 1}` : `Opción ${k + 1} (opcional)`, oninput: (e) => { state.options[k] = e.target.value; } })))),
      h('label', { class: 'field' }, 'Explicación (solo para la administración)', h('input', { value: state.explanation, oninput: (e) => { state.explanation = e.target.value; } })),
      h('div', {}, save));
    save.addEventListener('click', async () => {
      const filled = state.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      const correct = filled.findIndex((x) => x.i === state.correct_index);
      if (correct < 0) return toast('La opción marcada como correcta está vacía', 'error');
      try {
        await busy(save, () => api('/api/ia/questions', { method: 'POST', body: { ...state, options: filled.map((x) => x.o), correct_index: correct } }));
        toast('Pregunta guardada', 'success'); router();
      } catch (err) { toast(err.message, 'error'); }
    });
    return body;
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Cada examen toma al azar 3 fáciles (6 pts), 3 medias (10 pts) y 4 difíciles (13 pts) entre las activas: 100 puntos. Las opciones se muestran en orden aleatorio.'),
    h('div', { class: 'row' }, Object.entries(need).map(([d, n]) => {
      const active = bank.filter((q) => q.active && q.difficulty === d).length;
      return h('span', { class: `ia-status ${active >= n ? 'st-validada' : 'st-pendiente'}` }, `${DIFFICULTY[d]}: ${active} activas (mín. ${n})`);
    })),
    bank.some((q) => q.draft) && h('div', { class: 'card callout warn' }, h('strong', {}, 'Borrador: '), 'las preguntas marcadas como borrador son una propuesta inicial. Revísalas con Germán antes del lanzamiento; al guardarlas dejan de ser borrador.'),
    h('details', { class: 'card' }, h('summary', {}, h('strong', {}, '+ Nueva pregunta')), editor(null)),
    bank.map((q) => h('details', { class: 'card ia-q' },
      h('summary', {}, h('span', { class: 'tag' }, DIFFICULTY[q.difficulty]), ' ', q.draft && h('span', { class: 'ia-status st-pendiente' }, 'Borrador'), ' ',
        !q.active && h('span', { class: 'ia-status st-rechazada' }, 'Inactiva'), ' ', q.prompt),
      editor(q))));
}

async function iaRoles() {
  const users = await api('/api/admin/users');
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'El rol define el foco de la ruta. Los directores ven el mapa de calor agregado de su área, sin puntajes individuales.'),
    h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Persona', 'Área', 'Nivel IA', 'Rol'].map((t) => h('th', {}, t)))),
      h('tbody', {}, users.filter((u) => u.active).map((u) => h('tr', {},
        h('td', {}, u.name, u.is_demo && h('span', { class: 'tag' }, ' demo')), h('td', {}, u.area_name ? `${u.area_icon} ${u.area_name}` : '—'), h('td', {}, levelChip(u.ia_level)),
        h('td', {}, h('select', { 'aria-label': `Rol de ${u.name}`, onchange: async (e) => {
          const sel = e.target;
          try { await api(`/api/admin/users/${u.id}/org-role`, { method: 'POST', body: { org_role: sel.value || null } }); toast(`Rol de ${u.name} actualizado`, 'success'); } catch (err) { toast(err.message, 'error'); sel.value = u.org_role ?? ''; }
        } }, h('option', { value: '' }, 'Sin rol'), Object.entries(ORG_ROLES).map(([k, t]) => h('option', { value: k, selected: k === u.org_role }, t))))))))));
}

// ---------- Registro en la app ----------
globalThis.ACADEMIA_EXT = {
  routes: [
    { re: /^\/ia$/, view: renderIaHome },
    { re: /^\/ia\/examen$/, view: renderIaExam },
    { re: /^\/ia\/sesiones$/, view: renderIaSessions },
    { re: /^\/ia\/mapa$/, view: () => renderIaHeatmap(false) },
    { re: /^\/admin\/formacion(?:\/(\w+))?$/, view: renderIaAdmin, admin: true },
  ],
  navLinks: [{ href: '/ia', label: 'Nivel IA 🚀', match: (p) => p.startsWith('/ia') }],
  adminTabs: [{ href: '/admin/formacion', label: 'Formación IA', key: 'formacion' }],
  homeCard: () => {
    const lvl = session.user?.ia_level;
    return h('a', { class: `hero-game ia-home-card lvl-${lvl ?? 'none'}`, href: '#/ia' },
      h('span', { class: 'big-emoji' }, lvl ? IA_LEVELS[lvl].icon : '🚀'),
      h('strong', {}, lvl ? `Nivel IA: ${IA_LEVELS[lvl].name}` : 'Descubre tu nivel IA'),
      h('span', { class: 'small' }, lvl ? 'Ver mi ruta' : 'Examen de 10 preguntas'));
  },
};
