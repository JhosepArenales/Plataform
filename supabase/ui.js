// Ajustes de interfaz de la versión con Supabase: entrada sin capa de ingreso
// (para pruebas; al publicar con el Plataform Deployer, el Deployer pone su propio
// acceso), acceso con contraseña para cuentas existentes en #/acceso-demo, y videos
// por link en lugar de subir archivos.

const AUTH_ERRORS = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/already registered|already been registered|already exists/i, 'Ese correo ya tiene una cuenta. Ingresa con tu contraseña.'],
  [/database error saving new user|solo se permiten correos/i, `Solo pueden entrar las cuentas @${ACADEMIA_CONFIG.domain}.`],
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
  const help = h('p', { class: 'small muted center' }, 'Acceso para cuentas con contraseña (administración y pruebas). ', h('a', { href: '#/login' }, 'Volver al inicio'));
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

// Entrada sin capa de ingreso: la primera vez solo pregunta el nombre y registra la
// llave de este navegador; después entra directo. No usa correo ni contraseña.
function renderLogin() {
  const status = h('div', { class: 'stack center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Abriendo la Academia…'));
  const card = h('div', { class: 'login-card card' },
    h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')), status);
  const enter = async () => {
    try { localStorage.setItem('academia.registrado', '1'); } catch { /* sin almacenamiento */ }
    session.token = 'supabase';
    afterLogin((await api('/api/me')).user);
  };
  const askName = (message) => {
    const name = h('input', { name: 'name', required: true, minlength: 2, maxlength: 60, autocomplete: 'name', placeholder: 'Nombre y apellido', 'aria-label': 'Tu nombre' });
    const go = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Empezar');
    const form = h('form', { class: 'stack' },
      h('h1', {}, '¡Bienvenido! 👋'),
      h('p', { class: 'muted' }, 'Tu espacio para aprender todo lo que necesitas en tus primeros días.'),
      message && h('p', { class: 'login-error' }, message),
      h('label', { class: 'field' }, '¿Cómo te llamas?', name),
      go,
      h('a', { href: '#/jugar', class: 'link-center' }, '¿Tienes un PIN de juego? Únete aquí'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return toast('Escribe tu nombre.', 'error');
      try {
        await busy(go, async () => {
          await rpc('app_guest_join', { p_name: name.value.trim(), p_token: deviceToken });
          await enter();
        }, 'Entrando…');
      } catch (err) { toast(err.message, 'error'); }
    });
    status.replaceChildren(form);
    name.focus();
  };
  (async () => {
    // Con sesión (cuentas con contraseña) o con la llave ya registrada, entra directo.
    const { error } = await sb.rpc('app_me');
    if (!error) {
      try { return await enter(); } catch (err) { return askName(err.message); }
    }
    askName(error.code && !/^PT401$|^42501$/.test(error.code) ? 'No pudimos conectar con la Academia. Recarga la página.' : null);
  })();
  return h('div', { class: 'login-wrap' }, card);
}

const ext = (globalThis.ACADEMIA_EXT ??= { routes: [], navLinks: [], adminTabs: [] });
ext.routes.push({ re: /^\/acceso-demo$/, view: renderPasswordLogin, public: true, bare: true });
// Sin capa de ingreso no hay "Salir": cerrar sesión crearía otra persona al volver.
ext.hideLogout = true;

// En esta versión los videos se agregan con un link.
function uploadWithProgress() {
  return Promise.reject(new ApiError('Por ahora los videos se agregan con un link: súbelo a YouTube como "No listado" o a Google Drive (compartido con la empresa) y pega aquí el link.', 400));
}
