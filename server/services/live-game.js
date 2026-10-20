// Juego en vivo estilo Kahoot. Estado en memoria (las partidas duran minutos);
// los resultados que importan (XP) se persisten al terminar la partida.
// Tiempo real con Server-Sent Events: no requiere dependencias ni WebSockets.
import { randomBytes, randomInt } from 'node:crypto';

const GAME_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_PLAYERS = 300;

export function createLiveGames({ onFinished = () => {}, clock = () => Date.now() } = {}) {
  const games = new Map();

  function newPin() {
    let pin;
    do { pin = String(randomInt(100000, 1000000)); } while (games.has(pin));
    return pin;
  }

  function create({ hostUserId, title, questions }) {
    if (!questions?.length) throw Object.assign(new Error('Elige un quiz con al menos una pregunta.'), { status: 400 });
    const pin = newPin();
    const game = {
      pin, title, hostUserId, hostKey: randomBytes(16).toString('hex'),
      questions, phase: 'lobby', index: -1, questionStartedAt: 0, timer: null,
      players: new Map(), answers: new Map(), subscribers: new Set(), createdAt: clock(),
    };
    games.set(pin, game);
    return { pin, hostKey: game.hostKey };
  }

  function get(pin) {
    const g = games.get(String(pin));
    if (!g) throw Object.assign(new Error('No existe una partida con ese PIN.'), { status: 404 });
    return g;
  }

  function assertHost(g, hostKey) {
    if (hostKey !== g.hostKey) throw Object.assign(new Error('Solo quien creó la partida puede controlarla.'), { status: 403 });
  }

  function join(pin, { nickname, userId = null }) {
    const g = get(pin);
    if (g.phase === 'finished') throw Object.assign(new Error('Esta partida ya terminó.'), { status: 409 });
    const name = String(nickname ?? '').trim().slice(0, 20);
    if (!name) throw Object.assign(new Error('Escribe un apodo.'), { status: 400 });
    if ([...g.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error('Ese apodo ya está en uso en esta partida.'), { status: 409 });
    }
    if (g.players.size >= MAX_PLAYERS) throw Object.assign(new Error('La partida está llena.'), { status: 409 });
    const id = randomBytes(8).toString('hex');
    const key = randomBytes(16).toString('hex');
    g.players.set(id, { id, key, name, userId, score: 0, streak: 0, lastGain: 0, lastCorrect: null });
    broadcast(g);
    return { playerId: id, playerKey: key, title: g.title };
  }

  function start(pin, hostKey) {
    const g = get(pin); assertHost(g, hostKey);
    if (g.phase !== 'lobby') throw Object.assign(new Error('La partida ya empezó.'), { status: 409 });
    if (!g.players.size) throw Object.assign(new Error('Espera a que se una al menos una persona.'), { status: 409 });
    openQuestion(g, 0);
  }

  function openQuestion(g, index) {
    g.index = index;
    g.phase = 'question';
    g.questionStartedAt = clock();
    g.answers = new Map();
    clearTimeout(g.timer);
    g.timer = setTimeout(() => reveal(g), g.questions[index].time_limit_sec * 1000 + 300);
    broadcast(g);
  }

  function answer(pin, { playerId, playerKey, choice }) {
    const g = get(pin);
    const p = g.players.get(playerId);
    if (!p || p.key !== playerKey) throw Object.assign(new Error('Jugador no válido.'), { status: 403 });
    if (g.phase !== 'question') throw Object.assign(new Error('El tiempo para responder terminó.'), { status: 409 });
    if (g.answers.has(playerId)) throw Object.assign(new Error('Ya respondiste esta pregunta.'), { status: 409 });
    const q = g.questions[g.index];
    const c = Number(choice);
    if (!Number.isInteger(c) || c < 0 || c >= q.options.length) throw Object.assign(new Error('Opción inválida.'), { status: 400 });
    const elapsed = clock() - g.questionStartedAt;
    g.answers.set(playerId, { choice: c, elapsed });
    if (g.answers.size === g.players.size) reveal(g);
    else broadcast(g);
    return { received: true };
  }

  // Puntaje: 1000 por acierto, hasta la mitad se pierde por demora; +100 por racha (máx +500).
  function scoreFor(elapsedMs, limitSec, streak) {
    const ratio = Math.min(1, elapsedMs / (limitSec * 1000));
    return Math.round(1000 * (1 - ratio / 2)) + Math.min(500, 100 * streak);
  }

  function reveal(g) {
    if (g.phase !== 'question') return;
    clearTimeout(g.timer);
    const q = g.questions[g.index];
    for (const p of g.players.values()) {
      const a = g.answers.get(p.id);
      const correct = a?.choice === q.correct_index;
      p.lastCorrect = a ? correct : null;
      if (correct) {
        p.lastGain = scoreFor(a.elapsed, q.time_limit_sec, p.streak);
        p.score += p.lastGain;
        p.streak += 1;
      } else {
        p.lastGain = 0;
        p.streak = 0;
      }
    }
    g.phase = 'reveal';
    broadcast(g);
  }

  function next(pin, hostKey) {
    const g = get(pin); assertHost(g, hostKey);
    if (g.phase === 'question') return reveal(g);
    if (g.phase === 'reveal') { g.phase = 'leaderboard'; return broadcast(g); }
    if (g.phase === 'leaderboard') {
      if (g.index + 1 < g.questions.length) return openQuestion(g, g.index + 1);
      return finish(g);
    }
    throw Object.assign(new Error('No hay un siguiente paso en este momento.'), { status: 409 });
  }

  function finish(g) {
    clearTimeout(g.timer);
    g.phase = 'finished';
    broadcast(g);
    try { onFinished({ title: g.title, ranking: ranking(g) }); } catch (err) { console.error('Error guardando resultados del juego', err); }
  }

  function end(pin, hostKey) {
    const g = get(pin); assertHost(g, hostKey);
    if (g.phase !== 'finished') finish(g);
  }

  function ranking(g) {
    return [...g.players.values()].sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, userId: p.userId, streak: p.streak }));
  }

  // Cada rol recibe solo lo que debe ver: el jugador nunca recibe la respuesta
  // correcta mientras la pregunta está abierta.
  function viewFor(g, sub) {
    const q = g.questions[g.index];
    const base = {
      pin: g.pin, title: g.title, phase: g.phase, index: g.index, total: g.questions.length,
      player_count: g.players.size, answered: g.answers.size,
      remaining_ms: g.phase === 'question' ? Math.max(0, q.time_limit_sec * 1000 - (clock() - g.questionStartedAt)) : 0,
    };
    if (q && g.phase !== 'lobby') {
      base.question = { prompt: q.prompt, options: q.options, time_limit_sec: q.time_limit_sec };
      if (g.phase !== 'question') {
        base.question.correct_index = q.correct_index;
        base.question.explanation = q.explanation;
        base.distribution = q.options.map((_, i) => [...g.answers.values()].filter((a) => a.choice === i).length);
      }
    }
    const rank = ranking(g);
    if (sub.role === 'host') {
      base.players = [...g.players.values()].map((p) => p.name);
      if (['leaderboard', 'finished', 'reveal'].includes(g.phase)) base.ranking = rank.slice(0, g.phase === 'finished' ? 10 : 5).map(({ rank: r, name, score }) => ({ rank: r, name, score }));
    } else {
      const p = g.players.get(sub.playerId);
      if (p) {
        const mine = rank.find((r) => r.id === p.id);
        base.me = {
          name: p.name, score: p.score, rank: mine?.rank, streak: p.streak,
          answered: g.answers.has(p.id), last_correct: g.phase === 'question' ? null : p.lastCorrect, last_gain: p.lastGain,
        };
        if (g.phase === 'finished') base.ranking = rank.slice(0, 3).map(({ rank: r, name, score }) => ({ rank: r, name, score }));
      }
    }
    return base;
  }

  function broadcast(g) {
    for (const sub of g.subscribers) sub.send(viewFor(g, sub));
  }

  function subscribe(pin, { role, hostKey, playerId, playerKey }, send) {
    const g = get(pin);
    if (role === 'host') assertHost(g, hostKey);
    else {
      const p = g.players.get(playerId);
      if (!p || p.key !== playerKey) throw Object.assign(new Error('Jugador no válido.'), { status: 403 });
    }
    const sub = { role, playerId, send };
    g.subscribers.add(sub);
    send(viewFor(g, sub));
    return () => g.subscribers.delete(sub);
  }

  function sweep() {
    for (const [pin, g] of games) {
      if (clock() - g.createdAt > GAME_TTL_MS) { clearTimeout(g.timer); games.delete(pin); }
    }
  }

  return { create, join, start, answer, next, end, subscribe, sweep, scoreFor, _games: games };
}
