import { api, session } from '../api.js';
import { h, toast, busy, confetti, confirmAction, SHAPES } from '../ui.js';

const PLAYER_KEY = 'academia.player';
const hostKeyFor = (pin) => { try { return sessionStorage.getItem(`academia.host.${pin}`); } catch { return null; } };
export const rememberHost = (pin, key) => { try { sessionStorage.setItem(`academia.host.${pin}`, key); } catch { /* sin almacenamiento */ } };

// Conexión SSE que se cierra sola cuando el usuario sale de la pantalla.
function connect(url, onData, onFatal) {
  const es = new EventSource(url);
  let gotData = false;
  es.onmessage = (e) => { gotData = true; onData(JSON.parse(e.data)); };
  es.onerror = () => {
    // Si nunca llegó un estado, el PIN o la llave no son válidos: no reintentar en bucle.
    if (!gotData) { es.close(); onFatal(); }
  };
  const stop = () => { es.close(); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);
  return stop;
}

// ---------- Jugador ----------
export function renderJoin(pinFromUrl) {
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(PLAYER_KEY)); } catch { return null; } })();
  if (saved && (!pinFromUrl || saved.pin === pinFromUrl)) return playerScreen(saved);

  const form = h('form', { class: 'join-card' },
    h('div', { class: 'big-emoji' }, '🎮'),
    h('h1', {}, '¡A jugar!'),
    h('input', { class: 'pin-input', name: 'pin', inputmode: 'numeric', pattern: '\\d{6}', maxlength: 6, placeholder: 'PIN del juego', required: true, value: pinFromUrl ?? '', 'aria-label': 'PIN del juego' }),
    h('input', { class: 'pin-input', name: 'nickname', maxlength: 20, placeholder: 'Tu apodo', required: true, value: session.user?.name.split(' ')[0] ?? '', 'aria-label': 'Tu apodo' }),
    h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Entrar'),
    h('a', { href: '#/', class: 'link-center light' }, '← Volver a la Academia'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { pin, nickname } = Object.fromEntries(new FormData(form));
    try {
      const r = await busy(form.querySelector('button'), () => api(`/api/games/${pin}/join`, { method: 'POST', body: { nickname } }), 'Entrando…');
      const player = { pin, ...r, nickname };
      sessionStorage.setItem(PLAYER_KEY, JSON.stringify(player));
      form.parentElement.replaceWith(playerScreen(player));
    } catch (err) { toast(err.message, 'error'); }
  });
  return h('div', { class: 'game-bg' }, form);
}

function playerScreen(player) {
  const root = h('div', { class: 'game-bg player' });
  let lastPhase = '';
  const leave = () => { sessionStorage.removeItem(PLAYER_KEY); location.hash = '#/jugar'; location.reload(); };

  const paint = (s) => {
    const header = h('div', { class: 'player-top' }, h('span', {}, s.me?.name ?? player.nickname), h('span', {}, `${s.me?.score ?? 0} pts`));
    let content;
    if (s.phase === 'lobby') {
      content = h('div', { class: 'center-msg' }, h('div', { class: 'big-emoji' }, '✅'), h('h2', {}, '¡Estás dentro!'), h('p', {}, '¿Ves tu apodo en la pantalla? Espera a que empiece el juego.'));
    } else if (s.phase === 'question' && !s.me?.answered) {
      content = h('div', { class: 'player-answers' }, s.question.options.map((opt, k) => h('button', {
        class: `answer answer-${k} big`, 'aria-label': opt,
        onclick: async (e) => {
          root.querySelectorAll('.answer').forEach((b) => { b.disabled = true; if (b !== e.currentTarget) b.classList.add('dim'); });
          try { await api(`/api/games/${player.pin}/answer`, { method: 'POST', body: { playerId: player.playerId, playerKey: player.playerKey, choice: k } }); } catch (err) { toast(err.message, 'error'); }
        },
      }, h('span', { class: 'shape' }, SHAPES[k]), h('span', { class: 'opt-text' }, opt))));
    } else if (s.phase === 'question') {
      content = h('div', { class: 'center-msg' }, h('div', { class: 'big-emoji spin' }, '⏳'), h('h2', {}, '¡Respuesta enviada!'), h('p', {}, '¿Habrás acertado?'));
    } else if (s.phase === 'reveal' || s.phase === 'leaderboard') {
      const ok = s.me?.last_correct;
      content = h('div', { class: `center-msg result ${ok ? 'ok' : 'bad'}` },
        h('div', { class: 'big-emoji' }, ok ? '🎉' : ok === false ? '😬' : '⌛'),
        h('h2', {}, ok ? '¡Correcto!' : ok === false ? 'Incorrecto' : 'Se acabó el tiempo'),
        ok && h('p', { class: 'gain' }, `+${s.me.last_gain}`),
        s.me?.streak > 1 && h('p', {}, `🔥 Racha de ${s.me.streak}`),
        h('p', {}, `Vas en el puesto #${s.me?.rank ?? '-'}`));
    } else if (s.phase === 'finished') {
      if (lastPhase !== 'finished' && s.me?.rank <= 3) confetti();
      content = h('div', { class: 'center-msg' },
        h('div', { class: 'big-emoji' }, ['🥇', '🥈', '🥉'][s.me?.rank - 1] ?? '🏁'),
        h('h2', {}, `Terminaste en el puesto #${s.me?.rank}`), h('p', {}, `${s.me?.score} puntos`),
        session.user ? h('p', { class: 'small' }, 'Tus puntos de experiencia se sumaron a tu perfil.') : h('p', { class: 'small' }, 'Ingresa a la Academia para acumular XP en tus próximas partidas.'),
        h('button', { class: 'btn btn-light', onclick: leave }, 'Jugar otra partida'));
    }
    lastPhase = s.phase;
    root.replaceChildren(header, content ?? h('div'));
  };

  connect(`/api/games/${player.pin}/events?role=player&playerId=${player.playerId}&playerKey=${player.playerKey}`, paint, () => {
    sessionStorage.removeItem(PLAYER_KEY);
    root.replaceChildren(h('div', { class: 'center-msg' }, h('h2', {}, 'Esta partida ya no está disponible.'), h('a', { class: 'btn btn-light', href: '#/jugar', onclick: () => setTimeout(() => location.reload()) }, 'Ingresar otro PIN')));
  });
  root.append(h('div', { class: 'center-msg' }, h('div', { class: 'spinner light' })));
  return root;
}

// ---------- Anfitrión (pantalla proyectada) ----------
export function renderHost(pin) {
  const hostKey = hostKeyFor(pin);
  const root = h('div', { class: 'game-bg host' });
  if (!hostKey) {
    root.append(h('div', { class: 'center-msg' }, h('h2', {}, 'Esta partida se abrió en otra ventana.'), h('a', { class: 'btn btn-light', href: '#/admin/cursos' }, 'Volver')));
    return root;
  }
  let timerHandle;
  let lastPhase = '';
  const control = (action, label) => h('button', { class: 'btn btn-light btn-lg', onclick: async (e) => {
    try { await busy(e.currentTarget, () => api(`/api/games/${pin}/${action}`, { method: 'POST', body: { hostKey } })); } catch (err) { toast(err.message, 'error'); }
  } }, label);
  const endBtn = () => h('button', { class: 'btn btn-ghost-light btn-sm', onclick: async () => {
    if (!await confirmAction('Terminar partida', '¿Terminar ahora? Se mostrará el podio con los puntajes actuales.', 'Terminar', true)) return;
    try { await api(`/api/games/${pin}/end`, { method: 'POST', body: { hostKey } }); } catch (err) { toast(err.message, 'error'); }
  } }, 'Terminar');

  const paint = (s) => {
    clearInterval(timerHandle);
    let content;
    const joinUrl = `${location.origin}${location.pathname}#/jugar/${pin}`;
    if (s.phase === 'lobby') {
      content = h('div', { class: 'lobby' },
        h('p', {}, 'Entra a ', h('b', {}, `${location.host}${location.pathname}#/jugar`), ' e ingresa el PIN'),
        h('div', { class: 'pin-big' }, pin.replace(/(\d{3})(\d{3})/, '$1 $2')),
        h('button', { class: 'btn btn-ghost-light btn-sm', onclick: () => navigator.clipboard?.writeText(joinUrl).then(() => toast('Link copiado', 'success')) }, '📋 Copiar link directo'),
        h('h2', {}, `${s.player_count} ${s.player_count === 1 ? 'jugador' : 'jugadores'}`),
        h('div', { class: 'player-cloud' }, s.players.map((n) => h('span', { class: 'pop' }, n))),
        control('start', '▶ Empezar'));
    } else if (s.phase === 'question' || s.phase === 'reveal') {
      const reveal = s.phase === 'reveal';
      const maxVotes = Math.max(1, ...(s.distribution ?? [1]));
      const timer = h('div', { class: 'timer' }, Math.ceil(s.remaining_ms / 1000));
      if (!reveal) {
        const endAt = Date.now() + s.remaining_ms;
        timerHandle = setInterval(() => { timer.textContent = Math.max(0, Math.ceil((endAt - Date.now()) / 1000)); }, 250);
      }
      content = h('div', { class: 'host-question' },
        h('div', { class: 'hq-top' }, h('span', {}, `${s.index + 1} / ${s.total}`), !reveal && timer, h('span', {}, `${s.answered} respuestas`)),
        h('h1', {}, s.question.prompt),
        reveal && h('div', { class: 'bars' }, s.question.options.map((_, k) => h('div', { class: `bar answer-${k} ${k === s.question.correct_index ? 'win' : ''}` },
          h('span', { class: 'bar-fill', style: { height: `${(s.distribution[k] / maxVotes) * 100}%` } }), h('b', {}, `${SHAPES[k]} ${s.distribution[k]}`)))),
        h('div', { class: 'answer-grid' }, s.question.options.map((opt, k) => h('div', {
          class: `answer answer-${k} ${reveal ? (k === s.question.correct_index ? 'correct' : 'dim') : ''}`,
        }, h('span', { class: 'shape' }, SHAPES[k]), h('span', {}, opt), reveal && k === s.question.correct_index && h('span', { class: 'check' }, '✔')))),
        reveal && s.question.explanation && h('p', { class: 'explanation' }, `💡 ${s.question.explanation}`),
        h('div', { class: 'host-controls' }, control('next', reveal ? 'Ver ranking →' : 'Mostrar respuesta')));
    } else if (s.phase === 'leaderboard') {
      content = h('div', { class: 'host-board' },
        h('h1', {}, 'Ranking'),
        h('ol', {}, s.ranking.map((r) => h('li', {}, h('span', {}, r.name), h('b', {}, r.score)))),
        h('div', { class: 'host-controls' }, control('next', s.index + 1 < s.total ? 'Siguiente pregunta →' : 'Ver podio 🏆')));
    } else {
      if (lastPhase !== 'finished') confetti();
      const [first, second, third] = s.ranking;
      const step = (r, cls, medal) => r && h('div', { class: `podium-step ${cls}` }, h('span', { class: 'medal' }, medal), h('strong', {}, r.name), h('span', {}, `${r.score} pts`));
      content = h('div', { class: 'host-board' },
        h('h1', {}, '🏆 Podio'),
        h('div', { class: 'podium' }, step(second, 'second', '🥈'), step(first, 'first', '🥇'), step(third, 'third', '🥉')),
        h('a', { class: 'btn btn-light', href: '#/admin/cursos' }, 'Volver a la administración'));
    }
    lastPhase = s.phase;
    root.replaceChildren(h('div', { class: 'host-head' }, h('span', {}, `🎮 ${s.title}`), s.phase !== 'finished' && endBtn()), content);
  };

  const stop = connect(`/api/games/${pin}/events?role=host&hostKey=${hostKey}`, paint, () => {
    root.replaceChildren(h('div', { class: 'center-msg' }, h('h2', {}, 'La partida ya no existe.'), h('a', { class: 'btn btn-light', href: '#/admin/cursos' }, 'Volver')));
  });
  window.addEventListener('hashchange', () => { clearInterval(timerHandle); stop(); }, { once: true });
  root.append(h('div', { class: 'center-msg' }, h('div', { class: 'spinner light' })));
  return root;
}
