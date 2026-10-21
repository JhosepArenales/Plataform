-- Academia Plataform · base de datos para Supabase
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO este archivo → Run.
-- Se puede volver a ejecutar: no borra datos.
--
-- Diseño de seguridad: el navegador NO puede leer ni escribir tablas directamente.
-- Todo pasa por funciones (app_*) que validan quién llama y qué puede hacer:
-- las respuestas correctas de los quizzes, los puntos y los permisos de
-- administración se controlan aquí, no en el navegador.

-- ---------------------------------------------------------------- Tablas

create table if not exists public.app_config (
  key text primary key,
  value text not null default ''
);
-- allowed_domain: solo estos correos pueden crear cuenta.
-- admin_emails: correos (separados por coma) que entran como administradores.
-- La primera cuenta creada también queda como administradora.
insert into public.app_config (key, value) values
  ('allowed_domain', 'plataform.com'),
  ('admin_emails', '')
on conflict (key) do nothing;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text not null default '🏢',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists areas_name_key on public.areas (lower(name));

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null default 'learner' check (role in ('admin', 'learner')),
  area_id uuid references public.areas (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Las lecciones se guardan dentro del curso (sin las respuestas correctas).
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null default 'General',
  cover_emoji text not null default '📘',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1,
  generated_by_ai boolean not null default false,
  area_ids uuid[] not null default '{}',
  lessons jsonb not null default '[]',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists courses_lessons_idx on public.courses using gin (lessons jsonb_path_ops);

-- Respuestas correctas y explicaciones: { "<id pregunta>": { "c": índice, "e": explicación } }
create table if not exists public.course_keys (
  course_id uuid primary key references public.courses (id) on delete cascade,
  keys jsonb not null default '{}'
);

create table if not exists public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  version integer not null,
  change_note text not null default '',
  snapshot jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists course_versions_course_idx on public.course_versions (course_id, version desc);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete set null,
  kind text not null,
  name text not null,
  extracted_text text not null,
  char_count integer not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, course_id, lesson_id)
);
create index if not exists progress_course_idx on public.progress (course_id);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id text not null,
  score integer not null,
  total integer not null,
  created_at timestamptz not null default now()
);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, lesson_id);

create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  points integer not null,
  created_at timestamptz not null default now()
);
create index if not exists xp_events_user_idx on public.xp_events (user_id);

-- Áreas iniciales (solo si todavía no hay ninguna).
insert into public.areas (name, icon)
select v.name, v.icon from (values
  ('Comercial', '💼'), ('Operaciones', '⚙️'), ('Atención al cliente', '🎧'),
  ('Tecnología', '💻'), ('Finanzas', '📊'), ('Recursos Humanos', '🤝')) as v (name, icon)
where not exists (select 1 from public.areas);

-- ---------------------------------------------------------------- Cuentas nuevas

-- Al crear una cuenta se crea su perfil. Rechaza correos de otros dominios.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_domain text := lower(coalesce((select value from app_config where key = 'allowed_domain'), ''));
  v_admins text[] := string_to_array(replace(lower(coalesce((select value from app_config where key = 'admin_emails'), '')), ' ', ''), ',');
  v_email text := lower(new.email);
begin
  if v_domain <> '' and v_email not like ('%@' || v_domain) then
    raise exception 'Solo se permiten correos @%', v_domain;
  end if;
  insert into profiles (id, email, name, role)
  values (
    new.id, v_email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(v_email, '@', 1)),
    case when not exists (select 1 from profiles) or v_email = any (v_admins) then 'admin' else 'learner' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- Ayudantes internos

-- Los errores usan códigos PTxxx: Supabase los devuelve con ese estado HTTP.
create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare r profiles;
begin
  select * into r from profiles where id = auth.uid() and active;
  if r.id is null then raise exception 'Tu sesión expiró. Vuelve a ingresar.' using errcode = 'PT401'; end if;
  return r;
end $$;

create or replace function public._admin() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare r profiles := _me();
begin
  if r.role <> 'admin' then raise exception 'Necesitas permisos de administrador.' using errcode = 'PT403'; end if;
  return r;
end $$;

create or replace function public._can_see(c public.courses, u public.profiles) returns boolean
language sql immutable as $$
  select u.role = 'admin' or (c.status = 'published' and (cardinality(c.area_ids) = 0 or u.area_id = any (c.area_ids)))
$$;

create or replace function public._areas_json(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'icon', a.icon) order by lower(a.name)), '[]')
  from areas a where a.id = any (p_ids)
$$;

create or replace function public._lesson_ids(p_lessons jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(l ->> 'id'), '{}') from jsonb_array_elements(p_lessons) l
$$;

-- Vuelve a unir las respuestas correctas a las preguntas (solo para administración).
create or replace function public._with_answers(p_lessons jsonb, p_keys jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(
    case when l ->> 'type' = 'quiz' then l || jsonb_build_object('questions', coalesce((
      select jsonb_agg(q || jsonb_build_object(
        'correct_index', (p_keys -> (q ->> 'id') ->> 'c')::int,
        'explanation', coalesce(p_keys -> (q ->> 'id') ->> 'e', '')) order by qo)
      from jsonb_array_elements(l -> 'questions') with ordinality as t (q, qo)), '[]'::jsonb))
    else l end order by lo), '[]')
  from jsonb_array_elements(p_lessons) with ordinality as t2 (l, lo)
$$;

create or replace function public._progress(p_user uuid, c public.courses) returns jsonb
language sql stable security definer set search_path = public as $$
  with ids as (select _lesson_ids(c.lessons) as all_ids),
  done as (select coalesce(array_agg(p.lesson_id order by p.completed_at), '{}') as d
           from progress p, ids where p.user_id = p_user and p.course_id = c.id and p.lesson_id = any (ids.all_ids))
  select jsonb_build_object(
    'done_lesson_ids', to_jsonb(done.d), 'done', cardinality(done.d), 'total', cardinality(ids.all_ids),
    'percent', case when cardinality(ids.all_ids) = 0 then 0 else round(100.0 * cardinality(done.d) / cardinality(ids.all_ids)) end)
  from ids, done
$$;

create or replace function public._find_lesson_course(p_lesson text, u public.profiles) returns public.courses
language plpgsql stable security definer set search_path = public as $$
declare c courses;
begin
  select * into c from courses where lessons @> jsonb_build_array(jsonb_build_object('id', p_lesson)) limit 1;
  if c.id is null or not _can_see(c, u) then raise exception 'Lección no encontrada.' using errcode = 'PT404'; end if;
  return c;
end $$;

-- Marca una lección como completada y entrega los puntos (una sola vez por lección).
create or replace function public._complete(p_user uuid, c public.courses, p_lesson text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gained int := 0;
  v_finished boolean := false;
  v_inserted int;
  v_progress jsonb;
begin
  insert into progress (user_id, course_id, lesson_id) values (p_user, c.id, p_lesson) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    insert into xp_events (user_id, reason, points) values (p_user, 'Lección completada', 10);
    v_gained := 10;
    v_progress := _progress(p_user, c);
    if (v_progress ->> 'done')::int = (v_progress ->> 'total')::int then
      insert into xp_events (user_id, reason, points) values (p_user, 'Curso completado: ' || c.title, 50);
      v_gained := v_gained + 50;
      v_finished := true;
    end if;
  end if;
  return jsonb_build_object('gained', v_gained, 'finished_course', v_finished, 'progress', _progress(p_user, c));
end $$;

-- ---------------------------------------------------------------- Funciones de la aplicación

create or replace function public.app_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); a areas;
begin
  select * into a from areas where id = u.area_id;
  return jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'area_id', a.id, 'area_name', a.name, 'area_icon', a.icon),
    'counts', jsonb_build_object(
      'xp', coalesce((select sum(points) from xp_events where user_id = u.id), 0),
      'lessons', (select count(*) from progress where user_id = u.id),
      'perfect', (select count(*) from quiz_attempts where user_id = u.id and score = total),
      'courses', (select count(*) from xp_events where user_id = u.id and reason like 'Curso completado%'),
      'games', (select count(*) from xp_events where user_id = u.id and reason like 'Juego en vivo%'),
      'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, reason, points, created_at from xp_events where user_id = u.id order by created_at desc limit 8) x), '[]')));
end $$;

create or replace function public.app_set_my_area(p_area uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); a areas;
begin
  select * into a from areas where id = p_area and active;
  if a.id is null then raise exception 'Elige un área válida.' using errcode = 'PT400'; end if;
  update profiles set area_id = a.id where id = u.id;
  return jsonb_build_object('ok', true, 'area', jsonb_build_object('id', a.id, 'name', a.name, 'icon', a.icon));
end $$;

create or replace function public.app_areas(p_all boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'icon', a.icon, 'active', a.active, 'created_at', a.created_at,
      'people', (select count(*) from profiles p where p.active and p.area_id = a.id),
      'courses', (select count(*) from courses c where c.status = 'published' and a.id = any (c.area_ids)))
      order by lower(a.name))
    from areas a where a.active or (p_all and u.role = 'admin')), '[]');
end $$;

create or replace function public.app_area_save(p_id uuid default null, p_name text default null, p_icon text default null, p_active boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); v_name text; r areas;
begin
  if p_name is not null or p_id is null then
    v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
    if length(v_name) < 2 or length(v_name) > 40 then
      raise exception 'El nombre del área debe tener entre 2 y 40 caracteres.' using errcode = 'PT400';
    end if;
    if exists (select 1 from areas where lower(name) = lower(v_name) and id is distinct from p_id) then
      raise exception 'Ya existe un área llamada "%".', v_name using errcode = 'PT409';
    end if;
  end if;
  if p_id is null then
    insert into areas (name, icon) values (v_name, left(coalesce(nullif(p_icon, ''), '🏢'), 8)) returning * into r;
  else
    update areas set
      name = coalesce(v_name, name),
      icon = case when p_icon is null then icon else left(coalesce(nullif(p_icon, ''), '🏢'), 8) end,
      active = coalesce(p_active, active)
    where id = p_id returning * into r;
    if r.id is null then raise exception 'Área no encontrada.' using errcode = 'PT404'; end if;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.app_courses(p_all boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); v_all boolean := p_all and u.role = 'admin';
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', c.title, 'description', c.description, 'category', c.category,
      'cover_emoji', c.cover_emoji, 'status', c.status, 'version', c.version,
      'generated_by_ai', c.generated_by_ai, 'area_ids', to_jsonb(c.area_ids), 'areas', _areas_json(c.area_ids),
      'created_at', c.created_at, 'updated_at', c.updated_at,
      'lesson_count', jsonb_array_length(c.lessons),
      'total_min', (select coalesce(sum((l ->> 'duration_min')::int), 0) from jsonb_array_elements(c.lessons) l),
      'done_count', (select count(*) from progress p where p.user_id = u.id and p.course_id = c.id and p.lesson_id = any (_lesson_ids(c.lessons))))
      order by c.updated_at desc)
    from courses c
    where case when v_all then c.status <> 'archived'
               else c.status = 'published' and (cardinality(c.area_ids) = 0 or u.area_id = any (c.area_ids)) end), '[]');
end $$;

create or replace function public.app_course(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); c courses; v_admin boolean := u.role = 'admin';
begin
  select * into c from courses where id = p_id;
  if c.id is null or not _can_see(c, u) then raise exception 'Curso no encontrado.' using errcode = 'PT404'; end if;
  return jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description, 'category', c.category,
    'cover_emoji', c.cover_emoji, 'status', c.status, 'version', c.version,
    'generated_by_ai', c.generated_by_ai, 'created_at', c.created_at, 'updated_at', c.updated_at,
    'area_ids', to_jsonb(c.area_ids), 'areas', _areas_json(c.area_ids),
    'lessons', case when v_admin then _with_answers(c.lessons, coalesce((select keys from course_keys where course_id = c.id), '{}')) else c.lessons end,
    'sources', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name,
      'char_count', s.char_count, 'created_at', s.created_at) order by s.created_at) from sources s where s.course_id = c.id), '[]') else '[]' end,
    'progress', _progress(u.id, c));
end $$;

-- Crea (p_id nulo) o actualiza un curso. p_course trae las lecciones con sus ids y
-- las preguntas con respuesta correcta; aquí se separan las respuestas del contenido.
create or replace function public.app_course_save(p_id uuid, p_course jsonb, p_note text default null, p_generated boolean default false, p_source_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles := _admin();
  c courses;
  v_area_ids uuid[];
  v_lessons jsonb;
  v_keys jsonb;
  v_ids text[];
begin
  if coalesce(trim(p_course ->> 'title'), '') = '' then
    raise exception 'El curso necesita un título.' using errcode = 'PT400';
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_area_ids
  from jsonb_array_elements_text(coalesce(p_course -> 'area_ids', '[]')) x;
  if exists (select 1 from unnest(v_area_ids) i where not exists (select 1 from areas a where a.id = i)) then
    raise exception 'Una de las áreas elegidas no existe.' using errcode = 'PT400';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_course -> 'lessons', '[]')) l
             where coalesce(l ->> 'id', '') = '' or l ->> 'type' not in ('video', 'reading', 'quiz') or coalesce(trim(l ->> 'title'), '') = '') then
    raise exception 'Cada lección necesita id, tipo y título.' using errcode = 'PT400';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_course -> 'lessons', '[]')) l, jsonb_array_elements(coalesce(l -> 'questions', '[]')) q
             where coalesce(q ->> 'id', '') = '' or jsonb_array_length(coalesce(q -> 'options', '[]')) not between 2 and 4
               or (q ->> 'correct_index')::int not between 0 and jsonb_array_length(q -> 'options') - 1) then
    raise exception 'Cada pregunta necesita entre 2 y 4 opciones y una respuesta correcta.' using errcode = 'PT400';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l ->> 'id', 'type', l ->> 'type', 'title', trim(l ->> 'title'), 'content', coalesce(l ->> 'content', ''),
      'video_url', case when l ->> 'type' = 'video' then nullif(l ->> 'video_url', '') end,
      'duration_min', greatest(1, least(600, coalesce((l ->> 'duration_min')::numeric, 5)::int)),
      'position', lo - 1, 'updated_at', now(),
      'questions', case when l ->> 'type' = 'quiz' then coalesce((
        select jsonb_agg(jsonb_build_object('id', q ->> 'id', 'prompt', q ->> 'prompt', 'options', q -> 'options',
          'time_limit_sec', greatest(5, least(120, coalesce((q ->> 'time_limit_sec')::numeric, 20)::int))) order by qo)
        from jsonb_array_elements(coalesce(l -> 'questions', '[]')) with ordinality as t (q, qo)), '[]') else '[]' end)
      order by lo), '[]')
  into v_lessons
  from jsonb_array_elements(coalesce(p_course -> 'lessons', '[]')) with ordinality as t2 (l, lo);

  select coalesce(jsonb_object_agg(q ->> 'id', jsonb_build_object('c', (q ->> 'correct_index')::int, 'e', coalesce(q ->> 'explanation', ''))), '{}')
  into v_keys
  from jsonb_array_elements(v_lessons) vl
  join jsonb_array_elements(coalesce(p_course -> 'lessons', '[]')) l on l ->> 'id' = vl ->> 'id'
  cross join jsonb_array_elements(case when l ->> 'type' = 'quiz' then coalesce(l -> 'questions', '[]') else '[]' end) q;

  v_ids := _lesson_ids(v_lessons);
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Hay lecciones repetidas en el curso.' using errcode = 'PT400';
  end if;
  if exists (select 1 from courses o, jsonb_array_elements(o.lessons) ol
             where o.id is distinct from p_id and ol ->> 'id' = any (v_ids)) then
    raise exception 'Una de las lecciones ya pertenece a otro curso.' using errcode = 'PT400';
  end if;

  if p_id is null then
    insert into courses (title, description, category, cover_emoji, area_ids, lessons, generated_by_ai, created_by)
    values (trim(p_course ->> 'title'), coalesce(p_course ->> 'description', ''),
      coalesce(nullif(trim(p_course ->> 'category'), ''), 'General'), coalesce(nullif(p_course ->> 'cover_emoji', ''), '📘'),
      v_area_ids, v_lessons, coalesce(p_generated, false), u.id)
    returning * into c;
  else
    select * into c from courses where id = p_id for update;
    if c.id is null then raise exception 'Curso no encontrado.' using errcode = 'PT404'; end if;
    -- El progreso de las lecciones eliminadas se descarta; el de las conservadas se mantiene.
    delete from progress where course_id = c.id and not (lesson_id = any (v_ids));
    delete from quiz_attempts where course_id = c.id and not (lesson_id = any (v_ids));
    update courses set
      title = trim(p_course ->> 'title'), description = coalesce(p_course ->> 'description', ''),
      category = coalesce(nullif(trim(p_course ->> 'category'), ''), 'General'),
      cover_emoji = coalesce(nullif(p_course ->> 'cover_emoji', ''), '📘'),
      area_ids = v_area_ids, lessons = v_lessons, version = version + 1, updated_at = now()
    where id = c.id returning * into c;
  end if;

  insert into course_keys (course_id, keys) values (c.id, v_keys)
  on conflict (course_id) do update set keys = excluded.keys;
  update sources set course_id = c.id where id = any (coalesce(p_source_ids, '{}'));
  insert into course_versions (course_id, version, change_note, snapshot, created_by)
  values (c.id, c.version,
    coalesce(nullif(trim(p_note), ''), case when p_id is not null then 'Edición manual'
      when p_generated then 'Versión inicial generada con IA' else 'Versión inicial' end),
    jsonb_build_object('title', c.title, 'description', c.description, 'category', c.category, 'cover_emoji', c.cover_emoji,
      'area_ids', to_jsonb(c.area_ids), 'lessons', _with_answers(c.lessons, v_keys)),
    u.id);
  return app_course(c.id);
end $$;

create or replace function public.app_course_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); c courses;
begin
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'Estado inválido.' using errcode = 'PT400';
  end if;
  select * into c from courses where id = p_id;
  if c.id is null then raise exception 'Curso no encontrado.' using errcode = 'PT404'; end if;
  if p_status = 'published' and jsonb_array_length(c.lessons) = 0 then
    raise exception 'Agrega al menos una lección antes de publicar.' using errcode = 'PT400';
  end if;
  update courses set status = p_status, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

create or replace function public.app_course_versions(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'change_note', v.change_note,
      'created_at', v.created_at, 'author', p.name) order by v.version desc)
    from course_versions v left join profiles p on p.id = v.created_by where v.course_id = p_id), '[]');
end $$;

create or replace function public.app_course_restore(p_course uuid, p_version uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); v course_versions;
begin
  select * into v from course_versions where id = p_version and course_id = p_course;
  if v.id is null then raise exception 'Versión no encontrada.' using errcode = 'PT404'; end if;
  return app_course_save(p_course, v.snapshot, format('Restaurada la versión %s', v.version));
end $$;

create or replace function public.app_complete_lesson(p_lesson text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me();
begin
  return _complete(u.id, _find_lesson_course(p_lesson, u), p_lesson);
end $$;

-- Corrige el quiz en la base de datos: el navegador nunca recibe las respuestas antes.
create or replace function public.app_submit_quiz(p_lesson text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles := _me();
  c courses := _find_lesson_course(p_lesson, u);
  v_lesson jsonb;
  v_keys jsonb;
  v_results jsonb;
  v_score int;
  v_total int;
  v_prev int;
  v_gained int := 0;
  v_passed boolean;
  v_completion jsonb;
begin
  select l into v_lesson from jsonb_array_elements(c.lessons) l where l ->> 'id' = p_lesson;
  v_total := jsonb_array_length(coalesce(v_lesson -> 'questions', '[]'));
  if v_lesson ->> 'type' <> 'quiz' or v_total = 0 then
    raise exception 'Este quiz no tiene preguntas.' using errcode = 'PT400';
  end if;
  v_keys := coalesce((select keys from course_keys where course_id = c.id), '{}');

  select jsonb_agg(jsonb_build_object('question_id', q ->> 'id', 'chosen', to_jsonb(x.chosen), 'correct_index', x.correct,
      'is_correct', coalesce(x.chosen = x.correct, false), 'explanation', coalesce(v_keys -> (q ->> 'id') ->> 'e', '')) order by qo)
  into v_results
  from jsonb_array_elements(v_lesson -> 'questions') with ordinality as t (q, qo)
  cross join lateral (select
    case when jsonb_typeof(p_answers -> (qo::int - 1)) = 'number' then (p_answers ->> (qo::int - 1))::numeric::int end as chosen,
    (v_keys -> (q ->> 'id') ->> 'c')::int as correct) x;

  select count(*) into v_score from jsonb_array_elements(v_results) r where (r ->> 'is_correct')::boolean;
  select coalesce(max(score), 0) into v_prev from quiz_attempts where user_id = u.id and course_id = c.id and lesson_id = p_lesson;
  insert into quiz_attempts (user_id, course_id, lesson_id, score, total) values (u.id, c.id, p_lesson, v_score, v_total);

  if v_score > v_prev then
    insert into xp_events (user_id, reason, points) values (u.id, 'Respuestas correctas en quiz', (v_score - v_prev) * 5);
    v_gained := (v_score - v_prev) * 5;
  end if;
  if v_score = v_total and v_prev < v_score then
    insert into xp_events (user_id, reason, points) values (u.id, 'Quiz perfecto', 20);
    v_gained := v_gained + 20;
  end if;
  v_passed := v_score::numeric / v_total >= 0.7;
  if v_passed then v_completion := _complete(u.id, c, p_lesson); end if;

  return jsonb_build_object('score', v_score, 'total', v_total, 'passed', v_passed, 'results', v_results,
    'gained', v_gained + coalesce((v_completion ->> 'gained')::int, 0),
    'finished_course', coalesce((v_completion ->> 'finished_course')::boolean, false));
end $$;

create or replace function public.app_leaderboard(p_area_scope boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me();
begin
  return coalesce((select jsonb_agg(x order by x.xp desc, x.name) from (
    select p.id, p.name, coalesce((select sum(points) from xp_events e where e.user_id = p.id), 0) as xp
    from profiles p
    where p.active and (not p_area_scope or u.area_id is null or p.area_id = u.area_id)
    order by xp desc, p.name limit 20) x), '[]');
end $$;

create or replace function public.app_admin_metrics() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); v_week timestamptz := now() - interval '7 days';
begin
  return jsonb_build_object(
    'learners', (select count(*) from profiles where active and role = 'learner'),
    'active_week', (select count(distinct user_id) from xp_events where created_at > v_week),
    'people_without_area', (select count(*) from profiles where active and area_id is null),
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'cover_emoji', c.cover_emoji, 'status', c.status, 'version', c.version,
        'lessons', s.n, 'started', s.started, 'completed', s.completed, 'avg_quiz', s.avg_quiz,
        'completion_rate', case when s.started = 0 then 0 else round(100.0 * s.completed / s.started) end)
        order by c.updated_at desc)
      from courses c
      cross join lateral (
        select jsonb_array_length(c.lessons) as n,
          (select count(distinct p.user_id) from progress p where p.course_id = c.id and p.lesson_id = any (_lesson_ids(c.lessons))) as started,
          (select count(*) from (select p.user_id from progress p where p.course_id = c.id and p.lesson_id = any (_lesson_ids(c.lessons))
             group by p.user_id having count(*) = jsonb_array_length(c.lessons)) g where jsonb_array_length(c.lessons) > 0) as completed,
          (select round(avg(100.0 * a.score / a.total)) from quiz_attempts a where a.course_id = c.id and a.lesson_id = any (_lesson_ids(c.lessons))) as avg_quiz
      ) s
      where c.status <> 'archived'), '[]'),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'icon', a.icon, 'people', x.people, 'active_week', x.active_week,
        'assigned_lessons', x.assigned, 'avg_progress', x.avg_progress) order by lower(a.name))
      from areas a
      cross join lateral (
        with assigned as (
          select distinct l ->> 'id' as id from courses c, jsonb_array_elements(c.lessons) l
          where c.status = 'published' and (cardinality(c.area_ids) = 0 or a.id = any (c.area_ids))),
        ppl as (select p.id from profiles p where p.active and p.area_id = a.id),
        per_person as (
          select pp.id, (select count(*) from progress pr where pr.user_id = pp.id and pr.lesson_id in (select id from assigned)) as done
          from ppl pp)
        select (select count(*) from ppl) as people,
          (select count(distinct e.user_id) from xp_events e where e.created_at > v_week and e.user_id in (select id from ppl)) as active_week,
          (select count(*) from assigned) as assigned,
          (select case when count(*) = 0 then null
                       when (select count(*) from assigned) = 0 then 0
                       else round(100.0 * avg(done) / (select count(*) from assigned)) end from per_person) as avg_progress
      ) x
      where a.active), '[]'));
end $$;

create or replace function public.app_admin_users() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'name', p.name, 'role', p.role, 'area_id', p.area_id,
      'area_name', a.name, 'area_icon', a.icon, 'active', p.active, 'created_at', p.created_at,
      'xp', coalesce((select sum(points) from xp_events e where e.user_id = p.id), 0),
      'lessons_done', (select count(*) from progress pr where pr.user_id = p.id)) order by p.created_at)
    from profiles p left join areas a on a.id = p.area_id), '[]');
end $$;

create or replace function public.app_admin_set_area(p_user uuid, p_area uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  if p_area is not null and not exists (select 1 from areas where id = p_area and active) then
    raise exception 'Elige un área válida.' using errcode = 'PT400';
  end if;
  update profiles set area_id = p_area where id = p_user;
  if not found then raise exception 'Persona no encontrada.' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_admin_set_role(p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  if p_role is null or p_role not in ('admin', 'learner') then raise exception 'Rol inválido.' using errcode = 'PT400'; end if;
  if p_user = u.id and p_role <> 'admin' then
    raise exception 'No puedes quitarte tu propio rol de administrador.' using errcode = 'PT400';
  end if;
  update profiles set role = p_role where id = p_user;
  if not found then raise exception 'Persona no encontrada.' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_source_save(p_kind text, p_name text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); s sources;
begin
  if length(coalesce(p_text, '')) < 40 then
    raise exception 'La fuente no tiene texto suficiente.' using errcode = 'PT422';
  end if;
  insert into sources (kind, name, extracted_text, char_count, created_by)
  values (coalesce(p_kind, 'texto'), left(coalesce(nullif(trim(p_name), ''), 'Texto'), 200), left(p_text, 400000), least(length(p_text), 400000), u.id)
  returning * into s;
  return jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'char_count', s.char_count);
end $$;

create or replace function public.app_sources_text(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'extracted_text', s.extracted_text)
      order by array_position(p_ids, s.id))
    from sources s where s.id = any (p_ids)), '[]');
end $$;

-- ---------------------------------------------------------------- Permisos

-- Tablas cerradas al navegador: sin políticas RLS, nadie las lee directamente.
alter table public.app_config enable row level security;
alter table public.areas enable row level security;
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_keys enable row level security;
alter table public.course_versions enable row level security;
alter table public.sources enable row level security;
alter table public.progress enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.xp_events enable row level security;
revoke all on all tables in schema public from anon, authenticated;

-- Solo las funciones app_* quedan disponibles, y solo para personas con sesión.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'app\_%' or p.proname like '\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'app\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
