import { api, session } from '../api.js';
import { h, markdown, toast, busy, videoEmbed, confetti, SHAPES } from '../ui.js';
import { afterLogin } from '../app.js';

// ---------- Login ----------
export function renderLogin() {
  const nameField = h('label', { class: 'field hidden' }, 'Tu nombre',
    h('span', { class: 'small muted' }, 'Es tu primera vez aquí 🎉 ¿Cómo te llamas?'),
    h('input', { name: 'name', autocomplete: 'name', placeholder: 'Nombre y apellido' }));
  const form = h('form', { class: 'login-card card' },
    h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')),
    h('h1', {}, '¡Bienvenido! 👋'),
    h('p', { class: 'muted' }, 'Tu espacio para aprender todo lo que necesitas en tus primeros días.'),
    h('label', { class: 'field' }, 'Correo de trabajo', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: 'tu@empresa.com' })),
    nameField,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar'),
    h('a', { href: '#/jugar', class: 'link-center' }, '¿Tienes un PIN de juego? Únete aquí'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await busy(btn, () => api('/api/auth/login', { method: 'POST', body: data }), 'Entrando…');
      if (res.needs_name) {
        nameField.classList.remove('hidden');
        const input = nameField.querySelector('input');
        input.required = true;
        input.focus();
        btn.textContent = 'Crear mi cuenta';
        return;
      }
      session.token = res.token;
      afterLogin(res.user);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return h('div', { class: 'login-wrap' }, form);
}

// ---------- Elegir área ----------
export async function renderAreaPicker() {
  const areas = await api('/api/areas');
  const current = session.user.area_id;
  const first = !current;
  const grid = h('div', { class: 'area-grid' }, areas.map((a) => h('button', {
    class: `area-card ${a.id === current ? 'selected' : ''}`, type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      grid.querySelectorAll('.area-card').forEach((b) => { b.disabled = true; b.classList.toggle('selected', b === btn); });
      try {
        const r = await api('/api/me/area', { method: 'POST', body: { area_id: a.id } });
        Object.assign(session.user, { area_id: r.area.id, area_name: r.area.name, area_icon: r.area.icon });
        toast(first ? `¡Listo! Estos son los cursos de ${r.area.name}` : `Ahora ves los cursos de ${r.area.name}`, 'success');
        location.hash = '#/';
      } catch (err) {
        grid.querySelectorAll('.area-card').forEach((b) => { b.disabled = false; });
        toast(err.message, 'error');
      }
    },
  }, h('span', { class: 'area-icon' }, a.icon), h('strong', {}, a.name))));
  return h('div', { class: 'page narrow area-page' },
    h('p', { class: 'eyebrow' }, first ? 'Antes de empezar' : 'Tu área'),
    h('h1', {}, first ? `¡Hola, ${session.user.name.split(' ')[0]}! ¿En qué área vas a trabajar?` : 'Cambiar de área'),
    h('p', { class: 'muted' }, 'Te mostraremos los cursos de tu área y los que son para toda la empresa. Puedes cambiarla cuando quieras.'),
    grid,
    !first && h('a', { href: '#/', class: 'small' }, '← Volver sin cambiar'),
    first && session.user.role === 'admin' && h('a', { href: '#/admin', class: 'small' }, 'Ahora no, ir a la administración'));
}

// ---------- Inicio ----------
export async function renderHome() {
  const [courses, me, areaBoard] = await Promise.all([api('/api/courses'), api('/api/me'), api('/api/leaderboard?scope=area')]);
  const { stats } = me;
  const user = me.user;
  Object.assign(session.user, user);
  const inProgress = courses.filter((c) => c.done_count > 0 && c.done_count < c.lesson_count);
  const categories = ['Todos', ...new Set(courses.map((c) => c.category))];
  let filter = { q: '', cat: 'Todos' };

  const grid = h('div', { class: 'course-grid' });
  const paintGrid = () => {
    const q = filter.q.toLowerCase();
    const list = courses.filter((c) => (filter.cat === 'Todos' || c.category === filter.cat)
      && (!q || `${c.title} ${c.description}`.toLowerCase().includes(q)));
    grid.replaceChildren(...(list.length ? list.map(courseCard) : [h('p', { class: 'muted' }, 'No hay cursos que coincidan.')]));
  };
  const chips = h('div', { class: 'chips' }, categories.map((cat) => h('button', {
    class: `chip ${cat === filter.cat ? 'active' : ''}`,
    onclick: (e) => { filter.cat = cat; chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === e.currentTarget)); paintGrid(); },
  }, cat)));
  paintGrid();

  const progressPct = stats.next_at ? Math.round((stats.xp / stats.next_at) * 100) : 100;

  return h('div', { class: 'page' },
    h('section', { class: 'hero card' },
      h('div', {},
        h('p', { class: 'eyebrow' }, `Nivel ${stats.level} · ${stats.name}`),
        h('h1', {}, `Hola, ${session.user.name.split(' ')[0]} ✨`),
        user.area_id && h('p', { class: 'area-line' }, h('span', { class: 'area-pill' }, `${user.area_icon} ${user.area_name}`), h('a', { href: '#/area', class: 'small' }, 'Cambiar área')),
        h('p', { class: 'muted' }, stats.lessons_done ? `Llevas ${stats.lessons_done} lecciones completadas. ¡Sigue así!` : 'Empieza tu primer curso y gana tus primeros puntos.'),
        h('div', { class: 'xp-bar', role: 'progressbar', 'aria-valuenow': progressPct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: `${progressPct}%` } })),
        h('p', { class: 'small muted' }, stats.next_at ? `${stats.xp} / ${stats.next_at} XP para el siguiente nivel` : `${stats.xp} XP · nivel máximo`)),
      h('a', { class: 'hero-game', href: '#/jugar' }, h('span', { class: 'big-emoji' }, '🎮'), h('strong', {}, 'Unirme a un juego'), h('span', { class: 'small' }, 'Ingresa el PIN'))),

    inProgress.length > 0 && h('section', {},
      h('h2', {}, 'Continúa donde quedaste'),
      h('div', { class: 'course-grid' }, inProgress.map(courseCard))),

    h('div', { class: 'home-layout' },
      h('section', {},
        h('div', { class: 'section-head' }, h('h2', {}, user.area_id ? `Tus cursos de ${user.area_name}` : 'Catálogo de cursos'),
          h('input', { class: 'search', type: 'search', placeholder: 'Buscar curso…', 'aria-label': 'Buscar curso', oninput: (e) => { filter.q = e.target.value; paintGrid(); } })),
        chips, grid),
      h('aside', { class: 'side' },
        h('div', { class: 'card' }, h('h3', {}, 'Tus insignias'),
          h('div', { class: 'badges' }, stats.badges.map((b) => h('div', { class: `badge ${b.earned ? 'earned' : ''}`, title: b.desc }, h('span', { class: 'badge-icon' }, b.icon), h('span', {}, b.name))))),
        rankingCard(user, areaBoard))));
}

// Ranking con dos vistas: el área de la persona o toda la empresa.
function rankingCard(user, areaBoard) {
  const list = h('ol', { class: 'leaderboard' });
  const paint = (board) => list.replaceChildren(...board.slice(0, 8).map((r, i) => h('li', { class: r.id === session.user.id ? 'me' : '' },
    h('span', { class: 'rank' }, ['🥇', '🥈', '🥉'][i] ?? i + 1), h('span', { class: 'lb-name' }, r.name), h('span', { class: 'lb-xp' }, `${r.xp} XP`))));
  const cache = { area: areaBoard, all: null };
  const tabs = h('div', { class: 'seg', role: 'tablist' });
  const tab = (key, label) => h('button', { class: key === 'area' ? 'active' : '', role: 'tab', onclick: async (e) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
    try { cache[key] ??= await api('/api/leaderboard'); paint(cache[key]); } catch (err) { toast(err.message, 'error'); }
  } }, label);
  if (user.area_id) tabs.append(tab('area', user.area_name), tab('all', 'Toda la empresa'));
  paint(areaBoard);
  return h('div', { class: 'card' }, h('h3', {}, 'Ranking 🏆'), user.area_id && tabs, list);
}

function courseCard(c) {
  const pct = c.lesson_count ? Math.round((c.done_count / c.lesson_count) * 100) : 0;
  return h('a', { class: 'course-card card', href: `#/curso/${c.id}` },
    h('div', { class: 'course-cover' }, h('span', {}, c.cover_emoji)),
    h('div', { class: 'course-body' },
      h('div', { class: 'row' }, h('span', { class: 'tag' }, c.category),
        h('span', { class: `audience ${c.areas?.length ? 'mine' : ''}` }, c.areas?.length ? `Para ${session.user.area_name ?? 'tu área'}` : '🌎 Toda la empresa')),
      h('h3', {}, c.title),
      h('p', { class: 'muted clamp' }, c.description),
      h('div', { class: 'course-meta' }, h('span', {}, `${c.lesson_count} lecciones`), h('span', {}, `~${c.total_min} min`)),
      h('div', { class: 'mini-progress' }, h('span', { style: { width: `${pct}%` } })),
      h('span', { class: 'small muted' }, pct === 100 ? '✅ Completado' : pct ? `${pct}% completado` : 'Sin empezar')));
}

// ---------- Curso ----------
export async function renderCourse(courseId, lessonId) {
  const course = await api(`/api/courses/${courseId}`);
  const done = new Set(course.progress.done_lesson_ids);
  const lesson = course.lessons.find((l) => l.id === lessonId)
    ?? course.lessons.find((l) => !done.has(l.id)) ?? course.lessons[0];
  if (!lesson) return h('div', { class: 'card empty-state' }, h('h2', {}, 'Este curso todavía no tiene lecciones.'));
  const idx = course.lessons.indexOf(lesson);
  const nextLesson = course.lessons[idx + 1];

  const progressBar = h('div', { class: 'xp-bar' }, h('span', { style: { width: `${course.progress.percent}%` } }));
  const progressLabel = h('span', { class: 'small muted' }, `${course.progress.done}/${course.progress.total} lecciones`);
  const outline = h('ol', { class: 'outline' }, course.lessons.map((l, i) => h('li', {},
    h('a', { href: `#/curso/${course.id}/leccion/${l.id}`, class: `${l.id === lesson.id ? 'current' : ''} ${done.has(l.id) ? 'done' : ''}` },
      h('span', { class: 'outline-icon' }, done.has(l.id) ? '✓' : { video: '▶', reading: '📄', quiz: '❓' }[l.type]),
      h('span', {}, `${i + 1}. ${l.title}`), h('span', { class: 'small muted' }, `${l.duration_min}′`)))));

  const onCompleted = (result) => {
    done.add(lesson.id);
    outline.querySelector('a.current')?.classList.add('done');
    const icon = outline.querySelector('a.current .outline-icon');
    if (icon) icon.textContent = '✓';
    progressBar.firstChild.style.width = `${result.progress?.percent ?? Math.round((done.size / course.lessons.length) * 100)}%`;
    progressLabel.textContent = `${done.size}/${course.lessons.length} lecciones`;
    if (result.gained) toast(`+${result.gained} XP 🎉`, 'success');
    if (result.finished_course) { confetti(); toast('¡Terminaste el curso! 🏅', 'success'); }
  };

  const nextButton = () => nextLesson
    ? h('a', { class: 'btn btn-primary', href: `#/curso/${course.id}/leccion/${nextLesson.id}` }, 'Siguiente lección →')
    : h('a', { class: 'btn btn-primary', href: '#/' }, 'Volver al inicio');

  let body;
  if (lesson.type === 'quiz') body = quizPlayer(lesson, onCompleted, nextButton);
  else {
    const completeBtn = h('button', { class: `btn ${done.has(lesson.id) ? 'btn-ghost' : 'btn-secondary'}` }, done.has(lesson.id) ? '✓ Completada' : 'Marcar como completada');
    const complete = async () => {
      if (done.has(lesson.id)) return;
      completeBtn.textContent = '✓ Completada'; completeBtn.className = 'btn btn-ghost'; // respuesta optimista
      try { onCompleted(await api(`/api/lessons/${lesson.id}/complete`, { method: 'POST' })); } catch (err) {
        completeBtn.textContent = 'Marcar como completada'; completeBtn.className = 'btn btn-secondary';
        toast(err.message, 'error');
      }
    };
    completeBtn.addEventListener('click', complete);
    const media = lesson.type === 'video' ? videoEmbed(lesson.video_url) : null;
    media?.addEventListener?.('ended', complete);
    body = h('div', {},
      media,
      lesson.content && h('article', { class: 'prose', html: markdown(lesson.content) }),
      h('div', { class: 'lesson-actions' }, completeBtn, nextButton()));
  }

  return h('div', { class: 'page course-layout' },
    h('aside', { class: 'course-side card' },
      h('a', { href: '#/', class: 'small' }, '← Todos los cursos'),
      h('div', { class: 'course-title-row' }, h('span', { class: 'big-emoji' }, course.cover_emoji), h('h2', {}, course.title)),
      progressBar, progressLabel, outline),
    h('section', { class: 'lesson card' },
      h('p', { class: 'eyebrow' }, `Lección ${idx + 1} de ${course.lessons.length}`),
      h('h1', {}, lesson.title),
      body));
}

function quizPlayer(lesson, onCompleted, nextButton) {
  const answers = new Array(lesson.questions.length).fill(null);
  const host = h('div', { class: 'quiz' });
  let i = 0;

  const paintQuestion = () => {
    const q = lesson.questions[i];
    host.replaceChildren(
      h('div', { class: 'quiz-progress' }, lesson.questions.map((_, k) => h('span', { class: k < i ? 'done' : k === i ? 'current' : '' }))),
      h('p', { class: 'small muted' }, `Pregunta ${i + 1} de ${lesson.questions.length}`),
      h('h2', { class: 'quiz-q' }, q.prompt),
      h('div', { class: 'answer-grid' }, q.options.map((opt, k) => h('button', {
        class: `answer answer-${k}`,
        onclick: () => { answers[i] = k; i += 1; i < lesson.questions.length ? paintQuestion() : submit(); },
      }, h('span', { class: 'shape' }, SHAPES[k]), h('span', {}, opt)))));
  };

  const submit = async () => {
    host.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
    try {
      const r = await api(`/api/lessons/${lesson.id}/quiz`, { method: 'POST', body: { answers } });
      if (r.passed) onCompleted(r);
      if (r.score === r.total) confetti();
      host.replaceChildren(
        h('div', { class: `quiz-result ${r.passed ? 'ok' : 'retry'}` },
          h('div', { class: 'score-ring', style: { '--pct': `${Math.round((r.score / r.total) * 100)}` } }, h('span', {}, `${r.score}/${r.total}`)),
          h('h2', {}, r.passed ? (r.score === r.total ? '¡Perfecto! 🎯' : '¡Aprobado! 🎉') : 'Casi lo logras 💪'),
          h('p', { class: 'muted' }, r.passed ? 'Revisa las explicaciones para reforzar lo aprendido.' : 'Necesitas 70% para aprobar. Revisa las explicaciones e inténtalo de nuevo.')),
        h('ol', { class: 'review' }, lesson.questions.map((q, k) => {
          const res = r.results[k];
          return h('li', { class: res.is_correct ? 'correct' : 'wrong' },
            h('strong', {}, `${res.is_correct ? '✅' : '❌'} ${q.prompt}`),
            h('p', {}, 'Respuesta correcta: ', h('b', {}, q.options[res.correct_index])),
            !res.is_correct && res.chosen != null && h('p', { class: 'small muted' }, `Tu respuesta: ${q.options[res.chosen]}`),
            res.explanation && h('p', { class: 'small' }, res.explanation));
        })),
        h('div', { class: 'lesson-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => { answers.fill(null); i = 0; paintQuestion(); } }, 'Intentar de nuevo'),
          r.passed && nextButton()));
    } catch (err) {
      toast(err.message, 'error');
      i = 0; paintQuestion();
    }
  };

  if (!lesson.questions.length) return h('p', { class: 'muted' }, 'Este quiz todavía no tiene preguntas.');
  const start = h('div', { class: 'quiz-intro' },
    h('div', { class: 'big-emoji' }, '🧠'),
    h('p', {}, `${lesson.questions.length} preguntas · aprueba con 70%`),
    h('button', { class: 'btn btn-primary btn-lg', onclick: paintQuestion }, '¡Empezar!'));
  host.append(start);
  return host;
}
