// views/settings.js — account info, live cloud deployment specs, password change & multi-user isolation guide.
import { api, logout } from '../api.js';
import { store } from '../store.js';
import { el, toast, icon } from '../components/ui.js';

export async function renderSettings(host) {
  let me = { username: store.user?.username || '—' };
  let sys = {
    deployment: 'Detecting…',
    database: { connected: true, name: 'jobtracker', latency_ms: 0, source: 'Cloud Environment' },
    storage: { engine: 'MongoDB GridFS', max_upload_mb: 10 },
    security: { session_mode: 'Multi-User Isolated (JWT + HttpOnly Cookie)', encryption: 'Fernet (AES-128-CBC + HMAC-SHA256)' },
    privacy: { isolation: 'Active (scoped to user_id)' },
  };

  try {
    const [meRes, sysRes] = await Promise.all([
      api.get('/api/auth/me'),
      api.get('/api/auth/system-info'),
    ]);
    me = meRes;
    sys = sysRes;
  } catch { /* offline fallback */ }

  // Change Password Form
  const currentPw = el('input', { class: 'input', type: 'password', placeholder: 'Current password', 'aria-label': 'Current password' });
  const newPw = el('input', { class: 'input', type: 'password', placeholder: 'New password (min 6 chars)', 'aria-label': 'New password' });
  const changePwBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Update password');
  const pwMsg = el('div', { class: 'small mt-2', style: { display: 'none' } });

  changePwBtn.onclick = async () => {
    pwMsg.style.display = 'none';
    if (!currentPw.value || !newPw.value) {
      pwMsg.textContent = 'Please fill both password fields.';
      pwMsg.style.color = 'var(--danger)';
      pwMsg.style.display = 'block';
      return;
    }
    if (newPw.value.length < 6) {
      pwMsg.textContent = 'New password must be at least 6 characters.';
      pwMsg.style.color = 'var(--danger)';
      pwMsg.style.display = 'block';
      return;
    }
    changePwBtn.classList.add('loading');
    try {
      await api.post('/api/auth/change-password', {
        current_password: currentPw.value,
        new_password: newPw.value,
      });
      toast('Password updated successfully', 'success');
      currentPw.value = '';
      newPw.value = '';
      pwMsg.textContent = 'Password updated successfully! ✓';
      pwMsg.style.color = 'var(--accent-text)';
      pwMsg.style.display = 'block';
    } catch (err) {
      pwMsg.textContent = err.message || 'Failed to update password';
      pwMsg.style.color = 'var(--danger)';
      pwMsg.style.display = 'block';
    } finally {
      changePwBtn.classList.remove('loading');
    }
  };

  const pwSection = el('div', { class: 'change-pw-box mt-4' },
    el('div', { class: 'spec-label mb-2' }, 'Change Password:'),
    el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      el('div', { style: { flex: '1', minWidth: '140px' } }, currentPw),
      el('div', { style: { flex: '1', minWidth: '140px' } }, newPw),
      changePwBtn,
    ),
    pwMsg,
  );

  host.append(
    el('h2', {}, 'Workspace & Deployment Settings'),
    el('p', { class: 'muted mb-6' }, 'System status, cloud database connectivity, and multi-user privacy configuration.'),
    el('div', { class: 'settings-grid' },
      // Card 1: Account & Active Session
      el('div', { class: 'card card-pad' },
        el('h3', {}, 'Account & Active Session'),
        el('div', { class: 'user-profile-badge mb-4' },
          el('div', { class: 'avatar', style: { width: '42px', height: '42px', background: 'var(--accent)', color: '#fff', borderRadius: '12px', border: '2px solid var(--border)', display: 'grid', placeItems: 'center', fontWeight: '850', fontSize: '18px' } },
            (me.username || 'U')[0].toUpperCase()),
          el('div', {},
            el('div', { style: { fontWeight: '800', fontSize: 'var(--fs-md)' }, text: me.username }),
            el('div', { class: 'badge badge-offer' }, 'Private Isolated Workspace'),
          ),
        ),
        el('p', { class: 'muted small' },
          'Your account has complete privacy. All job applications, status boards, personal notes, and resume PDFs you upload are strictly scoped to your account and invisible to other users.'),
        pwSection,
        el('div', { class: 'mt-6 pt-4', style: { borderTop: '2px solid var(--border)' } },
          el('button', {
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              await logout();
              toast('Signed out from workspace', 'info');
              location.hash = '#/login';
            },
          }, icon('close', 14), 'Sign out of workspace'),
        ),
      ),

      // Card 2: Cloud Database & Storage Engine
      el('div', { class: 'card card-pad' },
        el('h3', {}, 'Cloud Database & Engine'),
        el('ul', { class: 'spec-list' },
          el('li', {},
            el('span', { class: 'spec-label' }, 'Deployment Mode:'),
            el('span', { class: 'badge badge-applied' }, sys.deployment),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Database Status:'),
            el('span', { class: 'badge badge-offer' },
              sys.database.connected ? `Connected (${sys.database.latency_ms} ms)` : 'Degraded',
            ),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Database Name:'),
            el('span', { class: 'mono small', style: { fontWeight: '700' } }, sys.database.name),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Configuration Source:'),
            el('span', { class: 'small' }, sys.database.source),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Resume Storage:'),
            el('span', { class: 'small' }, `${sys.storage.engine} (Max ${sys.storage.max_upload_mb} MB)`),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Data Isolation:'),
            el('span', { class: 'badge badge-interviewing' }, 'Strict (scoped to user_id)'),
          ),
          el('li', {},
            el('span', { class: 'spec-label' }, 'Session Security:'),
            el('span', { class: 'small' }, sys.security.session_mode),
          ),
        ),
      ),
    ),

    // Card 3: Vercel / Cloud Deployment & Sharing Architecture Guide
    el('div', { class: 'card card-pad mt-5' },
      el('div', { class: 'row mb-3', style: { gap: '10px' } },
        el('div', { class: 'logo-mark', style: { width: '32px', height: '32px', fontSize: '15px' } }, '☁'),
        el('h3', { style: { margin: 0 } }, 'Vercel / Cloud Deployment Architecture'),
      ),
      el('p', { class: 'muted small mb-4' },
        'How environment variables power private sessions for you and your friends when deployed to Vercel or cloud containers:'),
      el('div', { class: 'deployment-steps-grid' },
        el('div', { class: 'step-box' },
          el('div', { class: 'step-num' }, '1'),
          el('div', { class: 'step-title' }, 'Set Vercel Environment Variables'),
          el('div', { class: 'step-desc' },
            'Configure your MongoDB URI (APP_DB_URI), APP_SECRET_KEY, FERNET_KEY, and COOKIE_SECURE=true in your Vercel Project Settings. The deployed instance uses these to connect centrally.'),
        ),
        el('div', { class: 'step-box' },
          el('div', { class: 'step-num' }, '2'),
          el('div', { class: 'step-title' }, 'Share Your Vercel Domain'),
          el('div', { class: 'step-desc' },
            'Give your friends your live Vercel URL (e.g. https://your-jobtracker.vercel.app). They don’t need MongoDB accounts or local setups.'),
        ),
        el('div', { class: 'step-box' },
          el('div', { class: 'step-num' }, '3'),
          el('div', { class: 'step-title' }, 'Instant Private Workspaces'),
          el('div', { class: 'step-desc' },
            'When friends open the link, they click "Create Private Account" to register. All applications, pipeline boards, and PDF files are strictly isolated to their account.'),
        ),
      ),
    ),
  );
}
