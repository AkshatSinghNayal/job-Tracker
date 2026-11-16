// views/connections.js — add connection (password-type URI), masked list, test, delete.
import { api } from '../api.js';
import { el, toast, confirmModal, fmtDate } from '../components/ui.js';

export async function renderConnections(host) {
  const list = el('div', { class: 'conn-list', 'aria-label': 'Saved connections' });

  const name = el('input', { class: 'input', required: true, maxlength: 100, placeholder: 'My Atlas cluster' });
  const uri = el('input', {
    class: 'input', type: 'password', required: true, autocomplete: 'off',
    placeholder: 'mongodb+srv://user:•••@cluster0.xxxx.mongodb.net',
    'aria-label': 'MongoDB URI (kept secret)',
  });
  let uriShown = false;
  const showToggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Show URI',
    onclick: () => {
      uriShown = !uriShown;
      uri.setAttribute('type', uriShown ? 'text' : 'password');
      showToggle.textContent = uriShown ? 'Hide' : 'Show';
    },
  }, 'Show');
  const readOnly = el('input', { type: 'checkbox', id: 'conn-ro', checked: true, class: 'checkbox' });
  const errBox = el('div', { class: 'form-error', hidden: true, role: 'alert' });
  const addBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Add connection');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      addBtn.classList.add('loading');
      try {
        await api.post('/api/connections', {
          name: name.value.trim(),
          uri: uri.value.trim(),
          read_only: readOnly.checked,
        });
        toast('Connection saved (URI stored encrypted)', 'success');
        name.value = ''; uri.value = '';
        load();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      } finally {
        addBtn.classList.remove('loading');
      }
    },
  },
    errBox,
    el('div', { class: 'field' }, el('label', { for: 'conn-name' }, 'Name'), name),
    el('div', { class: 'field' },
      el('label', { for: 'conn-uri' }, 'MongoDB URI'),
      el('div', { class: 'input-with-btn' }, uri, showToggle),
      el('div', { class: 'char-counter faint', style: { textAlign: 'left' } },
        'Validated by a live ping before saving; stored encrypted (Fernet). Never shown again.')),
    el('div', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '8px' } },
      readOnly, el('label', { for: 'conn-ro', style: { margin: '0' } }, 'Read-only (recommended)')),
    addBtn,
  );

  host.append(
    el('h2', {}, 'Connections'),
    el('p', { class: 'muted' }, 'Save MongoDB connection strings for the Data Explorer. Credentials are encrypted at rest and never displayed.'),
    el('div', { class: 'card card-pad', style: { maxWidth: '560px' } }, form),
    el('h3', { class: 'mt-6' }, 'Saved connections'),
    list,
  );

  async function load() {
    list.innerHTML = '';
    list.append(el('div', { class: 'skeleton', style: { height: '56px' } }));
    try {
      const conns = await api.get('/api/connections');
      list.innerHTML = '';
      if (!conns.length) {
        list.append(el('p', { class: 'muted' }, 'No saved connections yet.'));
        return;
      }
      for (const c of conns) list.append(connRow(c));
    } catch (err) {
      list.innerHTML = '';
      list.append(el('p', { style: { color: 'var(--danger)' } }, err.message));
    }
  }

  function connRow(c) {
    const isDefault = c.id === 'default';
    const latency = el('span', { class: 'latency' }, '');
    const testBtn = el('button', {
      class: 'btn btn-secondary btn-sm',
      onclick: async () => {
        latency.textContent = 'testing…'; latency.className = 'latency';
        try {
          const res = await api.post(`/api/connections/${c.id}/test`);
          latency.textContent = `${res.latency_ms} ms · v${res.server_version}`;
          latency.className = 'latency ok';
        } catch (err) { latency.textContent = err.message; latency.style.color = 'var(--danger)'; }
      },
    }, 'Test Latency');
    const delBtn = isDefault ? null : el('button', {
      class: 'btn btn-danger btn-sm',
      onclick: async () => {
        const ok = await confirmModal({
          title: 'Delete connection?',
          body: `Remove "${c.name}"? Stored credentials will be deleted. Your data on that cluster is not touched.`,
          confirmLabel: 'Delete',
        });
        if (!ok) return;
        try { await api.del(`/api/connections/${c.id}`); toast('Connection deleted', 'success'); load(); }
        catch (err) { toast(err.message, 'error'); }
      },
    }, 'Delete');

    return el('div', { class: `card conn-row ${isDefault ? 'conn-primary-card' : ''}` },
      el('div', { class: 'grow' },
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          el('strong', { text: c.name }),
          isDefault ? el('span', { class: 'badge badge-offer' }, 'Primary (via .env)') : null,
          c.read_only ? el('span', { class: 'badge badge-saved' }, 'read-only') : null,
        ),
        el('div', { class: 'masked' }, c.masked_uri),
        el('div', { class: 'faint small' },
          isDefault
            ? 'Configured in server environment (APP_DB_URI). Used for all job applications and resume storage.'
            : (`added ${fmtDate(c.created_at)}` + (c.last_used_at ? ` · last used ${fmtDate(c.last_used_at)}` : ''))),
      ),
      latency, testBtn, delBtn,
    );
  }

  load();
}
