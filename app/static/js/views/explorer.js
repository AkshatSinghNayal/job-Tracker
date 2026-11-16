// views/explorer.js — connection selector, db/collection tree, paginated document table.
import { api } from '../api.js';
import { store, setState } from '../store.js';
import { el, toast, jsonViewer, skeletonGrid } from '../components/ui.js';

export async function renderExplorer(host) {
  const treeHost = el('div', { class: 'card tree', 'aria-label': 'Databases and collections' });
  const tableHost = el('div', { 'aria-label': 'Documents' });

  const connSel = el('select', { class: 'select', 'aria-label': 'Connection', style: { maxWidth: '280px' } },
    el('option', { value: '' }, 'Select a connection…'));
  const reloadConns = async () => {
    const conns = await api.get('/api/connections').catch(() => []);
    setState({ connections: conns });
    connSel.innerHTML = '';
    for (const c of conns) {
      connSel.append(el('option', { value: c.id }, `${c.name}${c.read_only ? ' (read-only)' : ''}`));
    }
    if (!conns.length) {
      connSel.append(el('option', { value: '' }, 'No connections available'));
    } else {
      connSel.value = conns[0].id;
    }
  };
  connSel.addEventListener('change', () => loadDatabases());
  await reloadConns();
  if (connSel.value) {
    loadDatabases();
  }

  host.append(
    el('div', { class: 'toolbar' },
      connSel,
      el('span', { class: 'faint small' }, 'Read-only browsing'),
    ),
    el('div', { class: 'explorer-grid' }, treeHost, tableHost),
  );

  let currentConn = '';
  let currentDb = '';
  let currentColl = '';
  let page = 1;
  let pageSize = 25;
  let sortSpec = '_id:-1';
  let filterRaw = '';

  async function loadDatabases() {
    currentConn = connSel.value;
    currentDb = ''; currentColl = '';
    tableHost.innerHTML = ''; treeHost.innerHTML = '';
    if (!currentConn) return;
    treeHost.append(el('div', { class: 'skeleton', style: { height: '20px' } }));
    try {
      const dbs = await api.get(`/api/explorer/databases?connection=${currentConn}`);
      treeHost.innerHTML = '';
      treeHost.append(el('div', { class: 'tree-section' }, 'Databases'));
      for (const db of dbs) {
        const dbItem = el('button', { class: 'tree-item', 'aria-expanded': 'false' }, '🗄 ' + db);
        const kids = el('div', { hidden: true });
        dbItem.addEventListener('click', async () => {
          const expanded = dbItem.getAttribute('aria-expanded') === 'true';
          document.querySelectorAll('.tree-item.active').forEach((n) => n.classList.remove('active'));
          if (!expanded) {
            currentDb = db;
            dbItem.setAttribute('aria-expanded', 'true');
            kids.hidden = false;
            if (!kids.childElementCount) await loadCollections(db, kids);
          } else {
            dbItem.setAttribute('aria-expanded', 'false');
            kids.hidden = true;
          }
        });
        treeHost.append(dbItem, kids);
      }
    } catch (err) {
      treeHost.innerHTML = '';
      treeHost.append(el('div', { class: 'card-pad muted' }, err.message));
    }
  }

  async function loadCollections(db, kids) {
    kids.append(el('div', { class: 'skeleton', style: { height: '16px', margin: '4px 24px' } }));
    try {
      const colls = await api.get(`/api/explorer/databases/${encodeURIComponent(db)}/collections?connection=${currentConn}`);
      kids.innerHTML = '';
      for (const c of colls) {
        const item = el('button', { class: 'tree-item' },
          el('span', { text: '▤ ' + c.name }),
          el('span', { class: 'count' }, c.estimated_count.toLocaleString()));
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.tree-item.active').forEach((n) => n.classList.remove('active'));
          item.classList.add('active');
          currentDb = db; currentColl = c.name; page = 1;
          renderTableShell();
          loadDocs();
        });
        kids.append(item);
      }
    } catch (err) {
      kids.innerHTML = '';
      kids.append(el('div', { class: 'small', style: { color: 'var(--danger)', padding: '4px 24px' } }, err.message));
    }
  }

  /* ---- Documents table ---- */
  let filterInput, sortInput, prevBtn, nextBtn, pageInfo, tbody;

  function renderTableShell() {
    tableHost.innerHTML = '';
    filterInput = el('input', { class: 'input code', placeholder: '{"status": "applied"}', 'aria-label': 'JSON filter' });
    sortInput = el('input', { class: 'input code', value: sortSpec, 'aria-label': 'Sort spec', style: { maxWidth: '180px' }, placeholder: 'field:-1' });
    prevBtn = el('button', { class: 'btn btn-secondary btn-sm', 'aria-label': 'Previous page' }, '← Prev');
    nextBtn = el('button', { class: 'btn btn-secondary btn-sm', 'aria-label': 'Next page' }, 'Next →');
    pageInfo = el('span', { class: 'pageinfo' }, '');
    const apply = () => { page = 1; sortSpec = sortInput.value || '_id:-1'; filterRaw = filterInput.value; loadDocs(); };
    filterInput.addEventListener('change', apply);
    sortInput.addEventListener('change', apply);
    prevBtn.addEventListener('click', () => { if (page > 1) { page -= 1; loadDocs(); } });
    nextBtn.addEventListener('click', () => { page += 1; loadDocs(); });

    tbody = el('tbody', {});
    tableHost.append(
      el('div', { class: 'card' },
        el('div', { class: 'row-wrap', style: { padding: '12px 16px', borderBottom: '1px solid var(--border)' } },
          el('strong', {}, `${currentDb} › ${currentColl}`),
          el('div', { class: 'grow' }),
          filterInput, sortInput,
        ),
        el('table', { class: 'docs-table' },
          el('thead', {}, el('tr', {}, el('th', { style: { width: '110px' } }, '_id'), el('th', {}, 'document'))),
          tbody,
        ),
        el('div', { class: 'pagination' }, prevBtn, pageInfo, nextBtn),
      ),
    );
  }

  async function loadDocs() {
    tbody.innerHTML = '';
    tbody.append(el('tr', {}, el('td', { colspan: '2' }, el('div', { class: 'skeleton', style: { height: '36px' } }))));
    try {
      const params = new URLSearchParams({
        connection: currentConn, page: String(page), page_size: String(pageSize), sort: sortSpec,
      });
      if (filterRaw.trim()) params.set('filter', filterRaw.trim());
      const data = await api.get(
        `/api/explorer/databases/${encodeURIComponent(currentDb)}/collections/${encodeURIComponent(currentColl)}/documents?${params}`);
      tbody.innerHTML = '';
      for (const doc of data.documents) {
        const preview = JSON.stringify(doc);
        const row = el('tr', { class: 'row-click', tabindex: '0', role: 'button', 'aria-label': 'Expand document' },
          el('td', { class: 'cell-mono', text: String(doc._id || '') }),
          el('td', { class: 'cell-mono', text: preview.length > 300 ? preview.slice(0, 300) + '…' : preview }),
        );
        const expand = () => {
          const next = row.nextElementSibling;
          if (next && next.classList.contains('doc-expanded')) { next.remove(); return; }
          document.querySelectorAll('tr.doc-expanded').forEach((n) => n.remove());
          row.after(el('tr', { class: 'doc-expanded' },
            el('td', { colspan: '2' }, jsonViewer(doc))));
        };
        row.addEventListener('click', expand);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') expand(); });
        tbody.append(row);
      }
      if (!data.documents.length) {
        tbody.append(el('tr', {}, el('td', { colspan: '2', class: 'muted', style: { padding: '24px', textAlign: 'center' } }, 'No documents match.')));
      }
      const pages = Math.max(1, Math.ceil(data.total / data.page_size));
      pageInfo.textContent = `${data.total.toLocaleString()} docs · page ${data.page} / ${pages}`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= pages;
    } catch (err) {
      tbody.innerHTML = '';
      tbody.append(el('tr', {}, el('td', { colspan: '2', style: { color: 'var(--danger)', padding: '12px' } }, err.message)));
    }
  }
}
