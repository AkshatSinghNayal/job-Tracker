// main.js — hash router, app shell, keyboard shortcuts.
import { api, getToken, clearToken } from './api.js';
import { setState, store, subscribe } from './store.js';
import { el, toast, icon } from './components/ui.js';
import { renderLogin } from './views/login.js';
import { renderApplications, openNewApplicationDrawer } from './views/applications.js';
import { renderApplicationDetail } from './views/detail.js';
import { renderExplorer } from './views/explorer.js';
import { renderConnections } from './views/connections.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
let currentView = null;
let shellBuilt = false;

const routes = [
  { pattern: /^#\/login$/, view: renderLogin, public: true },
  { pattern: /^#\/apps\/([\w-]+)$/, view: (host, m) => renderApplicationDetail(host, m[1]) },
  { pattern: /^#\/apps$/, view: (host) => renderApplications(host) },
  { pattern: /^#\/settings$/, view: renderSettings },
];

function buildShell() {
  if (shellBuilt) return;
  shellBuilt = true;
}

async function route() {
  const hash = location.hash || '#/apps';
  let matched = null;
  for (const r of routes) {
    const m = hash.match(r.pattern);
    if (m) { matched = { r, m }; break; }
  }
  if (!matched) { location.hash = '#/apps'; return; }
  const { r, m } = matched;

  // Cleanup previous view (revoke blob URLs etc.)
  if (currentView && currentView.destroy) currentView.destroy();
  currentView = null;

  if (!r.public && !getToken()) {
    // try silent refresh before bouncing to login
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const { setToken } = await import('./api.js');
      setToken(data.access_token);
    } catch {
      if (hash !== '#/login') { location.hash = '#/login'; return; }
    }
  }
  if (r.public && getToken() && hash === '#/login') { location.hash = '#/apps'; return; }

  if (!r.public) buildShell();
  const container = r.public ? app : withShell(app);
  container.innerHTML = '';
  currentView = r.view(container, m) || null;
}

function withShell(appRoot) {
  if (!document.getElementById('shell-root')) {
    appRoot.innerHTML = '';
    appRoot.append(shellEl());
  }
  return document.getElementById('view-root');
}

function shellEl() {
  const nav = [
    { href: '#/apps', label: 'Applications', iconName: 'apps' },
    { href: '#/settings', label: 'Settings', iconName: 'settings' },
  ];
  const links = nav.map((n) => el('a', {
    class: 'nav-link', href: n.href, 'data-nav': n.label,
    onclick: () => { /* hashchange handles routing */ },
  }, icon(n.iconName, 17), el('span', { class: 'nav-label' }, n.label)));

  const searchInput = el('input', {
    class: 'input', id: 'global-search', type: 'search',
    placeholder: 'Search applications…', 'aria-label': 'Search applications',
  });
  searchInput.addEventListener('input', debounceSearch());

  const getTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
  const themeToggle = el('button', {
    class: 'btn btn-secondary btn-sm theme-btn',
    'aria-label': 'Toggle dark / light theme',
    title: 'Toggle theme (Light / Dark)',
    onclick: () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('jt_theme', next);
      updateThemeIcon();
      toast(`Switched to ${next} mode`, 'info', 1500);
    },
  });

  const updateThemeIcon = () => {
    themeToggle.innerHTML = '';
    const isDark = getTheme() === 'dark';
    themeToggle.append(icon(isDark ? 'sun' : 'moon', 15), el('span', { class: 'theme-btn-label' }, isDark ? 'Light' : 'Dark'));
  };
  updateThemeIcon();

  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'search' },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, icon('search', 16)),
      searchInput,
      el('span', { class: 'hint' }, el('kbd', { class: 'kbd' }, '/')),
    ),
    el('div', { class: 'topbar-right row', style: { gap: '10px' } },
      themeToggle,
      (() => {
        const btn = el('button', {
          class: 'btn btn-primary', id: 'btn-new-app',
          title: 'New application (click or drop a resume PDF here)',
          onclick: () => openNewApplicationDrawer(loadApplications),
        }, icon('plus', 16), 'New application');

        btn.addEventListener('dragover', (e) => {
          if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        });
        btn.addEventListener('drop', (e) => {
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            openNewApplicationDrawer(loadApplications, null, 'saved', e.dataTransfer.files[0]);
          }
        });
        return btn;
      })(),
    ),
  );

  const sidebar = el('nav', { class: 'sidebar', 'aria-label': 'Main navigation' },
    el('div', { class: 'brand' },
      el('div', { class: 'logo-mark', 'aria-hidden': 'true' },
        el('img', { src: '/static/img/cat-logo.svg', alt: 'JobTracker Cat Logo', style: { width: '100%', height: '100%', objectFit: 'contain' } }),
      ),
      el('span', { class: 'name' }, 'JobTracker'),
    ),
    ...links,
    el('div', { class: 'spacer' }),
    el('div', { class: 'foot-note' }, el('kbd', { class: 'kbd' }, 'n'), ' new · ', el('kbd', { class: 'kbd' }, '/'), ' search'),
  );

  const shell = el('div', { class: 'shell', id: 'shell-root' },
    sidebar,
    el('div', { class: 'main' }, topbar, el('main', { class: 'content', id: 'view-root' })),
  );
  return shell;
}

function debounceSearch() {
  let timer;
  return (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const evt = new CustomEvent('app:search', { detail: e.target.value });
      document.dispatchEvent(evt);
    }, 250);
  };
}

async function loadApplications() {
  const evt = new CustomEvent('app:reload');
  document.dispatchEvent(evt);
}

function setActiveNav() {
  const hash = location.hash || '#/apps';
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
}

/* Keyboard shortcuts: "/" focus search, "n" new application, "Esc" closes overlays */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') {
    const modalOpen = document.querySelector('.modal-overlay');
    if (!modalOpen) {
      const closeBtn = document.querySelector('.drawer .drawer-header button');
      if (closeBtn) closeBtn.click();
    }
    return;
  }
  if (typing) return;
  if (e.key === '/') {
    const search = document.getElementById('global-search');
    if (search) { e.preventDefault(); search.focus(); }
  } else if (e.key === 'n' && (location.hash === '#/apps' || location.hash === '')) {
    e.preventDefault();
    openNewApplicationDrawer(loadApplications);
  }
});

window.addEventListener('auth:expired', () => {
  clearToken();
  toast('Session expired — please sign in again', 'error');
  location.hash = '#/login';
});

window.addEventListener('hashchange', () => { setActiveNav(); route(); });

route();
setActiveNav();
