// views/login.js — Neo-Brutalist Educational Platform Auth Screen
// Features: Sign in & private registration, theme toggle, product showcase, zero credential disclosure.
import { login, register } from '../api.js';
import { setState } from '../store.js';
import { el, toast, icon } from '../components/ui.js';

export function renderLogin(host) {
  let isRegister = false;
  let shown = false;

  // Dark / Light Theme helper
  const getTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
  const themeBtn = el('button', {
    class: 'btn btn-secondary btn-sm theme-btn',
    type: 'button',
    'aria-label': 'Toggle theme (Light / Dark)',
    title: 'Toggle theme',
    onclick: () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('jt_theme', next);
      updateThemeBtn();
      toast(`Switched to ${next} mode`, 'info', 1500);
    },
  });

  const updateThemeBtn = () => {
    themeBtn.innerHTML = '';
    const isDark = getTheme() === 'dark';
    themeBtn.append(
      icon(isDark ? 'sun' : 'moon', 15),
      el('span', { class: 'theme-btn-label' }, isDark ? 'Light' : 'Dark'),
    );
  };
  updateThemeBtn();

  // Header Bar
  const header = el('header', { class: 'auth-header' },
    el('div', { class: 'auth-header-brand' },
      el('div', { class: 'logo-mark logo-mark-sm' },
        el('img', { src: '/static/img/cat-logo.svg', alt: 'JobTracker Logo' }),
      ),
      el('span', { class: 'auth-brand-name' }, 'JobTracker'),
      el('span', { class: 'auth-version-pill' }, 'v2.0 • Private Edition'),
    ),
    el('div', { class: 'auth-header-actions' },
      themeBtn,
    ),
  );

  // Error Alert
  const errorBox = el('div', { class: 'form-error mb-4', role: 'alert', hidden: true });

  // Inputs
  const username = el('input', {
    class: 'input input-indented',
    id: 'login-user',
    autocomplete: 'username',
    required: true,
    placeholder: 'Enter your username',
    'aria-label': 'Username',
  });

  const password = el('input', {
    class: 'input input-indented',
    id: 'login-pass',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
    placeholder: 'Enter your password',
    'aria-label': 'Password',
  });

  const togglePasswordBtn = el('button', {
    class: 'btn btn-ghost btn-sm toggle-eye-btn',
    type: 'button',
    'aria-label': 'Show password',
    onclick: () => {
      shown = !shown;
      password.setAttribute('type', shown ? 'text' : 'password');
      togglePasswordBtn.innerHTML = '';
      togglePasswordBtn.append(icon(shown ? 'eyeOff' : 'eye', 16));
      togglePasswordBtn.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    },
  }, icon('eye', 16));

  const submitText = el('span', { class: 'btn-text' }, 'Sign In to Workspace');
  const submitBtn = el('button', {
    class: 'btn btn-primary btn-block btn-lg auth-submit-btn',
    type: 'submit',
  }, submitText, icon('arrowRight', 16));

  // Mode Switch Tabs
  const tabSignIn = el('button', {
    type: 'button',
    class: 'auth-tab active',
    onclick: () => switchMode(false),
  }, 'Sign In');

  const tabRegister = el('button', {
    type: 'button',
    class: 'auth-tab',
    onclick: () => switchMode(true),
  }, 'Create Private Account');

  const modeSwitch = el('div', { class: 'auth-mode-toggle mb-4', role: 'tablist' },
    tabSignIn,
    tabRegister,
  );

  const cardSubtitle = el('p', { class: 'auth-card-subtitle' },
    'Enter your credentials to access your private pipeline.',
  );

  const privacyBanner = el('div', { class: 'auth-privacy-banner' },
    icon('shield', 15),
    el('span', {}, 'Resumes and applications are strictly private to each account.'),
  );

  function switchMode(reg) {
    isRegister = reg;
    tabSignIn.classList.toggle('active', !reg);
    tabRegister.classList.toggle('active', reg);
    errorBox.hidden = true;
    if (reg) {
      cardSubtitle.textContent = 'Create your private account to start tracking jobs.';
      password.placeholder = 'Choose a password (min 6 characters)';
      submitText.textContent = 'Create Private Workspace';
      privacyBanner.classList.add('highlight');
    } else {
      cardSubtitle.textContent = 'Enter your credentials to access your private pipeline.';
      password.placeholder = 'Enter your password';
      submitText.textContent = 'Sign In to Workspace';
      privacyBanner.classList.remove('highlight');
    }
    username.focus();
  }

  const form = el('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const u = username.value.trim();
      const p = password.value;

      if (!u || !p) {
        errorBox.textContent = 'Username and password are required.';
        errorBox.hidden = false;
        return;
      }
      if (isRegister && p.length < 6) {
        errorBox.textContent = 'Password must be at least 6 characters.';
        errorBox.hidden = false;
        return;
      }

      submitBtn.classList.add('loading');
      submitBtn.setAttribute('aria-disabled', 'true');
      try {
        if (isRegister) {
          await register(u, p);
          setState({ user: { username: u } });
          toast(`Account created for ${u}! Your workspace is 100% private.`, 'success');
        } else {
          await login(u, p);
          setState({ user: { username: u } });
          toast(`Welcome back, ${u}!`, 'success');
        }
        location.hash = '#/apps';
      } catch (err) {
        errorBox.textContent = err.message || (isRegister ? 'Registration failed' : 'Invalid credentials');
        errorBox.hidden = false;
        password.value = '';
      } finally {
        submitBtn.classList.remove('loading');
        submitBtn.removeAttribute('aria-disabled');
      }
    },
  },
    modeSwitch,
    errorBox,
    el('div', { class: 'field' },
      el('label', { for: 'login-user' }, 'Username'),
      el('div', { class: 'input-icon-wrapper' },
        el('span', { class: 'field-leading-icon', 'aria-hidden': 'true' }, icon('user', 16)),
        username,
      ),
    ),
    el('div', { class: 'field' },
      el('label', { for: 'login-pass' }, 'Password'),
      el('div', { class: 'input-icon-wrapper' },
        el('span', { class: 'field-leading-icon', 'aria-hidden': 'true' }, icon('lock', 16)),
        password,
        togglePasswordBtn,
      ),
    ),
    privacyBanner,
    submitBtn,
  );

  // Left Showcase Column
  const showcaseColumn = el('section', { class: 'auth-showcase-column' },
    el('div', { class: 'hero-eyebrow-pill' },
      icon('sparkle', 14),
      el('span', {}, 'Personal Career Operating System'),
    ),
    el('h1', { class: 'hero-title' },
      'Track every application.',
      el('br'),
      el('span', { class: 'hero-accent-text' }, 'Completely private.'),
    ),
    el('p', { class: 'hero-lead' },
      'A fast, tactile personal workspace for managing job hunting, interview pipelines, and resumes without spreadsheets or shared tracking.',
    ),
    el('div', { class: 'feature-showcase-list' },
      el('div', { class: 'showcase-card' },
        el('div', { class: 'showcase-icon-box bg-emerald' }, icon('board', 20)),
        el('div', { class: 'showcase-text' },
          el('div', { class: 'showcase-card-title' }, 'Kanban Pipeline Board'),
          el('div', { class: 'showcase-card-desc' },
            'Visual drag-and-drop workflow across Saved, Applied, Interviewing, Offer, and Rejected stages.',
          ),
        ),
      ),
      el('div', { class: 'showcase-card' },
        el('div', { class: 'showcase-icon-box bg-sky' }, icon('sparkle', 20)),
        el('div', { class: 'showcase-text' },
          el('div', { class: 'showcase-card-title' }, 'JD Tech Skills Extractor'),
          el('div', { class: 'showcase-card-desc' },
            'Automated keyword extraction for modern tech stacks with click-to-highlight in Job Descriptions.',
          ),
        ),
      ),
      el('div', { class: 'showcase-card' },
        el('div', { class: 'showcase-icon-box bg-coral' }, icon('pdf', 20)),
        el('div', { class: 'showcase-text' },
          el('div', { class: 'showcase-card-title' }, 'GridFS Resume Presets'),
          el('div', { class: 'showcase-card-desc' },
            'Upload your PDF resume once to MongoDB GridFS and link it across applications in 1 click.',
          ),
        ),
      ),
      el('div', { class: 'showcase-card' },
        el('div', { class: 'showcase-icon-box bg-violet' }, icon('shield', 20)),
        el('div', { class: 'showcase-text' },
          el('div', { class: 'showcase-card-title' }, 'Strict Multi-User Privacy'),
          el('div', { class: 'showcase-card-desc' },
            'Every user gets a scoped workspace. Your friends only see their own applications and PDFs.',
          ),
        ),
      ),
    ),
    el('div', { class: 'auth-trust-bar' },
      el('span', { class: 'trust-item' }, icon('check', 14), 'AES-128 Encryption'),
      el('span', { class: 'trust-item' }, icon('check', 14), 'HttpOnly JWT Cookies'),
      el('span', { class: 'trust-item' }, icon('check', 14), 'Zero Cloud Tracking'),
    ),
  );

  // Right Card Column
  const authCard = el('div', { class: 'card auth-form-card' },
    el('div', { class: 'brand-hero' },
      el('div', { class: 'logo-mark logo-mark-lg', 'aria-hidden': 'true' },
        el('img', { src: '/static/img/cat-logo.svg', alt: 'JobTracker Cat Logo' }),
      ),
      el('h2', { class: 'auth-card-title' }, 'Welcome to JobTracker'),
      cardSubtitle,
    ),
    form,
  );

  const cardColumn = el('section', { class: 'auth-card-column' }, authCard);

  // Root Page Layout
  const main = el('main', { class: 'auth-main' },
    showcaseColumn,
    cardColumn,
  );

  host.append(
    el('div', { class: 'auth-layout' },
      header,
      main,
    ),
  );

  setTimeout(() => username.focus(), 50);
}
