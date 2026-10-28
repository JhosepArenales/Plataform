// Supabase local para pruebas: Postgres embebido (PGlite) con supabase/schema.sql,
// más un servidor HTTP que imita las rutas que usa la Academia de Supabase Auth
// (/auth/v1) y de la API de datos (/rest/v1/rpc). Así el cliente oficial
// @supabase/supabase-js se prueba contra las mismas funciones y permisos reales.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import * as supabaseJs from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';

const AUTH_STUB = `
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
`;

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export async function startFakeSupabase() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

  const accounts = new Map(); // email → { id, password, name, confirmed }
  const settings = { confirmEmail: false }; // como "Confirm email" en Supabase
  const tokens = new Map(); // access_token → user id
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  const userJson = (a) => ({ id: a.id, aud: 'authenticated', role: 'authenticated', email: a.email, user_metadata: { name: a.name }, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() });
  const sessionFor = (a) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: a.id, email: a.email, role: 'authenticated', aud: 'authenticated', exp, session_id: crypto.randomUUID() })}.firma`;
    tokens.set(access, a.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: crypto.randomUUID(), user: userJson(a) };
  };

  const argTypes = new Map();
  async function signature(fn) {
    if (!argTypes.has(fn)) {
      const r = await db.query(`select p.parameter_name as name, p.data_type, p.udt_name from information_schema.parameters p
        join information_schema.routines r on r.specific_name = p.specific_name
        where r.routine_schema = 'public' and r.routine_name = $1 and p.parameter_mode = 'IN' order by p.ordinal_position`, [fn]);
      if (!r.rows.length && !(await db.query(`select 1 from pg_proc where proname = $1`, [fn])).rows.length) return null;
      argTypes.set(fn, r.rows);
    }
    return argTypes.get(fn);
  }

  async function callRpc(fn, args, userId) {
    const sig = await signature(fn);
    if (!sig) return [404, { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null }];
    const values = [];
    const parts = [];
    for (const p of sig) {
      if (!(p.name in args)) continue;
      values.push(JSON.stringify(args[p.name]));
      const $ = `$${values.length}::jsonb`;
      const expr = p.udt_name === 'jsonb' ? $
        : p.data_type === 'ARRAY' ? `array(select jsonb_array_elements_text(${$}))::${p.udt_name.slice(1)}[]`
        : `(${$} #>> '{}')::${p.udt_name}`;
      parts.push(`${p.name} => ${expr}`);
    }
    try {
      const result = await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
        await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
        return tx.query(`select public.${fn}(${parts.join(', ')}) as result`, values);
      });
      return [200, result.rows[0].result];
    } catch (e) {
      const status = /^PT\d{3}$/.test(e.code ?? '') ? Number(e.code.slice(2)) : e.code === '42501' ? (userId ? 403 : 401) : 400;
      return [status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
    }
  }

  async function handle(req, body) {
    const url = new URL(req.url, 'http://local');
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const userId = tokens.get(bearer) ?? null;

    if (req.method === 'POST' && url.pathname === '/auth/v1/signup') {
      const email = String(body.email ?? '').toLowerCase();
      if (accounts.has(email)) return [422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }];
      if (String(body.password ?? '').length < 6) return [422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }];
      try {
        const r = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(body.data ?? {})]);
        const a = { id: r.rows[0].id, email, password: body.password, name: body.data?.name ?? '', confirmed: !settings.confirmEmail };
        accounts.set(email, a);
        return [200, a.confirmed ? sessionFor(a) : userJson(a)];
      } catch {
        return [500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }];
      }
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const a = accounts.get(String(body.email ?? '').toLowerCase());
      if (!a || a.password !== body.password) return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }];
      if (a.confirmed === false) return [400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }];
      return [200, sessionFor(a)];
    }
    if (url.pathname === '/auth/v1/user') {
      const a = [...accounts.values()].find((x) => x.id === userId);
      return a ? [200, userJson(a)] : [401, { code: 401, msg: 'invalid JWT' }];
    }
    if (url.pathname === '/auth/v1/logout') { tokens.delete(bearer); return [204, null]; }
    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (req.method === 'POST' && rpcMatch) return callRpc(rpcMatch[1], body ?? {}, userId);
    return [404, { message: 'not found' }];
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => serial(async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* cuerpo vacío */ }
      const [status, data, headers = {}] = await handle(req, body);
      res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
      res.end(data === null ? '' : JSON.stringify(data));
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    db,
    // Activa o desactiva "Confirm email"; confirmAll() confirma las cuentas pendientes.
    setConfirmEmail: (on) => { settings.confirmEmail = on; },
    confirmAll: () => { for (const a of accounts.values()) a.confirmed = true; },
    // Consulta directa como la persona indicada (para comprobar permisos de tablas).
    asUser: (userId, sql) => db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
      return tx.query(sql);
    }),
    close: async () => { server.close(); await db.close(); },
  };
}

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Un "navegador" por persona: supabase/backend.js con su propio cliente y sesión.
export async function openBrowser(fake, email, { name = 'Persona', create = true, password = 'clave-segura-1' } = {}) {
  const window = { supabase: supabaseJs, localStorage: memoryStorage(), fetch: globalThis.fetch };
  const ctx = vm.createContext({ window, crypto: globalThis.crypto, Response, URL, URLSearchParams, TextDecoder, FormData, File, Blob, DecompressionStream, console });
  vm.runInContext(read('supabase/config.js').replace(/url: '[^']+'/, `url: '${fake.url}'`).replace(/^const /m, 'var '), ctx);
  vm.runInContext(read('demo/lib/content.js'), ctx);
  vm.runInContext(read('supabase/backend.js'), ctx);
  const sb = vm.runInContext('sb', ctx);
  const auth = create
    ? await sb.auth.signUp({ email, password, options: { data: { name } } })
    : await sb.auth.signInWithPassword({ email, password });
  const call = async (p, { method = 'GET', body } = {}) => {
    const res = await window.fetch(p, { method, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  return { call, sb, auth, id: auth.data?.user?.id };
}
