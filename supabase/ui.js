// Ajustes de interfaz de la versión con Supabase: ingreso automático con la cuenta
// de Google de la empresa, acceso con contraseña solo para cuentas de prueba
// (#/acceso-demo) y videos por link en lugar de subir archivos.

const AUTH_ERRORS = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/already registered|already been registered|already exists/i, 'Ese correo ya tiene una cuenta. Ingresa con tu contraseña.'],
  [/database error saving new user|solo se permiten correos/i, `Solo pueden entrar las cuentas @${ACADEMIA_CONFIG.domain}. Elige tu cuenta de la empresa.`],
  [/access_denied|cancel/i, 'Cancelaste el ingreso con Google.'],
  [/email not confirmed/i, 'Primero confirma tu cuenta con el enlace que llegó a tu correo.'],
  [/password should be|weak password/i, 'La contraseña es muy débil: usa al menos 8 caracteres.'],
  [/rate limit|too many/i, 'Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.'],
  [/fetch|network/i, 'Sin conexión. Revisa tu internet.'],
];
const authMessage = (error) => AUTH_ERRORS.find(([re]) => re.test(error?.message ?? ''))?.[1] ?? (error?.message || 'No se pudo ingresar.');

function renderPasswordLogin() {
  let creating = false;
  const nameInput = h('input', { name: 'name', autocomplete: 'name', placeholder: 'Nombre y apellido' });
  const nameField = h('label', { class: 'field hidden' }, 'Tu nombre', nameInput);
  const password = h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'current-password', placeholder: 'Mínimo 8 caracteres' });
  const title = h('h1', {}, '¡Bienvenido! 👋');
  const intro = h('p', { class: 'muted' }, 'Tu espacio para aprender todo lo que necesitas en tus primeros días.');
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar');
  const toggle = h('a', { href: '#/login', class: 'link-center' }, '¿Es tu primera vez? Crea tu cuenta');
  const help = h('p', { class: 'small muted center' }, 'Acceso solo para cuentas de prueba. ', h('a', { href: '#/login' }, 'Entrar con mi cuenta de Plataform'));
  const paintMode = () => {
    nameField.classList.toggle('hidden', !creating);
    nameInput.required = creating;
    password.autocomplete = creating ? 'new-password' : 'current-password';
    title.textContent = creating ? 'Crea tu cuenta ✨' : '¡Bienvenido! 👋';
    intro.textContent = creating ? `Usa tu correo @${ACADEMIA_CONFIG.domain} y elige una contraseña.` : 'Tu espacio para aprender todo lo que necesitas en tus primeros días.';
    submit.textContent = creating ? 'Crear mi cuenta' : 'Entrar';
    toggle.textContent = creating ? '¿Ya tienes cuenta? Ingresa' : '¿Es tu primera vez? Crea tu cuenta';
  };
  toggle.addEventListener('click', (e) => { e.preventDefault(); creating = !creating; paintMode(); });

  const form = h('form', { class: 'login-card card' },
    h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')),
    title, intro,
    h('label', { class: 'field' }, 'Correo de trabajo', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: `tu@${ACADEMIA_CONFIG.domain}` })),
    nameField,
    h('label', { class: 'field' }, 'Contraseña', password),
    submit, toggle, help);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim().toLowerCase();
    const pass = password.value;
    if (!email.endsWith(`@${ACADEMIA_CONFIG.domain}`)) return toast(`Usa tu correo @${ACADEMIA_CONFIG.domain}.`, 'error');
    if (pass.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', 'error');
    try {
      await busy(submit, async () => {
        const { data, error } = creating
          ? await sb.auth.signUp({ email, password: pass, options: { data: { name: nameInput.value.trim() } } })
          : await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw new Error(authMessage(error));
        if (!data.session) throw new Error('Te enviamos un correo para confirmar la cuenta. Ábrelo y luego ingresa aquí.');
        session.token = 'supabase';
        const me = await api('/api/me');
        afterLogin(me.user);
      }, creating ? 'Creando…' : 'Entrando…');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return h('div', { class: 'login-wrap' }, form);
}

// Pantalla de ingreso: no pide datos. Si hay sesión entra directo; si no, lleva a
// Google con la cuenta de la empresa. Tras "Salir" o un error muestra un botón,
// para no entrar en un ciclo de redirecciones.
function renderLogin() {
  const take = (k) => { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch { return null; } };
  const status = h('div', { class: 'stack center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Conectando con tu cuenta de Plataform…'));
  const card = h('div', { class: 'login-card card' },
    h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')), status);
  const goGoogle = async () => {
    try { sessionStorage.setItem('academia.oauth_at', String(Date.now())); } catch { /* sin almacenamiento */ }
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}`, queryParams: { hd: ACADEMIA_CONFIG.domain, prompt: 'select_account' } },
    });
    if (error) showButton(authMessage(error));
  };
  const showButton = (message) => {
    const btn = h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: goGoogle }, 'Entrar con mi cuenta de Plataform');
    status.replaceChildren(
      h('h1', {}, '¡Bienvenido! 👋'),
      h('p', { class: 'muted' }, 'Tu espacio para aprender todo lo que necesitas en tus primeros días.'),
      message && h('p', { class: 'login-error' }, message),
      btn,
      h('p', { class: 'small muted' }, `Usa tu correo @${ACADEMIA_CONFIG.domain}.`),
      h('a', { href: '#/jugar', class: 'link-center' }, '¿Tienes un PIN de juego? Únete aquí'));
  };
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      try {
        session.token = 'supabase';
        if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
        afterLogin((await api('/api/me')).user);
      } catch (err) { showButton(err.message); }
      return;
    }
    const error = take('academia.auth_error');
    const loggedOut = take('academia.logged_out');
    const lastTry = Number(take('academia.oauth_at') || 0);
    if (error) return showButton(authMessage({ message: error }));
    if (loggedOut || Date.now() - lastTry < 60000) return showButton();
    goGoogle();
  })();
  return h('div', { class: 'login-wrap' }, card);
}

(globalThis.ACADEMIA_EXT ??= { routes: [], navLinks: [], adminTabs: [] }).routes.push(
  { re: /^\/acceso-demo$/, view: renderPasswordLogin, public: true, bare: true });

// En esta versión los videos se agregan con un link.
function uploadWithProgress() {
  return Promise.reject(new ApiError('Por ahora los videos se agregan con un link: súbelo a YouTube como "No listado" o a Google Drive (compartido con la empresa) y pega aquí el link.', 400));
}
