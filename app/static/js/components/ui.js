// components/ui.js — safe DOM helpers + reusable UI components (toast, modal, drawer).
// SECURITY: el() only ever assigns textContent. User content is never inserted as HTML.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Date(value.length === 10 ? value + 'T00:00:00' : value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return value; }
}

export function fmtRelative(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
    const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 86400));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 0 && diff < 30) return `${diff}d ago`;
    return fmtDate(dateStr);
  } catch {
    return fmtDate(dateStr);
  }
}

const COMPANY_COLORS = [
  '#f97316', // Coral Orange
  '#0284c7', // Sky Blue
  '#16a34a', // Emerald Green
  '#d97706', // Amber Yellow
  '#9333ea', // Violet Purple
  '#e11d48', // Rose Pink
  '#0d9488', // Teal
  '#4f46e5', // Indigo
];

export function companyGradient(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return COMPANY_COLORS[Math.abs(hash) % COMPANY_COLORS.length];
}

const ICONS = {
  apps: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  explorer: 'M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7 M4 7c0 2.21 3.58 4 8 4s8-1.79 8-4 M4 7c0-2.21 3.58-4 8-4s8 1.79 8 4 M4 12c0 2.21 3.58 4 8 4s8-1.79 8-4',
  connections: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  plus: 'M12 5v14M5 12h14',
  copy: 'M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5L16.5 4H10a2 2 0 0 0-2 2z M16 4v4h4 M4 8v12a2 2 0 0 0 2 2h8',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
  pdf: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  check: 'M20 6L9 17l-5-5',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24 M1 1l22 22',
  expand: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  close: 'M18 6L6 18 M6 6l12 12',
  board: 'M4 4h4v16H4z M10 4h4v11h-4z M16 4h4v15h-4z',
  sparkle: 'M12 2l2.4 7.2L21.6 12l-7.2 2.4L12 21.6l-2.4-7.2L2.4 12l7.2-2.4z',
  sun: 'M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42 M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
};

export function icon(name, size = 18) {
  const d = ICONS[name] || ICONS.apps;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon-svg');
  for (const part of d.split(/\s(?=[M])/)) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', part.trim());
    svg.append(path);
  }
  return svg;
}

export function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ---------- Toasts ---------- */
export function toast(message, type = 'info', ms = 3500) {
  const host = document.getElementById('toasts');
  const t = el('div', { class: `toast ${type}`, role: 'status' }, message);
  host.append(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 250);
  }, ms);
}

/* ---------- Modal ---------- */
export function confirmModal({ title, body, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay open' });
    const close = (result) => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h2', {}, title),
      el('p', { class: 'muted' }, body),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-ghost', onclick: () => close(false) }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, confirmLabel),
      ),
    );
    overlay.append(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.getElementById('overlays').append(overlay);
    modal.querySelector('button:last-child').focus();
  });
}

/* ---------- Drawer (right side) ---------- */
const drawerState = { open: false };

export function openDrawer({ title, body, footer, onClose }) {
  closeDrawer(true); // only one drawer at a time
  const overlay = el('div', { class: 'drawer-overlay' });
  const drawer = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const header = el('div', { class: 'drawer-header' },
    el('h2', {}, title),
    el('button', {
      class: 'btn btn-ghost btn-sm', 'aria-label': 'Close drawer',
      onclick: () => requestClose(),
    }, '✕'),
  );
  const bodyWrap = el('div', { class: 'drawer-body' });
  if (body) bodyWrap.append(body);
  const footerWrap = el('div', { class: 'drawer-footer' });
  if (footer) footerWrap.append(footer);
  drawer.append(header, bodyWrap, footerWrap);
  overlay.append(drawer);
  document.getElementById('overlays').append(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); drawer.classList.add('open'); });

  let dismissed = false;
  async function requestClose(force = false) {
    if (dismissed) return;
    if (!force && onClose) {
      const ok = await onClose(); // unsaved-changes guard
      if (!ok) return;
    }
    dismissed = true;
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    setTimeout(() => { overlay.remove(); drawer.remove(); }, 230);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) requestClose(); });
  drawerState.open = true;
  return { close: requestClose, body: bodyWrap, footer: footerWrap, drawer };
}

export function closeDrawer(force = false) {
  const btn = document.querySelector('.drawer .drawer-header button');
  if (btn) btn.click();
  drawerState.open = false;
}

/* ---------- Badges, skeletons, empty states ---------- */
export function statusBadge(status) {
  return el('span', { class: `badge badge-${status || 'saved'}` }, status || 'saved');
}

export function skeletonGrid(count = 6) {
  const wrap = el('div', { class: 'company-grid', 'aria-label': 'Loading' });
  for (let i = 0; i < count; i++) wrap.append(el('div', { class: 'skeleton skeleton-card' }));
  return wrap;
}

export function emptyState({ icon = '🗂', title, hint, ctaLabel, onCta }) {
  const card = el('div', { class: 'empty-state' },
    el('div', { class: 'big' }, icon),
    el('h3', {}, title),
    hint ? el('p', { class: 'small' }, hint) : null,
  );
  if (ctaLabel) card.append(el('button', { class: 'btn btn-primary', onclick: onCta }, ctaLabel));
  return card;
}

export function errorState(message, onRetry) {
  return el('div', { class: 'empty-state' },
    el('div', { class: 'big' }, '⚠'),
    el('h3', {}, 'Something went wrong'),
    el('p', { class: 'small' }, message || 'Please try again.'),
    el('button', { class: 'btn btn-secondary', onclick: onRetry }, 'Retry'),
  );
}

/* ---------- JSON viewer with syntax coloring (built from text nodes only) ---------- */
export function jsonViewer(obj) {
  const pre = el('pre', { class: 'json-view' });
  renderJsonInto(pre, obj, 0);
  return pre;
}

function renderJsonInto(pre, value, depth) {
  const text = JSON.stringify(value, null, 2);
  for (const token of text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
    if (!token) continue;
    let cls = null;
    if (token.startsWith('"')) cls = token.trimEnd().endsWith(':') ? 'j-key' : 'j-str';
    else if (/^(true|false)$/.test(token)) cls = 'j-bool';
    else if (token === 'null') cls = 'j-null';
    else if (/^-?\d/.test(token)) cls = 'j-num';
    pre.append(cls ? el('span', { class: cls, text: token }) : document.createTextNode(token));
  }
}
