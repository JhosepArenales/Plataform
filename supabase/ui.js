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

// Entrada sin capa de ingreso: la primera vez solo pregunta el nombre y crea por
// detrás una cuenta propia de este navegador (correo interno invitado.xxxx@ y clave
// aleatoria guardados aquí); las siguientes veces entra directo.
const GUEST_KEY = 'academia.invitado';
const readGuest = () => { try { return JSON.parse(localStorage.getItem(GUEST_KEY)); } catch { return null; } };

function renderLogin() {
  const status = h('div', { class: 'stack center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Abriendo la Academia…'));
  const card = h('div', { class: 'login-card card' },
    h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, 'P'), h('span', {}, 'Academia')), status);
  const enter = async () => {
    session.token = 'supabase';
    afterLogin((await api('/api/me')).user);
  };
  // Entra con la cuenta guardada de este navegador; si aún no existe, la crea.
  const enterAsGuest = async (guest) => {
    let { error } = await sb.auth.signInWithPassword({ email: guest.email, password: guest.password });
    if (error && /invalid login credentials/i.test(error.message)) {
      const created = await sb.auth.signUp({ email: guest.email, password: guest.password, options: { data: { name: guest.name } } });
      if (created.error) throw new Error(authMessage(created.error));
      if (created.data.session) return enter();
      error = { message: 'Email not confirmed' };
    }
    if (error && /email not confirmed/i.test(error.message)) {
      throw new Error('Falta un ajuste en Supabase: desactiva "Confirm email" (Authentication → Sign In / Providers → Email) y vuelve a intentar.');
    }
    if (error) throw new Error(authMessage(error));
    return enter();
  };
  const askName = (message, value = '') => {
    const name = h('input', { name: 'name', required: true, minlength: 2, maxlength: 60, autocomplete: 'name', placeholder: 'Nombre y apellido', 'aria-label': 'Tu nombre', value });
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
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      const guest = {
        email: `invitado.${crypto.randomUUID().slice(0, 12)}@${ACADEMIA_CONFIG.domain}`,
        password: btoa(String.fromCharCode(...bytes)),
        ...readGuest(),
        name: name.value.trim(),
      };
      // Se guarda antes de crear la cuenta: si algo falla, el siguiente intento usa la misma.
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(guest)); } catch { /* sin almacenamiento: se pedirá el nombre de nuevo */ }
      try { await busy(go, () => enterAsGuest(guest), 'Entrando…'); } catch (err) { askName(err.message, guest.name); }
    });
    status.replaceChildren(form);
    name.focus();
  };
  (async () => {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) return await enter();
      const saved = readGuest();
      if (saved) return await enterAsGuest(saved);
      askName();
    } catch (err) { askName(err.message, readGuest()?.name ?? ''); }
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
