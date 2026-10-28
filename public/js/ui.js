// Utilidades de interfaz: creación de elementos, avisos, confirmaciones, Markdown seguro.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    // Las variables CSS (--algo) solo se aplican con setProperty.
    else if (k === 'style' && typeof v === 'object') for (const [prop, val] of Object.entries(v)) { if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val; }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Markdown mínimo y seguro: se escapa todo el HTML antes de aplicar formato.
export function markdown(src) {
  const inline = (t) => escapeHtml(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(); flushList();
      const lvl = Math.min(4, m[1].length + 1);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(m[1]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

let toastHost;
export function toast(message, type = 'info') {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast-${type}` }, message);
  toastHost.append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4200);
}

export function modal({ title, body, actions = [] }) {
  return new Promise((resolve) => {
    const close = (value) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => e.target === overlay && close(null) },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', {}, title),
        typeof body === 'string' ? h('p', {}, body) : body,
        h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: `btn ${a.class ?? ''}`, onclick: () => close(a.value) }, a.label)))));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.modal-actions .btn:last-child')?.focus();
  });
}

// Confirmación explícita para toda acción con consecuencia real.
export function confirmAction(title, message, confirmLabel = 'Confirmar', danger = false) {
  return modal({
    title, body: message,
    actions: [{ label: 'Cancelar', value: false, class: 'btn-ghost' }, { label: confirmLabel, value: true, class: danger ? 'btn-danger' : 'btn-primary' }],
  }).then((v) => v === true);
}

// Marca el botón como ocupado mientras corre una tarea y evita doble clic.
export async function busy(button, fn, label = 'Procesando…') {
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  button.textContent = label;
  try { return await fn(); } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.innerHTML = original;
  }
}

export function videoEmbed(url) {
  if (!url) return h('div', { class: 'empty' }, 'Esta lección aún no tiene video.');
  let m;
  if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/))) {
    return h('div', { class: 'video-frame' }, h('iframe', { src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`, allow: 'accelerometer; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, title: 'Video' }));
  }
  if ((m = url.match(/vimeo\.com\/(\d+)/))) {
    return h('div', { class: 'video-frame' }, h('iframe', { src: `https://player.vimeo.com/video/${m[1]}`, allow: 'fullscreen; picture-in-picture', allowfullscreen: true, title: 'Video' }));
  }
  if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) {
    return h('div', { class: 'video-frame' }, h('iframe', { src: `https://drive.google.com/file/d/${m[1]}/preview`, allow: 'fullscreen', allowfullscreen: true, title: 'Video' }));
  }
  return h('video', { class: 'video-native', src: url, controls: true, preload: 'metadata', playsinline: true });
}

export function confetti() {
  const colors = ['#7B00CD', '#39C2D4', '#FFC94D', '#FF6B8B', '#4ADE80'];
  const host = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 80; i++) {
    host.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDelay: `${Math.random() * 0.6}s`, transform: `rotate(${Math.random() * 360}deg)` } }));
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 2600);
}

export const SHAPES = ['▲', '◆', '●', '■'];
export const formatDate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
