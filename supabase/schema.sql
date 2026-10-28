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
  ('admin_emails', ''),
  ('total_personal', '0')
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
-- Formación IA: rol en la organización (lo asigna la administración) y marca de usuario de prueba.
alter table public.profiles add column if not exists org_role text check (org_role in ('director', 'lider', 'analista'));
alter table public.profiles add column if not exists is_demo boolean not null default false;

-- Entrada sin capa de ingreso: cada navegador tiene una llave propia (se guarda solo
-- su huella SHA-256). Las personas que entran así no tienen cuenta de Supabase Auth,
-- por eso el perfil ya no exige una fila en auth.users.
alter table public.profiles drop constraint if exists profiles_id_fkey;
create table if not exists public.app_devices (
  token_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
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
-- Rol inicial: la primera persona y los correos de admin_emails entran como administradores.
create or replace function public._initial_role(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from profiles)
    or lower(p_email) = any (string_to_array(replace(lower(coalesce((select value from app_config where key = 'admin_emails'), '')), ' ', ''), ','))
    then 'admin' else 'learner' end
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_domain text := lower(coalesce((select value from app_config where key = 'allowed_domain'), ''));
  v_email text := lower(new.email);
begin
  if v_domain <> '' and v_email not like ('%@' || v_domain) then
    raise exception 'Solo se permiten correos @%', v_domain;
  end if;
  insert into profiles (id, email, name, role)
  values (new.id, v_email, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(v_email, '@', 1)), _initial_role(v_email));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- Ayudantes internos

-- Los errores usan códigos PTxxx: Supabase los devuelve con ese estado HTTP.
-- Quién llama: la sesión de Supabase Auth (cuentas con contraseña) o, si no hay,
-- la llave del navegador que llega en el encabezado x-academia-device.
create or replace function public._uid() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid(), (
    select d.user_id from app_devices d
    where d.token_hash = encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-academia-device', ''), 'UTF8')), 'hex')
      and length(coalesce(current_setting('request.headers', true)::json ->> 'x-academia-device', '')) >= 32))
$$;

create or replace function public._me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare r profiles;
begin
  select * into r from profiles where id = _uid() and active;
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
      'area_id', a.id, 'area_name', a.name, 'area_icon', a.icon, 'org_role', u.org_role, 'ia_level', _ia_level(u.id)),
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
      'org_role', p.org_role, 'ia_level', _ia_level(p.id), 'is_demo', p.is_demo,
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

-- ================================================================ Formación IA por niveles
-- Examen IA First (diagnóstico), niveles Explorador / Practicante / Constructor,
-- mapa de calor, rutas, evidencias, mentorías, Demo Days e indicadores.
-- Reglas de privacidad: el resultado individual lo ven solo la persona y la
-- administración; los directores ven datos agregados de su área.

create table if not exists public.ia_questions (
  id uuid primary key default gen_random_uuid(),
  difficulty text not null check (difficulty in ('facil', 'media', 'dificil')),
  prompt text not null,
  options jsonb not null,
  correct_index integer not null,
  explanation text not null default '',
  active boolean not null default true,
  draft boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ia_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempt_no integer not null,
  area_id uuid references public.areas (id) on delete set null,
  org_role text,
  status text not null default 'en_curso' check (status in ('en_curso', 'terminado')),
  score integer,
  level text check (level in ('explorador', 'practicante', 'constructor')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, attempt_no)
);
create index if not exists ia_attempts_user_idx on public.ia_attempts (user_id, attempt_no);

-- Cada pregunta del intento guarda una copia de lo que se mostró (enunciado y
-- opciones en el orden sorteado) y la hora de entrega: el tiempo se controla aquí.
create table if not exists public.ia_attempt_items (
  attempt_id uuid not null references public.ia_attempts (id) on delete cascade,
  position integer not null,
  question_id uuid references public.ia_questions (id) on delete set null,
  difficulty text not null,
  points integer not null,
  prompt text not null,
  options jsonb not null,
  correct_shown integer not null,
  served_at timestamptz,
  answered_at timestamptz,
  chosen_shown integer,
  earned integer not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente', 'respondida', 'sin_respuesta')),
  primary key (attempt_id, position)
);

create table if not exists public.ia_evidences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('tarea', 'artefacto')),
  title text not null,
  hours_month numeric(6, 1) not null default 0,
  quality text not null default '',
  link text not null default '',
  status text not null default 'pendiente' check (status in ('pendiente', 'validada', 'rechazada')),
  review_note text not null default '',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ia_mentorships (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null references public.profiles (id) on delete cascade,
  mentor_id uuid references public.profiles (id) on delete set null,
  status text not null default 'solicitada' check (status in ('solicitada', 'activa', 'cerrada')),
  note text not null default '',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz
);

create table if not exists public.ia_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo_day', 'micro')),
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ia_session_signups (
  session_id uuid not null references public.ia_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pitch_title text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.ia_session_feedback (
  session_id uuid not null references public.ia_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Borrador inicial del banco (marcado como borrador para revisarlo con Germán).
insert into public.ia_questions (difficulty, prompt, options, correct_index, explanation, draft)
select v.d, v.p, v.o::jsonb, v.c, v.e, true from (values
  ('facil', '¿Qué es un "prompt"?', '["La instrucción o pregunta que le das a la IA","El nombre del modelo de IA","Un virus informático","La contraseña de la herramienta"]', 0, 'El prompt es lo que le pides a la IA; de su claridad depende la calidad de la respuesta.'),
  ('facil', '¿Cuál de estos datos NUNCA debes pegar en una herramienta de IA que no esté aprobada por la empresa?', '["El número de cédula y datos financieros de un cliente","Una pregunta general sobre Excel","Un texto público de la página web de Plataform","Una idea para mejorar un correo"]', 0, 'Los datos personales y financieros de clientes son información sensible: solo se usan en herramientas aprobadas.'),
  ('facil', 'La IA te da una cifra para un informe. ¿Qué haces?', '["La verifico en la fuente antes de usarla","La copio tal cual porque la IA no se equivoca","La redondeo y la uso","Le pido a la IA que confirme que es cierta"]', 0, 'La IA puede inventar datos con seguridad aparente; toda cifra se verifica en la fuente.'),
  ('media', '¿Qué prompt dará un mejor resumen de un contrato?', '["Resume este contrato en 5 puntos para un comercial: obligaciones, plazos, montos y riesgos","Resume","Hazlo corto","Dime algo del contrato"]', 0, 'Un buen prompt dice para quién es, qué formato quieres y qué no puede faltar.'),
  ('media', 'Tienes que repetir cada semana la misma tarea de copiar datos de correos a una hoja. ¿Cuál es el mejor primer paso con IA?', '["Describir el paso a paso de la tarea y pedir a la IA una propuesta para automatizarla","Pedirle a la IA que haga la tarea una sola vez","Seguir haciéndola a mano","Comprar un software sin analizar el proceso"]', 0, 'Antes de automatizar hay que entender el proceso; la IA ayuda a diseñar la automatización.'),
  ('media', '¿Qué es una "alucinación" de la IA?', '["Una respuesta falsa presentada como si fuera cierta","Un error de conexión a internet","Una imagen generada por la IA","Cuando la IA tarda en responder"]', 0, 'Por eso la IA no reemplaza la verificación humana en decisiones importantes.'),
  ('dificil', 'Vas a publicar un artefacto que usa datos de clientes. ¿Qué debe existir antes de publicarlo?', '["Ficha de control IA con datos que usa, riesgos, responsable y forma de medir su impacto","Solo que funcione en tu computador","El visto bueno de un compañero por chat","Nada, si es para uso interno"]', 0, 'Un artefacto con datos sensibles necesita control: qué datos usa, quién responde y cómo se mide.'),
  ('dificil', 'Un agente de IA va a enviar correos a clientes de forma automática. ¿Qué control es más importante?', '["Que una persona revise y apruebe antes del envío en los casos críticos","Que el agente use un lenguaje formal","Que el agente envíe todo lo más rápido posible","Que el agente tenga acceso a todo el correo de la empresa"]', 0, 'Las acciones con impacto externo necesitan supervisión humana y permisos mínimos.'),
  ('dificil', '¿Cómo demuestras el impacto de una automatización con IA?', '["Midiendo las horas al mes y los errores antes y después","Contando cuántas veces se usó la herramienta","Preguntando si a la gente le gustó","Con el número de prompts escritos"]', 0, 'El impacto se mide en resultados: tiempo liberado y calidad, no en uso o asistencia.'),
  ('dificil', 'Una respuesta de la IA para un cálculo de factoring no cuadra con la calculadora oficial. ¿Qué haces?', '["Uso la calculadora oficial, reporto la diferencia y reviso las instrucciones del artefacto","Uso la respuesta de la IA porque es más reciente","Promedio los dos valores","Ignoro la diferencia si es pequeña"]', 0, 'La fuente oficial manda; las diferencias se reportan para corregir el artefacto.')
) as v (d, p, o, c, e)
where not exists (select 1 from public.ia_questions);

-- ---------------------------------------------------------------- Ayudantes

create or replace function public._ia_points(p_difficulty text) returns integer
language sql immutable as $$
  select case p_difficulty when 'facil' then 6 when 'media' then 10 else 13 end
$$;

create or replace function public._ia_level_for(p_score integer) returns text
language sql immutable as $$
  select case when p_score <= 40 then 'explorador' when p_score <= 70 then 'practicante' else 'constructor' end
$$;

create or replace function public._ia_level(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select level from ia_attempts where user_id = p_user and status = 'terminado' order by attempt_no desc limit 1
$$;

-- Puede presentar si nunca lo hizo, o si tiene una evidencia validada después de su último examen.
create or replace function public._ia_can_start(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from ia_attempts where user_id = p_user and status = 'terminado')
    or exists (select 1 from ia_evidences e where e.user_id = p_user and e.status = 'validada'
               and e.reviewed_at > (select max(finished_at) from ia_attempts where user_id = p_user and status = 'terminado'))
$$;

-- Director: devuelve su área; administración: null (todas). Otros: error.
create or replace function public._ia_scope(u public.profiles) returns uuid
language plpgsql stable as $$
begin
  if u.role = 'admin' then return null; end if;
  if u.org_role = 'director' and u.area_id is not null then return u.area_id; end if;
  raise exception 'El mapa de calor es para la administración y los directores.' using errcode = 'PT403';
end $$;

create or replace function public._ia_finish(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_score int;
begin
  select coalesce(sum(earned), 0) into v_score from ia_attempt_items where attempt_id = p_attempt;
  update ia_attempts set status = 'terminado', score = v_score, level = _ia_level_for(v_score), finished_at = now()
  where id = p_attempt and status = 'en_curso';
end $$;

-- ---------------------------------------------------------------- Examen

create or replace function public.app_ia_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); v_open ia_mentorships;
begin
  select * into v_open from ia_mentorships where mentee_id = u.id and status <> 'cerrada' order by requested_at desc limit 1;
  return jsonb_build_object(
    'org_role', u.org_role,
    'level', _ia_level(u.id),
    'in_progress', exists (select 1 from ia_attempts where user_id = u.id and status = 'en_curso'),
    'can_start', _ia_can_start(u.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('attempt_no', a.attempt_no, 'score', a.score, 'level', a.level,
        'finished_at', a.finished_at) order by a.attempt_no) from ia_attempts a where a.user_id = u.id and a.status = 'terminado'), '[]'),
    'evidences', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'hours_month', e.hours_month,
        'quality', e.quality, 'link', e.link, 'status', e.status, 'review_note', e.review_note, 'created_at', e.created_at) order by e.created_at desc)
      from ia_evidences e where e.user_id = u.id), '[]'),
    'mentorship', case when v_open.id is null then null else jsonb_build_object('id', v_open.id, 'status', v_open.status,
        'mentor', (select name from profiles where id = v_open.mentor_id), 'requested_at', v_open.requested_at, 'started_at', v_open.started_at) end,
    'mentees', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'since', m.started_at)) from ia_mentorships m
      join profiles p on p.id = m.mentee_id where m.mentor_id = u.id and m.status = 'activa'), '[]'));
end $$;

-- Devuelve la pregunta actual del intento en curso (o el resultado si ya terminó).
-- Las preguntas vencidas (más de 60 s) se marcan como no respondidas.
create or replace function public.app_ia_current() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); a ia_attempts; it ia_attempt_items;
begin
  select * into a from ia_attempts where user_id = u.id and status = 'en_curso' order by attempt_no desc limit 1;
  if a.id is null then
    select * into a from ia_attempts where user_id = u.id and status = 'terminado' order by attempt_no desc limit 1;
    if a.id is null then return jsonb_build_object('status', 'none'); end if;
    return app_ia_result(a.id);
  end if;
  loop
    select * into it from ia_attempt_items where attempt_id = a.id and status = 'pendiente' order by position limit 1;
    if it.position is null then
      perform _ia_finish(a.id);
      return app_ia_result(a.id);
    end if;
    if it.served_at is null then
      update ia_attempt_items set served_at = now() where attempt_id = a.id and position = it.position returning * into it;
    elsif now() > it.served_at + interval '63 seconds' then
      update ia_attempt_items set status = 'sin_respuesta' where attempt_id = a.id and position = it.position;
      continue;
    end if;
    return jsonb_build_object('status', 'question', 'attempt_id', a.id, 'attempt_no', a.attempt_no, 'position', it.position,
      'total', (select count(*) from ia_attempt_items where attempt_id = a.id), 'difficulty', it.difficulty, 'points', it.points,
      'prompt', it.prompt, 'options', it.options,
      'remaining_ms', greatest(0, round(extract(epoch from (it.served_at + interval '60 seconds' - now())) * 1000)));
  end loop;
end $$;

create or replace function public.app_ia_start() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); v_no int; v_attempt uuid; q record; v_pos int := 0; v_opts jsonb; v_correct int;
begin
  if exists (select 1 from ia_attempts where user_id = u.id and status = 'en_curso') then return app_ia_current(); end if;
  if not _ia_can_start(u.id) then
    raise exception 'Para presentar el examen de nuevo, registra una evidencia de tu ruta y espera a que la validen.' using errcode = 'PT409';
  end if;
  if (select count(*) from ia_questions where active and difficulty = 'facil') < 3
     or (select count(*) from ia_questions where active and difficulty = 'media') < 3
     or (select count(*) from ia_questions where active and difficulty = 'dificil') < 4 then
    raise exception 'El banco necesita al menos 3 preguntas fáciles, 3 medias y 4 difíciles activas.' using errcode = 'PT409';
  end if;
  select coalesce(max(attempt_no), 0) + 1 into v_no from ia_attempts where user_id = u.id;
  insert into ia_attempts (user_id, attempt_no, area_id, org_role) values (u.id, v_no, u.area_id, u.org_role) returning id into v_attempt;
  for q in
    select * from (select *, row_number() over (partition by difficulty order by random()) as rn from ia_questions where active) s
    where (difficulty = 'facil' and rn <= 3) or (difficulty = 'media' and rn <= 3) or (difficulty = 'dificil' and rn <= 4)
    order by case difficulty when 'facil' then 1 when 'media' then 2 else 3 end, random()
  loop
    v_pos := v_pos + 1;
    -- Orden aleatorio de opciones: se guarda dónde quedó la correcta.
    select jsonb_agg(o.value order by o.r), array_position(array_agg(o.ord order by o.r), (q.correct_index + 1)::bigint) - 1
    into v_opts, v_correct
    from (select value, ordinality as ord, random() as r from jsonb_array_elements(q.options) with ordinality) o;
    insert into ia_attempt_items (attempt_id, position, question_id, difficulty, points, prompt, options, correct_shown)
    values (v_attempt, v_pos, q.id, q.difficulty, _ia_points(q.difficulty), q.prompt, v_opts, v_correct);
  end loop;
  return app_ia_current();
end $$;

create or replace function public.app_ia_answer(p_attempt uuid, p_position integer, p_choice integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); it ia_attempt_items;
begin
  select i.* into it from ia_attempt_items i join ia_attempts a on a.id = i.attempt_id
  where i.attempt_id = p_attempt and i.position = p_position and a.user_id = u.id and a.status = 'en_curso';
  if it.position is null then raise exception 'Esta pregunta ya no está disponible.' using errcode = 'PT409'; end if;
  if it.status = 'pendiente' and it.served_at is not null then
    if now() > it.served_at + interval '63 seconds' then
      update ia_attempt_items set status = 'sin_respuesta' where attempt_id = p_attempt and position = p_position;
    else
      update ia_attempt_items set status = 'respondida', answered_at = now(), chosen_shown = p_choice,
        earned = case when p_choice = it.correct_shown then it.points else 0 end
      where attempt_id = p_attempt and position = p_position;
    end if;
  end if;
  return app_ia_current();
end $$;

-- Resultado de un intento: solo para su dueño o la administración. No revela las respuestas correctas.
create or replace function public.app_ia_result(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); a ia_attempts;
begin
  select * into a from ia_attempts where id = p_attempt;
  if a.id is null or (a.user_id <> u.id and u.role <> 'admin') then raise exception 'Resultado no encontrado.' using errcode = 'PT404'; end if;
  return jsonb_build_object('status', case when a.status = 'terminado' then 'finished' else 'in_progress' end,
    'attempt_no', a.attempt_no, 'score', a.score, 'level', a.level, 'finished_at', a.finished_at,
    'by_difficulty', (select jsonb_agg(jsonb_build_object('difficulty', d.difficulty, 'correct', d.correct, 'total', d.total,
        'earned', d.earned, 'possible', d.possible) order by case d.difficulty when 'facil' then 1 when 'media' then 2 else 3 end)
      from (select difficulty, count(*) filter (where earned > 0) as correct, count(*) as total, sum(earned) as earned, sum(points) as possible
            from ia_attempt_items where attempt_id = a.id group by difficulty) d),
    'unanswered', (select count(*) from ia_attempt_items where attempt_id = a.id and status = 'sin_respuesta'));
end $$;

-- ---------------------------------------------------------------- Mapa de calor

create or replace function public.app_ia_heatmap(p_area uuid default null, p_role text default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); v_scope uuid := _ia_scope(u); v_area uuid := coalesce(v_scope, p_area); v_admin boolean := u.role = 'admin';
begin
  return jsonb_build_object(
    'scope', case when v_admin then 'admin' else 'director' end,
    'rows', coalesce((
      with latest as (
        select distinct on (a.user_id) a.user_id, a.area_id, a.level
        from ia_attempts a
        where a.status = 'terminado'
          and (v_area is null or a.area_id = v_area)
          and (p_role is null or a.org_role = p_role)
          and (p_from is null or a.finished_at >= p_from)
          and (p_to is null or a.finished_at < p_to + 1)
        order by a.user_id, a.attempt_no desc),
      per_area as (
        select l.area_id, count(*) as total,
          count(*) filter (where l.level = 'explorador') as explorador,
          count(*) filter (where l.level = 'practicante') as practicante,
          count(*) filter (where l.level = 'constructor') as constructor
        from latest l group by l.area_id)
      select jsonb_agg(jsonb_build_object(
          'area_id', pa.area_id, 'area', coalesce(ar.name, 'Sin área'), 'icon', coalesce(ar.icon, '❔'), 'total', pa.total,
          -- Grupos de menos de 3 personas no se muestran a directores: revelarían puntajes individuales.
          'hidden', not v_admin and pa.total < 3,
          'explorador', case when not v_admin and pa.total < 3 then null else pa.explorador end,
          'practicante', case when not v_admin and pa.total < 3 then null else pa.practicante end,
          'constructor', case when not v_admin and pa.total < 3 then null else pa.constructor end)
        order by coalesce(ar.name, 'zzz'))
      from per_area pa left join areas ar on ar.id = pa.area_id), '[]'),
    'progress', (
      with firsts as (
        select a1.user_id, a1.area_id, a1.level as first_level, a2.level as second_level
        from ia_attempts a1 join ia_attempts a2 on a2.user_id = a1.user_id and a2.attempt_no = 2 and a2.status = 'terminado'
        where a1.attempt_no = 1 and a1.status = 'terminado'
          and (v_area is null or a1.area_id = v_area) and (p_role is null or a1.org_role = p_role)),
      ranked as (
        select f.*, (case f.second_level when 'explorador' then 1 when 'practicante' then 2 else 3 end)
                  - (case f.first_level when 'explorador' then 1 when 'practicante' then 2 else 3 end) as delta from firsts f)
      select jsonb_build_object(
        'with_two', (select count(*) from ranked),
        'up', (select count(*) from ranked where delta > 0),
        'same', (select count(*) from ranked where delta = 0),
        'down', (select count(*) from ranked where delta < 0),
        'hidden', not v_admin and (select count(*) from ranked) < 3,
        'people', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'area', ar.name,
            'first', r.first_level, 'second', r.second_level, 'delta', r.delta) order by r.delta desc, p.name)
          from ranked r join profiles p on p.id = r.user_id left join areas ar on ar.id = r.area_id), '[]') else '[]' end)));
end $$;

-- ---------------------------------------------------------------- Evidencias

create or replace function public.app_ia_evidence_save(p_kind text, p_title text, p_hours numeric default 0, p_quality text default '', p_link text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); e ia_evidences;
begin
  if p_kind is null or p_kind not in ('tarea', 'artefacto') then raise exception 'Elige si es una tarea o un artefacto.' using errcode = 'PT400'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Describe la tarea o el artefacto.' using errcode = 'PT400'; end if;
  if coalesce(p_hours, 0) < 0 or coalesce(p_hours, 0) > 744 then raise exception 'Las horas al mes deben estar entre 0 y 744.' using errcode = 'PT400'; end if;
  if coalesce(p_link, '') <> '' and p_link !~* '^https://' then raise exception 'El enlace debe empezar por https://' using errcode = 'PT400'; end if;
  insert into ia_evidences (user_id, kind, title, hours_month, quality, link)
  values (u.id, p_kind, left(trim(p_title), 200), coalesce(p_hours, 0), left(coalesce(p_quality, ''), 500), left(coalesce(p_link, ''), 500))
  returning * into e;
  return to_jsonb(e);
end $$;

create or replace function public.app_ia_evidences(p_status text default 'pendiente') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'hours_month', e.hours_month,
      'quality', e.quality, 'link', e.link, 'status', e.status, 'review_note', e.review_note, 'created_at', e.created_at,
      'person', p.name, 'area', ar.name, 'level', _ia_level(p.id)) order by e.created_at)
    from ia_evidences e join profiles p on p.id = e.user_id left join areas ar on ar.id = p.area_id
    where p_status is null or e.status = p_status), '[]');
end $$;

create or replace function public.app_ia_evidence_review(p_id uuid, p_status text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  if p_status not in ('validada', 'rechazada') then raise exception 'Estado inválido.' using errcode = 'PT400'; end if;
  update ia_evidences set status = p_status, review_note = coalesce(p_note, ''), reviewed_by = u.id, reviewed_at = now() where id = p_id;
  if not found then raise exception 'Evidencia no encontrada.' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Mentorías

create or replace function public.app_ia_mentor_request(p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); v_level text := _ia_level(u.id);
begin
  if v_level is null then raise exception 'Primero presenta el examen IA First.' using errcode = 'PT409'; end if;
  if v_level = 'constructor' then raise exception 'Como Constructor puedes ser mentor; la administración te asignará aprendices.' using errcode = 'PT409'; end if;
  if exists (select 1 from ia_mentorships where mentee_id = u.id and status <> 'cerrada') then
    raise exception 'Ya tienes una solicitud de mentoría abierta.' using errcode = 'PT409';
  end if;
  insert into ia_mentorships (mentee_id, note) values (u.id, left(coalesce(p_note, ''), 300));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_ia_mentorships() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'note', m.note, 'requested_at', m.requested_at,
        'started_at', m.started_at, 'mentee', pe.name, 'mentee_area', ar.name, 'mentee_level', _ia_level(pe.id), 'mentor', pm.name)
        order by case m.status when 'solicitada' then 1 when 'activa' then 2 else 3 end, m.requested_at)
      from ia_mentorships m join profiles pe on pe.id = m.mentee_id left join profiles pm on pm.id = m.mentor_id
      left join areas ar on ar.id = pe.area_id), '[]'),
    'mentors', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'area', ar.name,
        'active', (select count(*) from ia_mentorships m where m.mentor_id = p.id and m.status = 'activa')) order by p.name)
      from profiles p left join areas ar on ar.id = p.area_id where p.active and _ia_level(p.id) = 'constructor'), '[]'));
end $$;

create or replace function public.app_ia_mentor_assign(p_id uuid, p_mentor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); m ia_mentorships;
begin
  select * into m from ia_mentorships where id = p_id;
  if m.id is null then raise exception 'Mentoría no encontrada.' using errcode = 'PT404'; end if;
  if p_mentor = m.mentee_id or coalesce(_ia_level(p_mentor), '') <> 'constructor' then
    raise exception 'El mentor debe ser una persona de nivel Constructor.' using errcode = 'PT400';
  end if;
  update ia_mentorships set mentor_id = p_mentor, status = 'activa', started_at = coalesce(started_at, now()) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_ia_mentor_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  update ia_mentorships set status = 'cerrada', closed_at = now() where id = p_id;
  if not found then raise exception 'Mentoría no encontrada.' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Demo Days y microaprendizajes

create or replace function public.app_ia_sessions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'description', s.description,
      'starts_at', s.starts_at, 'past', s.starts_at < now(),
      'presenters', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'pitch', g.pitch_title) order by g.created_at)
        from ia_session_signups g join profiles p on p.id = g.user_id where g.session_id = s.id), '[]'),
      'my_pitch', (select pitch_title from ia_session_signups where session_id = s.id and user_id = u.id),
      'my_rating', (select rating from ia_session_feedback where session_id = s.id and user_id = u.id),
      'feedback_count', case when u.role = 'admin' then (select count(*) from ia_session_feedback where session_id = s.id) end,
      'avg_rating', case when u.role = 'admin' then (select round(avg(rating), 1) from ia_session_feedback where session_id = s.id) end,
      'comments', case when u.role = 'admin' then coalesce((select jsonb_agg(comment) from ia_session_feedback where session_id = s.id and comment <> ''), '[]') end)
      order by s.starts_at)
    from ia_sessions s), '[]');
end $$;

create or replace function public.app_ia_session_save(p_id uuid, p_kind text, p_title text, p_starts_at timestamptz, p_description text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); s ia_sessions;
begin
  if p_kind not in ('demo_day', 'micro') then raise exception 'Tipo de sesión inválido.' using errcode = 'PT400'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 or p_starts_at is null then raise exception 'La sesión necesita título y fecha.' using errcode = 'PT400'; end if;
  if p_id is null then
    insert into ia_sessions (kind, title, starts_at, description) values (p_kind, trim(p_title), p_starts_at, coalesce(p_description, '')) returning * into s;
  else
    update ia_sessions set kind = p_kind, title = trim(p_title), starts_at = p_starts_at, description = coalesce(p_description, '') where id = p_id returning * into s;
    if s.id is null then raise exception 'Sesión no encontrada.' using errcode = 'PT404'; end if;
  end if;
  return to_jsonb(s);
end $$;

create or replace function public.app_ia_session_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  delete from ia_sessions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Inscribirse a presentar (pitch de 5 min + 5 de preguntas). p_pitch vacío cancela la inscripción.
create or replace function public.app_ia_session_signup(p_session uuid, p_pitch text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); s ia_sessions;
begin
  select * into s from ia_sessions where id = p_session;
  if s.id is null then raise exception 'Sesión no encontrada.' using errcode = 'PT404'; end if;
  if s.kind <> 'demo_day' then raise exception 'Solo los Demo Days reciben presentaciones.' using errcode = 'PT400'; end if;
  if s.starts_at < now() then raise exception 'Esta sesión ya pasó.' using errcode = 'PT409'; end if;
  if length(trim(coalesce(p_pitch, ''))) = 0 then
    delete from ia_session_signups where session_id = p_session and user_id = u.id;
  else
    insert into ia_session_signups (session_id, user_id, pitch_title) values (p_session, u.id, left(trim(p_pitch), 150))
    on conflict (session_id, user_id) do update set pitch_title = excluded.pitch_title;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_ia_session_feedback(p_session uuid, p_rating integer, p_comment text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _me(); s ia_sessions;
begin
  select * into s from ia_sessions where id = p_session;
  if s.id is null then raise exception 'Sesión no encontrada.' using errcode = 'PT404'; end if;
  if s.starts_at > now() then raise exception 'La encuesta se abre cuando termina la sesión.' using errcode = 'PT409'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Califica de 1 a 5.' using errcode = 'PT400'; end if;
  insert into ia_session_feedback (session_id, user_id, rating, comment) values (p_session, u.id, p_rating, left(coalesce(p_comment, ''), 500))
  on conflict (session_id, user_id) do update set rating = excluded.rating, comment = excluded.comment;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Banco de preguntas

create or replace function public.app_ia_questions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  return coalesce((select jsonb_agg(to_jsonb(q) order by case q.difficulty when 'facil' then 1 when 'media' then 2 else 3 end, q.created_at)
    from ia_questions q), '[]');
end $$;

create or replace function public.app_ia_question_save(p_id uuid, p_difficulty text, p_prompt text, p_options jsonb, p_correct integer, p_explanation text default '', p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin(); q ia_questions;
begin
  if p_difficulty not in ('facil', 'media', 'dificil') then raise exception 'Elige la dificultad.' using errcode = 'PT400'; end if;
  if length(trim(coalesce(p_prompt, ''))) < 5 then raise exception 'Escribe la pregunta.' using errcode = 'PT400'; end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 4
     or exists (select 1 from jsonb_array_elements_text(p_options) o where trim(o) = '') then
    raise exception 'La pregunta necesita entre 2 y 4 opciones sin espacios vacíos.' using errcode = 'PT400';
  end if;
  if p_correct is null or p_correct not between 0 and jsonb_array_length(p_options) - 1 then
    raise exception 'Marca la respuesta correcta.' using errcode = 'PT400';
  end if;
  if p_id is null then
    insert into ia_questions (difficulty, prompt, options, correct_index, explanation, active)
    values (p_difficulty, trim(p_prompt), p_options, p_correct, coalesce(p_explanation, ''), coalesce(p_active, true)) returning * into q;
  else
    update ia_questions set difficulty = p_difficulty, prompt = trim(p_prompt), options = p_options, correct_index = p_correct,
      explanation = coalesce(p_explanation, ''), active = coalesce(p_active, true), draft = false, updated_at = now()
    where id = p_id returning * into q;
    if q.id is null then raise exception 'Pregunta no encontrada.' using errcode = 'PT404'; end if;
  end if;
  return to_jsonb(q);
end $$;

-- ---------------------------------------------------------------- Personas e indicadores

create or replace function public.app_admin_set_org_role(p_user uuid, p_role text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  if p_role is not null and p_role not in ('director', 'lider', 'analista') then raise exception 'Rol inválido.' using errcode = 'PT400'; end if;
  update profiles set org_role = p_role where id = p_user;
  if not found then raise exception 'Persona no encontrada.' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_ia_kpis() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles := _admin();
  v_total int := nullif((select value from app_config where key = 'total_personal'), '')::int;
  v_people int := (select count(*) from profiles where active and not is_demo);
  v_tested int := (select count(distinct a.user_id) from ia_attempts a join profiles p on p.id = a.user_id
                   where a.status = 'terminado' and not p.is_demo);
  v_two int; v_up int;
begin
  select count(*), count(*) filter (where (case a2.level when 'explorador' then 1 when 'practicante' then 2 else 3 end)
                                        > (case a1.level when 'explorador' then 1 when 'practicante' then 2 else 3 end))
  into v_two, v_up
  from ia_attempts a1 join ia_attempts a2 on a2.user_id = a1.user_id and a2.attempt_no = 2 and a2.status = 'terminado'
  join profiles p on p.id = a1.user_id
  where a1.attempt_no = 1 and a1.status = 'terminado' and not p.is_demo;
  return jsonb_build_object(
    'total_personal', coalesce(nullif(v_total, 0), v_people), 'total_from_config', coalesce(v_total, 0) > 0,
    'tested', v_tested, 'with_two', v_two, 'up', v_up,
    'artifacts', (select count(*) from ia_evidences e join profiles p on p.id = e.user_id where e.kind = 'artefacto' and e.status = 'validada' and not p.is_demo),
    'artifacts_measured', (select count(*) from ia_evidences e join profiles p on p.id = e.user_id
      where e.kind = 'artefacto' and e.status = 'validada' and not p.is_demo and (e.hours_month > 0 or trim(e.quality) <> '')),
    'hours_month', (select coalesce(sum(e.hours_month), 0) from ia_evidences e join profiles p on p.id = e.user_id where e.status = 'validada' and not p.is_demo),
    'pending_evidences', (select count(*) from ia_evidences where status = 'pendiente'),
    'pending_mentorships', (select count(*) from ia_mentorships where status = 'solicitada'),
    'levels', (select jsonb_build_object(
        'explorador', count(*) filter (where l = 'explorador'), 'practicante', count(*) filter (where l = 'practicante'),
        'constructor', count(*) filter (where l = 'constructor'))
      from (select _ia_level(p.id) as l from profiles p where p.active and not p.is_demo) x));
end $$;

create or replace function public.app_ia_set_total(p_total integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u profiles := _admin();
begin
  if p_total is null or p_total < 0 or p_total > 100000 then raise exception 'Número inválido.' using errcode = 'PT400'; end if;
  insert into app_config (key, value) values ('total_personal', p_total::text) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- Usuarios de prueba para la demo: marca como "demo" las cuentas demo.explorador@,
-- demo.practicante@ y demo.constructor@ (creadas antes desde la pantalla de ingreso)
-- y les registra un examen terminado. No cuentan en los indicadores.
create or replace function public.app_ia_demo_setup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u profiles := _admin();
  v_domain text := coalesce((select value from app_config where key = 'allowed_domain'), 'plataform.com');
  d record; p profiles; v_attempt uuid; v_ready jsonb := '[]'; v_missing jsonb := '[]';
begin
  for d in select * from (values ('explorador', 32), ('practicante', 58), ('constructor', 87)) as t (level, score) loop
    select * into p from profiles where email = format('demo.%s@%s', d.level, v_domain);
    if p.id is null then v_missing := v_missing || to_jsonb(format('demo.%s@%s', d.level, v_domain)); continue; end if;
    update profiles set is_demo = true, org_role = coalesce(org_role, 'analista'),
      area_id = coalesce(area_id, (select id from areas where active order by lower(name) limit 1)) where id = p.id;
    if not exists (select 1 from ia_attempts where user_id = p.id) then
      insert into ia_attempts (user_id, attempt_no, area_id, org_role, status, score, level, finished_at)
      select p.id, 1, area_id, org_role, 'terminado', d.score, d.level, now() from profiles where id = p.id returning id into v_attempt;
    end if;
    v_ready := v_ready || to_jsonb(p.email);
  end loop;
  return jsonb_build_object('ready', v_ready, 'missing', v_missing);
end $$;

-- ---------------------------------------------------------------- Entrada sin capa de ingreso

-- Registra el navegador con su llave y crea la persona (sin correo real ni contraseña).
-- Si la llave ya existe, no crea nada.
create or replace function public.app_guest_join(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid := gen_random_uuid();
  v_email text;
begin
  if length(coalesce(p_token, '')) < 32 then raise exception 'Llave del navegador inválida.' using errcode = 'PT400'; end if;
  if exists (select 1 from app_devices where token_hash = v_hash) then return jsonb_build_object('ok', true); end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'Escribe tu nombre (2 a 60 caracteres).' using errcode = 'PT400'; end if;
  v_email := format('invitado.%s@%s', left(replace(v_id::text, '-', ''), 12), coalesce(nullif((select value from app_config where key = 'allowed_domain'), ''), 'plataform.com'));
  insert into profiles (id, email, name, role) values (v_id, v_email, v_name, _initial_role(v_email));
  insert into app_devices (token_hash, user_id) values (v_hash, v_id);
  return jsonb_build_object('ok', true);
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
alter table public.ia_questions enable row level security;
alter table public.ia_attempts enable row level security;
alter table public.ia_attempt_items enable row level security;
alter table public.ia_evidences enable row level security;
alter table public.ia_mentorships enable row level security;
alter table public.ia_sessions enable row level security;
alter table public.ia_session_signups enable row level security;
alter table public.ia_session_feedback enable row level security;
alter table public.app_devices enable row level security;
revoke all on all tables in schema public from anon, authenticated;

-- Solo las funciones app_* quedan disponibles. También para "anon": quien entra sin
-- capa de ingreso se identifica con la llave de su navegador; cada función valida
-- quién llama con _me() y rechaza a quien no tenga sesión ni llave registrada.
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
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
