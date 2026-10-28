// Backend de la Academia sobre Supabase. Atiende las mismas rutas /api/* que usa
// la interfaz y las traduce a las funciones de supabase/schema.sql, donde se
// validan permisos, respuestas correctas y puntos. Aquí solo queda lo que el
// navegador hace mejor: leer archivos y armar el borrador básico de un curso.

const sb = window.supabase.createClient(ACADEMIA_CONFIG.url, ACADEMIA_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = () => crypto.randomUUID();

// La interfaz decide si hay sesión mirando su token: se alinea con la sesión guardada de Supabase.
try {
  if (Object.keys(window.localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))) window.localStorage.setItem('academia.token', 'supabase');
} catch { /* sin almacenamiento: se pedirá ingresar */ }

async function rpc(name, args = {}) {
  let res;
  try { res = await sb.rpc(name, args); } catch { throw httpError(503, 'Sin conexión con la base de datos. Revisa tu internet.'); }
  const { data, error } = res;
  if (!error) return data;
  const code = error.code ?? '';
  if (/^PT\d{3}$/.test(code)) throw httpError(Number(code.slice(2)), error.message);
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303') throw httpError(401, 'Tu sesión expiró. Vuelve a ingresar.');
  if (code === 'PGRST202' || code === '42883') throw httpError(500, 'La base de datos no está configurada: ejecuta supabase/schema.sql en Supabase.');
  if (!code) throw httpError(503, 'Sin conexión con la base de datos. Revisa tu internet.');
  console.error(error);
  throw httpError(500, 'Ocurrió un error inesperado. Intenta de nuevo.');
}

// Crea o actualiza un curso: valida con las mismas reglas de siempre y asigna ids
// (las lecciones conservan el suyo para no perder el progreso de las personas).
function saveCourse(id, tree, { note = null, sourceIds = [], generated = false } = {}) {
  const data = normalizeTree(tree);
  const course = {
    ...data,
    lessons: data.lessons.map((l) => ({ ...l, id: l.id || uid(), questions: l.questions.map((q) => ({ ...q, id: uid() })) })),
  };
  return rpc('app_course_save', { p_id: id, p_course: course, p_note: note, p_generated: generated, p_source_ids: sourceIds.filter((s) => UUID_RE.test(s)) });
}

const withLevel = (rows) => rows.map((r) => ({ ...r, level: levelFor(r.xp).name }));

async function route(method, path, body) {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  const m = (re) => pathname.match(re);
  const idFrom = (r, i = 1) => { if (!UUID_RE.test(r[i])) throw httpError(404, 'No encontrado.'); return r[i]; };
  let r;

  if (method === 'POST' && pathname === '/api/auth/logout') { await sb.auth.signOut(); return { ok: true }; }
  if (method === 'GET' && pathname === '/api/me') {
    const me = await rpc('app_me');
    return { user: me.user, stats: statsFrom(me.counts) };
  }
  if (method === 'POST' && pathname === '/api/me/area') {
    if (!UUID_RE.test(String(body?.area_id ?? ''))) throw httpError(400, 'Elige un área válida.');
    return rpc('app_set_my_area', { p_area: body.area_id });
  }
  if (method === 'GET' && pathname === '/api/areas') return rpc('app_areas', { p_all: params.get('all') === '1' });
  if (method === 'POST' && pathname === '/api/areas') return rpc('app_area_save', { p_name: String(body?.name ?? ''), p_icon: body?.icon ?? null });
  if (method === 'PUT' && (r = m(/^\/api\/areas\/([\w-]+)$/))) {
    return rpc('app_area_save', { p_id: idFrom(r), p_name: body?.name ?? null, p_icon: body?.icon ?? null, p_active: body?.active ?? null });
  }
  if (method === 'GET' && pathname === '/api/health') return { ok: true };

  if (method === 'GET' && pathname === '/api/courses') return rpc('app_courses', { p_all: params.get('all') === '1' });
  if ((r = m(/^\/api\/courses\/([\w-]+)$/))) {
    if (method === 'GET') return rpc('app_course', { p_id: idFrom(r) });
    if (method === 'PUT') return saveCourse(idFrom(r), body, { note: String(body?.change_note ?? '').trim() || null, sourceIds: body?.source_ids ?? [] });
  }
  if (method === 'POST' && pathname === '/api/courses') return saveCourse(null, body, { sourceIds: body?.source_ids ?? [], generated: !!body?.generated_by_ai });
  if (method === 'POST' && (r = m(/^\/api\/courses\/([\w-]+)\/status$/))) return rpc('app_course_status', { p_id: idFrom(r), p_status: String(body?.status ?? '') });
  if (method === 'GET' && (r = m(/^\/api\/courses\/([\w-]+)\/versions$/))) return rpc('app_course_versions', { p_id: idFrom(r) });
  if (method === 'POST' && (r = m(/^\/api\/courses\/([\w-]+)\/versions\/([\w-]+)\/restore$/))) {
    return rpc('app_course_restore', { p_course: idFrom(r), p_version: idFrom(r, 2) });
  }
  if (method === 'POST' && (r = m(/^\/api\/lessons\/([\w-]+)\/complete$/))) return rpc('app_complete_lesson', { p_lesson: r[1] });
  if (method === 'POST' && (r = m(/^\/api\/lessons\/([\w-]+)\/quiz$/))) {
    const answers = Array.isArray(body?.answers) ? body.answers.map((a) => (a === null ? null : Number(a))) : [];
    return rpc('app_submit_quiz', { p_lesson: r[1], p_answers: answers });
  }
  if (method === 'GET' && pathname === '/api/leaderboard') return withLevel(await rpc('app_leaderboard', { p_area_scope: params.get('scope') === 'area' }));

  if (method === 'POST' && pathname === '/api/sources/url') {
    throw httpError(400, 'El navegador no puede leer páginas web de otros sitios. Copia el texto de la página y pégalo abajo con "Agregar texto".');
  }
  if (method === 'POST' && pathname === '/api/sources/text') {
    const ex = finishExtraction('texto', String(body?.name ?? '') || 'Texto pegado', String(body?.text ?? ''));
    const saved = await rpc('app_source_save', { p_kind: ex.kind, p_name: ex.name, p_text: ex.text });
    return { ...saved, truncated: ex.truncated, preview: ex.text.slice(0, 400) };
  }
  if (method === 'POST' && pathname === '/api/sources/files') {
    const files = body instanceof FormData ? body.getAll('files') : [];
    if (!files.length) throw httpError(400, 'Adjunta al menos un archivo.');
    const results = [];
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) { results.push({ name: f.name, error: 'El archivo supera 50 MB.' }); continue; }
      try {
        const ex = await extractFile(f);
        const saved = await rpc('app_source_save', { p_kind: ex.kind, p_name: ex.name, p_text: ex.text });
        results.push({ ...saved, truncated: ex.truncated, preview: ex.text.slice(0, 400) });
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw err;
        results.push({ name: f.name, error: err.message || 'No se pudo leer el archivo.' });
      }
    }
    return results;
  }

  if (method === 'GET' && pathname === '/api/ai/status') {
    return { available: false, hint: 'Se generará un borrador básico (secciones del documento + preguntas de completar la frase). Revísalo y mejóralo en el editor antes de publicarlo.' };
  }
  if (method === 'POST' && pathname === '/api/ai/generate') {
    const ids = (body?.source_ids ?? []).filter((s) => UUID_RE.test(s));
    const sources = await rpc('app_sources_text', { p_ids: ids });
    if (!sources.length) throw httpError(400, 'Agrega al menos una fuente.');
    const lessonCount = Math.min(15, Math.max(2, Number(body?.lesson_count) || 6));
    const draft = basicCourseFromSources(sources, lessonCount);
    const course = await saveCourse(null, { ...draft, area_ids: body?.area_ids ?? [] }, { sourceIds: ids });
    return { course, mode: 'basic', summary: draft.change_summary, truncated: false };
  }
  if (method === 'POST' && m(/^\/api\/courses\/([\w-]+)\/ai-update$/)) {
    throw httpError(503, 'Actualizar con IA estará disponible cuando se active la IA. Por ahora edita el curso manualmente.');
  }

  if (method === 'GET' && pathname === '/api/admin/metrics') return rpc('app_admin_metrics');
  if (method === 'GET' && pathname === '/api/admin/users') return rpc('app_admin_users');
  if (method === 'POST' && (r = m(/^\/api\/admin\/users\/([\w-]+)\/area$/))) {
    const area = body?.area_id ? String(body.area_id) : null;
    if (area && !UUID_RE.test(area)) throw httpError(400, 'Elige un área válida.');
    return rpc('app_admin_set_area', { p_user: idFrom(r), p_area: area });
  }
  if (method === 'POST' && (r = m(/^\/api\/admin\/users\/([\w-]+)\/role$/))) return rpc('app_admin_set_role', { p_user: idFrom(r), p_role: String(body?.role ?? '') });

  if (pathname.startsWith('/api/ia/')) return routeIa(method, pathname, params, body);
  if (method === 'POST' && (r = m(/^\/api\/admin\/users\/([\w-]+)\/org-role$/))) {
    return rpc('app_admin_set_org_role', { p_user: idFrom(r), p_role: body?.org_role || null });
  }

  // El juego en vivo entre celulares llega en la siguiente etapa.
  if (method === 'GET' && pathname === '/api/games') return [];
  if (pathname.startsWith('/api/games')) throw httpError(503, 'El juego en vivo estará disponible en la próxima etapa de la Academia.');
  throw httpError(404, 'Ruta no encontrada.');
}

// ---------- Formación IA por niveles ----------
async function routeIa(method, pathname, params, body) {
  const uuidOr = (v, status = 404) => { if (!UUID_RE.test(String(v ?? ''))) throw httpError(status, 'No encontrado.'); return v; };
  const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
  let r;
  const m = (re) => pathname.match(re);
  if (method === 'GET' && pathname === '/api/ia/me') return rpc('app_ia_me');
  if (method === 'GET' && pathname === '/api/ia/current') return rpc('app_ia_current');
  if (method === 'POST' && pathname === '/api/ia/start') return rpc('app_ia_start');
  if (method === 'POST' && pathname === '/api/ia/answer') {
    return rpc('app_ia_answer', { p_attempt: uuidOr(body?.attempt_id), p_position: Number(body?.position), p_choice: Number(body?.choice) });
  }
  if (method === 'GET' && pathname === '/api/ia/heatmap') {
    const area = params.get('area');
    const role = params.get('role');
    return rpc('app_ia_heatmap', {
      p_area: area && UUID_RE.test(area) ? area : null,
      p_role: ['director', 'lider', 'analista'].includes(role) ? role : null,
      p_from: dateOrNull(params.get('from')), p_to: dateOrNull(params.get('to')),
    });
  }
  if (method === 'POST' && pathname === '/api/ia/evidences') {
    return rpc('app_ia_evidence_save', { p_kind: body?.kind, p_title: body?.title, p_hours: Number(body?.hours_month) || 0, p_quality: body?.quality ?? '', p_link: body?.link ?? '' });
  }
  if (method === 'GET' && pathname === '/api/ia/evidences') return rpc('app_ia_evidences', { p_status: params.get('status') || null });
  if (method === 'POST' && (r = m(/^\/api\/ia\/evidences\/([\w-]+)\/review$/))) {
    return rpc('app_ia_evidence_review', { p_id: uuidOr(r[1]), p_status: body?.status, p_note: body?.note ?? '' });
  }
  if (method === 'POST' && pathname === '/api/ia/mentorships') return rpc('app_ia_mentor_request', { p_note: body?.note ?? '' });
  if (method === 'GET' && pathname === '/api/ia/mentorships') return rpc('app_ia_mentorships');
  if (method === 'POST' && (r = m(/^\/api\/ia\/mentorships\/([\w-]+)\/assign$/))) {
    return rpc('app_ia_mentor_assign', { p_id: uuidOr(r[1]), p_mentor: uuidOr(body?.mentor_id, 400) });
  }
  if (method === 'POST' && (r = m(/^\/api\/ia\/mentorships\/([\w-]+)\/close$/))) return rpc('app_ia_mentor_close', { p_id: uuidOr(r[1]) });
  if (method === 'GET' && pathname === '/api/ia/sessions') return rpc('app_ia_sessions');
  if (method === 'POST' && pathname === '/api/ia/sessions') {
    return rpc('app_ia_session_save', { p_id: body?.id && UUID_RE.test(body.id) ? body.id : null, p_kind: body?.kind, p_title: body?.title, p_starts_at: body?.starts_at || null, p_description: body?.description ?? '' });
  }
  if (method === 'DELETE' && (r = m(/^\/api\/ia\/sessions\/([\w-]+)$/))) return rpc('app_ia_session_delete', { p_id: uuidOr(r[1]) });
  if (method === 'POST' && (r = m(/^\/api\/ia\/sessions\/([\w-]+)\/signup$/))) return rpc('app_ia_session_signup', { p_session: uuidOr(r[1]), p_pitch: body?.pitch ?? '' });
  if (method === 'POST' && (r = m(/^\/api\/ia\/sessions\/([\w-]+)\/feedback$/))) {
    return rpc('app_ia_session_feedback', { p_session: uuidOr(r[1]), p_rating: Number(body?.rating), p_comment: body?.comment ?? '' });
  }
  if (method === 'GET' && pathname === '/api/ia/questions') return rpc('app_ia_questions');
  if (method === 'POST' && pathname === '/api/ia/questions') {
    return rpc('app_ia_question_save', {
      p_id: body?.id && UUID_RE.test(body.id) ? body.id : null, p_difficulty: body?.difficulty, p_prompt: body?.prompt ?? '',
      p_options: Array.isArray(body?.options) ? body.options.map((o) => String(o).trim()).filter(Boolean) : [],
      p_correct: Number(body?.correct_index), p_explanation: body?.explanation ?? '', p_active: body?.active !== false,
    });
  }
  if (method === 'GET' && pathname === '/api/ia/kpis') return rpc('app_ia_kpis');
  if (method === 'POST' && pathname === '/api/ia/total') return rpc('app_ia_set_total', { p_total: Number(body?.total) });
  if (method === 'POST' && pathname === '/api/ia/demo-setup') return rpc('app_ia_demo_setup');
  throw httpError(404, 'Ruta no encontrada.');
}

// ---------- Reemplazo de fetch para las rutas /api ----------
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  let body = init.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = undefined; } }
  try {
    const data = await route(method, url, body);
    return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    const message = status === 500 && !err.status ? 'Ocurrió un error inesperado. Intenta de nuevo.' : err.message;
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
  }
};
