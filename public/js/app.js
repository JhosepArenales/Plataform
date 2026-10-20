import { api, session } from './api.js';
import { h } from './ui.js';
import { renderLogin, renderHome, renderCourse } from './views/learner.js';
import { renderJoin, renderHost } from './views/game.js';
import { renderAdminDashboard, renderAdminCourses, renderEditor, renderAiWizard, renderUsers } from './views/admin.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const routes = [
  { re: /^\/jugar(?:\/(\d{6}))?$/, view: renderJoin, public: true, bare: true },
  { re: /^\/host\/(\d{6})$/, view: renderHost, admin: true, bare: true },
  { re: /^\/login$/, view: renderLogin, public: true, bare: true },
  { re: /^\/$/, view: renderHome },
  { re: /^\/curso\/([\w-]+)(?:\/leccion\/([\w-]+))?$/, view: renderCourse },
  { re: /^\/admin$/, view: renderAdminDashboard, admin: true },
  { re: /^\/admin\/cursos$/, view: renderAdminCourses, admin: true },
  { re: /^\/admin\/ia$/, view: renderAiWizard, admin: true },
  { re: /^\/admin\/nuevo$/, view: renderEditor, admin: true },
  { re: /^\/admin\/curso\/([\w-]+)$/, view: renderEditor, admin: true },
  { re: /^\/admin\/usuarios$/, view: renderUsers, admin: true },
];

let renderToken = 0;

async function ensureUser() {
  if (session.user || !session.token) return session.user;
  try { session.user = (await api('/api/me')).user; } catch { session.user = null; }
  return session.user;
}

function renderNav() {
  const u = session.user;
  const path = location.hash.slice(1) || '/';
  const link = (href, label, match) => h('a', { href: `#${href}`, class: match(path) ? 'active' : '' }, label);
  nav.replaceChildren(
    h('a', { href: '#/', class: 'brand' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')),
    h('nav', { class: 'nav-links' },
      link('/', 'Aprender', (p) => p === '/' || p.startsWith('/curso')),
      link('/jugar', 'Jugar 🎮', (p) => p.startsWith('/jugar')),
      u?.role === 'admin' && link('/admin', [h('span', { class: 'lbl-long' }, 'Administrar'), h('span', { class: 'lbl-short' }, 'Admin')], (p) => p.startsWith('/admin'))),
    u && h('div', { class: 'nav-user' },
      h('span', { class: 'avatar', title: u.email }, u.name.slice(0, 1).toUpperCase()),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: logout }, 'Salir')));
  document.body.classList.toggle('admin-mode', path.startsWith('/admin'));
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* la sesión ya no es válida */ }
  session.token = null; session.user = null;
  location.hash = '#/login';
}

export async function router() {
  const token = ++renderToken;
  const path = location.hash.slice(1) || '/';
  const route = routes.find((r) => r.re.test(path));
  if (!route) { location.hash = '#/'; return; }
  const user = await ensureUser();
  if (token !== renderToken) return;
  if (!route.public && !user) {
    sessionStorage.setItem('academia.next', path);
    location.hash = '#/login';
    return;
  }
  if (route.admin && user?.role !== 'admin') { location.hash = '#/'; return; }
  document.body.classList.toggle('bare', !!route.bare);
  renderNav();
  const params = path.match(route.re).slice(1);
  main.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  try {
    const view = await route.view(...params);
    if (token !== renderToken) return; // el usuario ya navegó a otra pantalla
    main.replaceChildren(view);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    main.replaceChildren(h('div', { class: 'card empty-state' },
      h('div', { class: 'empty-icon' }, '😕'), h('h2', {}, 'No pudimos abrir esta pantalla'), h('p', {}, err.message),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Volver al inicio')));
  }
}

export function afterLogin(user) {
  session.user = user;
  const next = sessionStorage.getItem('academia.next');
  sessionStorage.removeItem('academia.next');
  location.hash = `#${next && !['/login', '/'].includes(next) ? next : user.role === 'admin' ? '/admin' : '/'}`;
}

window.addEventListener('hashchange', router);
window.addEventListener('academia:logout', () => { session.user = null; location.hash = '#/login'; });
router();
