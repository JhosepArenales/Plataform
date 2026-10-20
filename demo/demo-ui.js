// Ajustes de interfaz exclusivos de la demostración. Se insertan entre el
// código real de public/js (ver demo/build.mjs) y reemplazan solo lo que
// en un navegador sin servidor no puede funcionar igual.

// Subida de video: en la demo el archivo queda en memoria del navegador.
function uploadWithProgress(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const file = form.get('video');
    if (!file) return reject(new ApiError('Selecciona un video.', 400));
    if (!/\.(mp4|webm|mov|m4v|ogg)$/i.test(file.name)) return reject(new ApiError('Formato de video no soportado. Usa MP4, WebM o MOV.', 415));
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(100, p + 12 + Math.random() * 18);
      onProgress?.(Math.round(p));
      if (p >= 100) { clearInterval(iv); resolve({ url: URL.createObjectURL(file), size: file.size, name: file.name }); }
    }, 120);
  });
}

const DEMO_VIDEOS = {
  'demo:bienvenida': { title: 'Bienvenida del gerente general', scenes: ['Hola y bienvenido a Plataform 👋', 'Ayudamos a las empresas a operar mejor', 'Cliente primero · Simple antes que complejo', 'Medimos antes de cambiar', '¡Nos alegra que estés aquí!'] },
  'demo:negociacion': { title: 'Negociar no es ganar: es acordar', scenes: ['¿Qué necesita realmente el cliente? 🤔', 'Escucha antes de proponer', 'Una objeción es una pregunta disfrazada', 'Precio y alcance se mueven juntos', '¡Cierra acuerdos que convienen a ambos!'] },
  'demo:phishing': { title: 'Cómo reconocer un correo de phishing', scenes: ['¿Ese correo es real? 🎣', 'Señal 1: remitente extraño', 'Señal 2: urgencia artificial', 'Señal 3: enlaces que no coinciden', 'Ante la duda: repórtalo a Tecnología'] },
};

// Reproductor simulado: el visor no permite incrustar YouTube ni Vimeo.
function simulatedPlayer({ title, scenes, externalUrl }) {
  const caption = h('div', { class: 'demo-video-caption' }, title);
  const bar = h('div', { class: 'demo-video-bar' }, h('span'));
  const playBtn = h('button', { class: 'demo-video-play', type: 'button', 'aria-label': 'Reproducir' }, '▶');
  const root = h('div', { class: 'demo-video' },
    h('div', { class: 'demo-video-stage' }, caption, playBtn),
    bar,
    h('div', { class: 'demo-video-foot' },
      h('span', {}, externalUrl ? 'Vista previa de la demostración. En la plataforma instalada el video se reproduce aquí.' : 'Video de ejemplo para la demostración'),
      externalUrl && h('a', { href: externalUrl, target: '_blank', rel: 'noopener' }, 'Abrir original ↗')));
  let timer = null;
  playBtn.addEventListener('click', () => {
    if (timer) return;
    playBtn.hidden = true;
    const total = 9000;
    const t0 = Date.now();
    timer = setInterval(() => {
      const ratio = Math.min(1, (Date.now() - t0) / total);
      bar.firstChild.style.width = `${ratio * 100}%`;
      caption.textContent = scenes[Math.min(scenes.length - 1, Math.floor(ratio * scenes.length))];
      if (ratio >= 1) {
        clearInterval(timer); timer = null;
        playBtn.hidden = false; playBtn.textContent = '↺';
        root.dispatchEvent(new Event('ended'));
      }
    }, 100);
  });
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
  return root;
}

function videoEmbed(url) {
  if (!url) return h('div', { class: 'empty' }, 'Esta lección aún no tiene video.');
  if (DEMO_VIDEOS[url]) return simulatedPlayer(DEMO_VIDEOS[url]);
  if (url.startsWith('blob:')) {
    const v = videoEmbedReal(url);
    v.addEventListener('error', () => v.replaceWith(h('div', { class: 'empty' }, 'Los videos subidos en la demostración solo se guardan mientras la página está abierta. Vuelve a subirlo desde el editor.')));
    return v;
  }
  if (/youtu\.?be|vimeo\.com|drive\.google\.com/.test(url)) {
    return simulatedPlayer({ title: 'Video enlazado', scenes: ['Reproduciendo video enlazado…', 'En la versión instalada verás aquí el video real', '¡Listo! Video completado'], externalUrl: url });
  }
  return videoEmbedReal(url);
}

// Pantalla del juego + celular de prueba al lado.
function renderHost(pin) {
  const screen = renderHostBase(pin);
  const phoneBody = h('div', { class: 'demo-phone-body' });
  const nick = h('input', { class: 'pin-input', maxlength: 20, value: session.user?.name.split(' ')[0] ?? 'Yo', 'aria-label': 'Tu apodo' });
  const joinBtn = h('button', { class: 'btn btn-primary btn-block' }, 'Unirme a la partida');
  joinBtn.addEventListener('click', async () => {
    try {
      const r = await busy(joinBtn, () => api(`/api/games/${pin}/join`, { method: 'POST', body: { nickname: nick.value } }), 'Entrando…');
      phoneBody.replaceChildren(playerScreen({ pin, ...r, nickname: nick.value }));
    } catch (err) { toast(err.message, 'error'); }
  });
  const remoteNote = h('p', { class: 'demo-phone-note' }, 'Participantes simulados se unen y responden solos.');
  demo.roomAvailable().then((ok) => {
    if (ok) remoteNote.textContent = 'Tu equipo también puede jugar desde su celular: compárteles el link de esta demostración agregando #jugar al final, y que ingresen este PIN.';
  });
  phoneBody.append(h('div', { class: 'game-bg player demo-join' },
    h('div', { class: 'big-emoji' }, '📱'), h('h2', {}, 'Juega tú también'), h('p', {}, `PIN ${pin}`), nick, joinBtn));
  const phone = h('aside', { class: 'demo-phone', 'aria-label': 'Celular de prueba' },
    h('div', { class: 'demo-phone-head' }, h('span', {}, 'Tu celular (simulado)'),
      h('button', { class: 'icon-btn', 'aria-label': 'Minimizar', onclick: () => phone.classList.toggle('min') }, '–')),
    h('div', { class: 'demo-phone-frame' }, phoneBody), remoteNote);
  return h('div', { class: 'demo-host' }, screen, phone);
}

// Pantalla del participante con la explicación de la partida de práctica.
function renderJoin(pin) {
  const view = renderJoinBase(pin);
  const card = view.querySelector('.join-card');
  if (!card) return view;
  const note = demo.isPractice(pin)
    ? h('div', { class: 'demo-note' }, h('strong', {}, 'Así lo ve cada participante en su celular. '),
      'Creamos una partida de práctica: el PIN ya está escrito. Pulsa Entrar y juega contra 5 compañeros simulados; la partida avanza sola.')
    : h('div', { class: 'demo-note' }, h('strong', {}, '¿No tienes un PIN? '),
      h('button', { class: 'linklike', type: 'button', onclick: () => { location.hash = `#/jugar/${demo.startPracticeGame().pin}`; } }, 'Crea una partida de práctica'),
      ' o, desde Administración, lanza un "Juego en vivo" de cualquier curso.');
  card.prepend(note);
  return view;
}

// Barra superior de la demostración: cambiar de perfil y reiniciar.
function mountDemoBar() {
  const asRole = async (email, target, opts) => {
    const r = demo.loginAs(email, opts);
    session.token = r.token;
    session.user = r.user;
    if (location.hash === target) router(); else location.hash = target;
  };
  const bar = h('div', { class: 'demo-bar', role: 'region', 'aria-label': 'Demostración' },
    h('span', { class: 'demo-pill' }, 'Demostración interactiva'),
    h('span', { class: 'demo-label' }, 'Ver como:'),
    h('button', { class: 'demo-btn', onclick: () => asRole('andrea.torres@plataform.com', '#/area', { resetArea: true }) }, '🧑‍🎓 Persona nueva'),
    h('button', { class: 'demo-btn', onclick: () => asRole('ana.gomez@plataform.com', '#/admin') }, '🛠️ Administradora'),
    h('button', { class: 'demo-btn', onclick: () => {
      try { sessionStorage.removeItem('academia.player'); } catch { /* sin almacenamiento */ }
      location.hash = `#/jugar/${demo.startPracticeGame().pin}`;
    } }, '📱 Participante'),
    h('button', { class: 'demo-btn ghost', onclick: async () => {
      if (!await confirmAction('Reiniciar demostración', 'Se borran los cambios que hiciste y vuelven los cursos y personas de ejemplo.', 'Reiniciar', true)) return;
      demo.reset(); session.token = null; session.user = null;
      if (location.hash === '#/login') router(); else location.hash = '#/login';
    } }, 'Reiniciar'));
  document.body.prepend(bar);
}

// Un link compartido llega con #jugar (el visor solo conserva anclas simples).
if (location.hash === '#jugar' || location.hash.startsWith('#jugar')) {
  try { history.replaceState(null, '', '#/jugar'); } catch { location.hash = '#/jugar'; }
}
mountDemoBar();
