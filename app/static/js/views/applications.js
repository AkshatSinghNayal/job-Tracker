// views/applications.js — company-button grid, Kanban pipeline board, filters, and New/Edit drawer form.
import { api, upload, patchUpload, downloadFile } from '../api.js';
import { store, setState, STATUSES } from '../store.js';
import {
  el, debounce, toast, statusBadge, skeletonGrid, emptyState, errorState,
  openDrawer, confirmModal, fmtDate, fmtBytes, fmtRelative, companyGradient, icon,
} from '../components/ui.js';

const state = {
  search: '',
  status: '',
  sort: 'created_desc',
  view: localStorage.getItem('jt_view') || 'grid', // 'grid' | 'kanban'
};

const KANBAN_STAGES = [
  { id: 'saved', label: 'Saved Drafts', dotClass: 'dot-saved' },
  { id: 'applied', label: 'Applied', dotClass: 'dot-applied' },
  { id: 'interviewing', label: 'Interviewing', dotClass: 'dot-interviewing' },
  { id: 'offer', label: 'Offer Received', dotClass: 'dot-offer' },
  { id: 'rejected', label: 'Archived / Rejected', dotClass: 'dot-rejected' },
];

export async function renderApplications(host) {
  const statsHost = el('div', { class: 'stats-host' });
  const toolbarHost = el('div', { class: 'toolbar-host' });
  const stage = el('div', { class: 'applications-stage' });
  stage.append(skeletonGrid());
  host.append(statsHost, toolbarHost, stage);

  let allItems = [];

  const load = async () => {
    stage.innerHTML = '';
    stage.append(skeletonGrid());
    try {
      const params = new URLSearchParams();
      if (state.search) params.set('search', state.search);
      if (state.status && state.view !== 'kanban') params.set('status_filter', state.status);
      params.set('sort', state.sort);
      const items = await api.get(`/api/applications?${params}`);
      setState({ applications: items });

      // If in kanban or no active filter, update allItems for stats
      if (!state.status || state.view === 'kanban') {
        allItems = items;
      } else if (!allItems.length) {
        // Fetch all once for accurate stats counts
        api.get('/api/applications').then((res) => {
          allItems = res;
          statsHost.innerHTML = '';
          statsHost.append(statsBar(allItems));
        }).catch(() => {});
      }

      statsHost.innerHTML = '';
      statsHost.append(statsBar(allItems.length ? allItems : items));

      toolbarHost.innerHTML = '';
      toolbarHost.append(toolbar(allItems.length ? allItems : items, load));

      stage.innerHTML = '';

      if (state.view === 'kanban') {
        // Render Kanban Pipeline Board
        stage.append(kanbanBoard(allItems.length ? allItems : items, load));
        return;
      }

      // Grid View
      if (!items.length) {
        stage.append(emptyState({
          icon: '🗂',
          title: state.search || state.status ? 'No matching applications' : 'No applications yet',
          hint: state.search || state.status ? 'Try clearing or changing your search filters.' : 'Add your first job application and resume PDF to get started.',
          ctaLabel: state.search || state.status ? 'Clear filters' : '+ New application',
          onCta: () => {
            if (state.search || state.status) {
              state.search = '';
              state.status = '';
              load();
            } else {
              openNewApplicationDrawer(load);
            }
          },
        }));
        return;
      }

      const grid = el('div', { class: 'company-grid', 'aria-label': 'Applications' });
      for (const item of items) grid.append(companyCard(item));
      stage.append(grid);
    } catch (err) {
      stage.innerHTML = '';
      stage.append(errorState(err.message, load));
    }
  };

  document.addEventListener('app:search', onSearch);
  document.addEventListener('app:reload', onReload);
  function onSearch(e) { state.search = e.detail; load(); }
  function onReload() { load(); }

  load();
  return {
    destroy() {
      document.removeEventListener('app:search', onSearch);
      document.removeEventListener('app:reload', onReload);
    },
  };
}

function statsBar(items = []) {
  const total = items.length;
  const interviewing = items.filter((i) => i.status === 'interviewing').length;
  const offers = items.filter((i) => i.status === 'offer').length;
  const active = items.filter((i) => ['applied', 'interviewing'].includes(i.status)).length;

  const card = (label, count, filterVal, iconName, colorCls) => {
    const isAct = state.status === filterVal;
    return el('button', {
      class: `stat-card ${colorCls} ${isAct ? 'active' : ''}`,
      'aria-pressed': String(isAct),
      onclick: () => {
        state.status = filterVal;
        document.querySelectorAll('.chip').forEach((c) => {
          c.classList.toggle('active', c.dataset.status === filterVal || (!filterVal && !c.dataset.status));
        });
        document.dispatchEvent(new CustomEvent('app:reload'));
      },
    },
      el('div', { class: 'stat-top' },
        el('span', { class: 'stat-label' }, label),
        icon(iconName, 16),
      ),
      el('div', { class: 'stat-num' }, String(count)),
    );
  };

  return el('div', { class: 'stats-strip' },
    card('Total Applications', total, '', 'apps', 'card-total'),
    card('Active Pipeline', active, 'applied', 'refresh', 'card-active'),
    card('Interviewing', interviewing, 'interviewing', 'explorer', 'card-interviewing'),
    card('Offers', offers, 'offer', 'check', 'card-offer'),
  );
}

function toolbar(allItems = [], onReload) {
  const countFor = (s) => allItems.filter((i) => i.status === s).length;
  const chips = el('div', { class: 'row-wrap chips-wrap', role: 'group', 'aria-label': 'Filter by status' },
    el('button', {
      class: `chip ${!state.status ? 'active' : ''}`, 'aria-pressed': String(!state.status),
      onclick: (e) => setFilter('', e.target),
    }, `All (${allItems.length})`),
    ...STATUSES.map((s) => el('button', {
      class: `chip ${state.status === s ? 'active' : ''}`, 'aria-pressed': String(state.status === s),
      'data-status': s,
      onclick: (e) => setFilter(s, e.target),
    }, `${s} (${countFor(s)})`)),
  );

  // View Switcher: Grid vs Kanban Board
  const gridViewBtn = el('button', {
    class: `view-btn ${state.view === 'grid' ? 'active' : ''}`,
    'aria-label': 'Card Grid View',
    title: 'Card Grid View',
    onclick: () => {
      if (state.view !== 'grid') {
        state.view = 'grid';
        localStorage.setItem('jt_view', 'grid');
        onReload();
      }
    },
  }, icon('apps', 14), el('span', { class: 'view-btn-text' }, 'Grid'));

  const kanbanViewBtn = el('button', {
    class: `view-btn ${state.view === 'kanban' ? 'active' : ''}`,
    'aria-label': 'Pipeline Board View',
    title: 'Pipeline Board View',
    onclick: () => {
      if (state.view !== 'kanban') {
        state.view = 'kanban';
        localStorage.setItem('jt_view', 'kanban');
        onReload();
      }
    },
  }, icon('board', 14), el('span', { class: 'view-btn-text' }, 'Pipeline'));

  const viewSwitcher = el('div', { class: 'view-switcher', role: 'radiogroup', 'aria-label': 'Layout switch' },
    gridViewBtn, kanbanViewBtn,
  );

  // Export dropdown
  const exportMenu = el('div', { class: 'dropdown-menu export-dropdown' },
    el('button', {
      class: 'dropdown-item',
      onclick: () => {
        exportMenu.classList.remove('open');
        downloadFile('/api/applications/export?format=csv', 'jobtracker_applications.csv');
        toast('Downloading applications as CSV...', 'info');
      },
    }, icon('pdf', 14), 'Export to CSV (.csv)'),
    el('button', {
      class: 'dropdown-item',
      onclick: () => {
        exportMenu.classList.remove('open');
        downloadFile('/api/applications/export?format=json', 'jobtracker_applications.json');
        toast('Downloading applications as JSON...', 'info');
      },
    }, icon('sparkle', 14), 'Export to JSON (.json)'),
  );

  const exportBtn = el('div', { class: 'export-btn-wrap' },
    el('button', {
      class: 'btn btn-secondary btn-sm',
      'aria-label': 'Export applications',
      title: 'Export applications to CSV or JSON',
      onclick: (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('open');
      },
    }, icon('download', 14), 'Export'),
    exportMenu,
  );

  // Close export menu on outside click
  document.addEventListener('click', () => exportMenu.classList.remove('open'));

  const sort = el('select', {
    class: 'select sort-select', 'aria-label': 'Sort applications',
    onchange: (e) => { state.sort = e.target.value; document.dispatchEvent(new CustomEvent('app:reload')); },
  },
    el('option', { value: 'created_desc' }, 'Newest first'),
    el('option', { value: 'created_asc' }, 'Oldest first'),
    el('option', { value: 'company_asc' }, 'Company A–Z'),
    el('option', { value: 'applied_desc' }, 'Applied date ↓'),
    el('option', { value: 'applied_asc' }, 'Applied date ↑'),
    el('option', { value: 'updated_desc' }, 'Recently updated'),
  );
  sort.value = state.sort;

  return el('div', { class: 'toolbar' },
    chips,
    el('div', { class: 'grow' }),
    el('div', { class: 'toolbar-actions' },
      viewSwitcher,
      exportBtn,
      sort,
    ),
  );
}

function setFilter(status, chip) {
  state.status = status;
  chip.parentElement.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('active', c === chip);
    c.setAttribute('aria-pressed', String(c === chip));
  });
  if (state.view === 'kanban' && status) {
    const targetCol = document.querySelector(`.kanban-col[data-status="${status}"]`);
    if (targetCol) {
      targetCol.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      targetCol.classList.add('kanban-drop-target');
      setTimeout(() => targetCol.classList.remove('kanban-drop-target'), 800);
    }
  } else {
    document.dispatchEvent(new CustomEvent('app:reload'));
  }
}

function companyCard(item) {
  const grad = companyGradient(item.company || '');
  return el('button', {
    class: `company-card company-card-${item.status || 'saved'}`,
    'aria-label': `Open ${item.company} application`,
    onclick: () => { location.hash = `#/apps/${item.id}`; },
  },
    el('div', { class: 'avatar', style: { background: grad, color: '#fff' }, 'aria-hidden': 'true' },
      (item.company || '?')[0].toUpperCase(),
    ),
    el('div', { class: 'meta' },
      el('div', { class: 'card-header-row' },
        el('div', { class: 'company', text: item.company }),
        item.has_resume ? el('span', { class: 'resume-indicator', title: 'Resume PDF uploaded' }, icon('pdf', 13), 'PDF') : null,
      ),
      el('div', { class: 'title', text: item.job_title }),
      el('div', { class: 'foot' },
        statusBadge(item.status),
        el('span', { class: 'applied tnum' }, item.applied_on ? fmtRelative(item.applied_on) : 'Saved draft'),
      ),
    ),
  );
}

/* ================= Kanban Pipeline Board ================= */

let activeDraggedAppId = null;
let dragOccurredTime = 0;
let allLoadedItems = [];
let activeMoveMenu = null;

function closeMoveMenu() {
  if (activeMoveMenu) {
    activeMoveMenu.remove();
    activeMoveMenu = null;
  }
}
document.addEventListener('click', closeMoveMenu);

function openMoveMenu(e, item) {
  closeMoveMenu();
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menu = el('div', { class: 'quick-move-popover' },
    el('div', { class: 'quick-move-header' }, 'Move to stage:'),
    ...KANBAN_STAGES.map((s) => {
      const isCurrent = (s.id === item.status) || (s.id === 'rejected' && (item.status === 'rejected' || item.status === 'withdrawn'));
      return el('button', {
        class: `quick-move-item ${isCurrent ? 'current' : ''}`,
        type: 'button',
        onclick: async (evt) => {
          evt.stopPropagation();
          closeMoveMenu();
          if (!isCurrent) {
            await moveApplicationToStage(item.id, s.id, s.label);
          }
        },
      },
        el('span', { class: `col-status-dot ${s.dotClass}` }),
        el('span', { text: s.label }),
        isCurrent ? el('span', { class: 'current-check' }, '✓') : null,
      );
    }),
  );

  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  const left = Math.min(rect.left + window.scrollX, window.innerWidth - 190);
  menu.style.left = `${Math.max(10, left)}px`;

  document.body.appendChild(menu);
  activeMoveMenu = menu;
}

async function moveApplicationToStage(appId, newStatus, newLabel) {
  const targetItem = allLoadedItems.find((i) => String(i.id) === String(appId));
  if (!targetItem) return;

  if (targetItem.status === newStatus) return;
  if (newStatus === 'rejected' && (targetItem.status === 'rejected' || targetItem.status === 'withdrawn')) return;

  const previousStatus = targetItem.status;
  targetItem.status = newStatus; // optimistic in memory

  // Optimistic DOM move
  const cardEl = document.querySelector(`.kanban-card[data-id="${appId}"]`);
  const targetColEl = document.querySelector(`.kanban-col[data-status="${newStatus}"]`);
  const targetContainer = targetColEl?.querySelector('.kanban-cards-list');

  if (cardEl && targetContainer) {
    const sourceContainer = cardEl.parentElement;
    targetContainer.appendChild(cardEl);

    // Update badge on the card
    const badgeEl = cardEl.querySelector('.badge');
    if (badgeEl) {
      badgeEl.className = `badge badge-${newStatus}`;
      badgeEl.textContent = newStatus;
    }

    // Clean up empty slot in target column
    const targetEmpty = targetContainer.querySelector('.kanban-empty-slot');
    if (targetEmpty) targetEmpty.remove();

    // If source column is now empty, add empty placeholder
    if (sourceContainer && !sourceContainer.querySelector('.kanban-card')) {
      sourceContainer.appendChild(el('div', { class: 'kanban-empty-slot' }, 'Drop application here'));
    }

    // Update count pills on both columns
    const sourceColEl = sourceContainer?.closest('.kanban-col');
    if (sourceColEl) {
      const srcCount = sourceColEl.querySelector('.col-count-pill');
      const srcCards = sourceColEl.querySelectorAll('.kanban-card').length;
      if (srcCount) srcCount.textContent = String(srcCards);
    }
    if (targetColEl) {
      const targetCount = targetColEl.querySelector('.col-count-pill');
      const targetCards = targetColEl.querySelectorAll('.kanban-card').length;
      if (targetCount) targetCount.textContent = String(targetCards);
    }
  }

  try {
    const fd = new FormData();
    fd.set('status', newStatus);
    await patchUpload(`/api/applications/${appId}`, fd);
    toast(`Moved ${targetItem.company} to ${newLabel}`, 'success');
  } catch (err) {
    targetItem.status = previousStatus;
    toast(`Failed to move application: ${err.message}`, 'error');
    document.dispatchEvent(new CustomEvent('app:reload'));
  }
}

function attachPointerDrag(card, item) {
  let isDown = false;
  let startX = 0;
  let startY = 0;
  let isPointerDragging = false;
  let ghost = null;
  let activeDropCol = null;

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, a, input, select')) return;

    isDown = true;
    startX = e.clientX;
    startY = e.clientY;
    isPointerDragging = false;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isPointerDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isPointerDragging = true;
      activeDraggedAppId = String(item.id);
      dragOccurredTime = Date.now();

      ghost = card.cloneNode(true);
      ghost.classList.add('kanban-drag-ghost');
      const rect = card.getBoundingClientRect();
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${e.clientX - 40}px`;
      ghost.style.top = `${e.clientY - 20}px`;
      document.body.appendChild(ghost);

      card.classList.add('is-dragging');
      document.body.classList.add('kanban-is-dragging');
    }

    if (isPointerDragging && ghost) {
      if (e.cancelable) e.preventDefault();
      ghost.style.left = `${e.clientX - 40}px`;
      ghost.style.top = `${e.clientY - 20}px`;

      // Hit-test element under pointer
      ghost.style.display = 'none';
      const elBelow = document.elementFromPoint(e.clientX, e.clientY);
      ghost.style.display = '';

      const colEl = elBelow?.closest('.kanban-col');
      if (colEl !== activeDropCol) {
        if (activeDropCol) activeDropCol.classList.remove('kanban-drop-target');
        activeDropCol = colEl;
        if (activeDropCol) activeDropCol.classList.add('kanban-drop-target');
      }
    }
  };

  const onPointerUp = async (e) => {
    if (!isDown) return;
    isDown = false;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    card.classList.remove('is-dragging');
    document.body.classList.remove('kanban-is-dragging');

    if (activeDropCol) {
      const targetStatus = activeDropCol.dataset.status;
      const targetStage = KANBAN_STAGES.find((s) => s.id === targetStatus);
      activeDropCol.classList.remove('kanban-drop-target');
      activeDropCol = null;

      if (targetStage && targetStage.id !== item.status) {
        dragOccurredTime = Date.now();
        await moveApplicationToStage(item.id, targetStage.id, targetStage.label);
      }
    }

    if (isPointerDragging) {
      dragOccurredTime = Date.now();
      setTimeout(() => {
        isPointerDragging = false;
        activeDraggedAppId = null;
      }, 300);
    }
  };

  card.addEventListener('pointerdown', onPointerDown);
}

function kanbanBoard(items = [], onReload) {
  allLoadedItems = items;
  const board = el('div', { class: 'kanban-board', role: 'region', 'aria-label': 'Kanban pipeline board' });

  // Filter items by search if active
  let filtered = items;
  if (state.search) {
    const q = state.search.toLowerCase();
    filtered = items.filter((i) =>
      (i.company || '').toLowerCase().includes(q) ||
      (i.job_title || '').toLowerCase().includes(q)
    );
  }

  for (const col of KANBAN_STAGES) {
    // Stage items (withdrawn mapped to rejected for column display)
    const colItems = filtered.filter((i) => {
      if (col.id === 'rejected') return i.status === 'rejected' || i.status === 'withdrawn';
      return i.status === col.id;
    });

    const colHeader = el('div', { class: 'kanban-col-header' },
      el('div', { class: 'kanban-col-title-group' },
        el('span', { class: `col-status-dot ${col.dotClass}` }),
        el('span', { class: 'col-title', text: col.label }),
        el('span', { class: 'col-count-pill', text: String(colItems.length) }),
      ),
      el('button', {
        class: 'col-quick-add-btn',
        title: `Add new application to ${col.label}`,
        'aria-label': `Add to ${col.label}`,
        onclick: () => openNewApplicationDrawer(onReload, null, col.id),
      }, icon('plus', 13)),
    );

    const cardsContainer = el('div', { class: 'kanban-cards-list', 'data-stage': col.id });

    if (!colItems.length) {
      cardsContainer.append(el('div', { class: 'kanban-empty-slot' }, 'Drop application here'));
    } else {
      for (const item of colItems) {
        cardsContainer.append(kanbanCard(item, onReload));
      }
    }

    const colEl = el('div', { class: 'kanban-col', 'data-status': col.id }, colHeader, cardsContainer);

    let dragCounter = 0;

    const handleDragEnter = (e) => {
      e.preventDefault();
      dragCounter++;
      colEl.classList.add('kanban-drop-target');
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      colEl.classList.add('kanban-drop-target');
    };

    const handleDragLeave = (e) => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        colEl.classList.remove('kanban-drop-target');
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      colEl.classList.remove('kanban-drop-target');
      document.querySelectorAll('.kanban-col').forEach((c) => c.classList.remove('kanban-drop-target'));

      let appId = null;
      if (e.dataTransfer) {
        try {
          appId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
        } catch (_) {}
      }
      if (!appId) {
        appId = activeDraggedAppId;
      }
      if (!appId) return;

      await moveApplicationToStage(appId, col.id, col.label);
    };

    colEl.addEventListener('dragenter', handleDragEnter);
    colEl.addEventListener('dragover', handleDragOver);
    colEl.addEventListener('dragleave', handleDragLeave);
    colEl.addEventListener('drop', handleDrop);

    cardsContainer.addEventListener('dragenter', handleDragEnter);
    cardsContainer.addEventListener('dragover', handleDragOver);
    cardsContainer.addEventListener('dragleave', handleDragLeave);
    cardsContainer.addEventListener('drop', handleDrop);

    board.append(colEl);
  }

  return board;
}

function kanbanCard(item, onReload) {
  const grad = companyGradient(item.company || '');

  const quickMoveBtn = el('button', {
    class: 'btn-quick-move',
    type: 'button',
    title: 'Move application to another stage',
    'aria-label': 'Move to stage',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMoveMenu(e, item);
    },
  }, icon('arrowRight', 11));

  const card = el('div', {
    class: 'kanban-card',
    tabindex: '0',
    'data-id': String(item.id),
    draggable: 'true',
    'aria-label': `${item.company} — ${item.job_title}`,
  },
    el('div', { class: 'kanban-card-top' },
      el('div', { class: 'kanban-avatar', style: { background: grad } }, (item.company || '?')[0].toUpperCase()),
      el('div', { class: 'kanban-company-name', text: item.company }),
      item.has_resume ? el('span', { class: 'resume-indicator mini', title: 'Resume attached' }, icon('pdf', 11)) : null,
    ),
    el('div', { class: 'kanban-card-title', text: item.job_title }),
    el('div', { class: 'kanban-card-foot' },
      el('span', { class: 'kanban-date tnum' }, item.applied_on ? fmtRelative(item.applied_on) : 'No date'),
      el('div', { class: 'kanban-card-actions' },
        statusBadge(item.status),
        quickMoveBtn,
      ),
    ),
  );

  card.setAttribute('draggable', 'true');
  card.draggable = true;

  // 1. Native HTML5 Drag and Drop
  card.addEventListener('dragstart', (e) => {
    activeDraggedAppId = String(item.id);
    dragOccurredTime = Date.now();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(item.id));
        e.dataTransfer.setData('text', String(item.id));
      } catch (_) {}
    }
    card.classList.add('is-dragging');
    document.body.classList.add('kanban-is-dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    document.body.classList.remove('kanban-is-dragging');
    document.querySelectorAll('.kanban-col').forEach((c) => c.classList.remove('kanban-drop-target'));
    dragOccurredTime = Date.now();
    setTimeout(() => {
      activeDraggedAppId = null;
    }, 250);
  });

  // 2. Pointer / Touch Drag Support
  attachPointerDrag(card, item);

  // 3. Card click navigation
  card.addEventListener('click', (e) => {
    if (e.target.closest('.btn-quick-move') || activeDraggedAppId || (Date.now() - dragOccurredTime < 350)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    location.hash = `#/apps/${item.id}`;
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      location.hash = `#/apps/${item.id}`;
    }
  });

  return card;
}

/* ================= New / Edit drawer ================= */

const MAX_UPLOAD_MB = 10;

export function openNewApplicationDrawer(onSaved, existing = null, defaultStatus = 'saved') {
  const isEdit = Boolean(existing?.id);
  let dirty = false;
  let pickedFile = null;
  let pickedResumeId = null;
  let resumeMode = 'upload'; // 'upload' | 'preset'

  const err = el('div', { class: 'form-error', hidden: true, role: 'alert' });
  const dzHint = el('div', {}, 'Drop your resume PDF here or click to browse');
  const dropzone = el('div', {
    class: 'dropzone', role: 'button', tabindex: '0',
    'aria-label': 'Upload resume PDF: drop file here or press Enter to browse',
  },
    el('div', { class: 'dz-icon', 'aria-hidden': 'true' }, icon('upload', 32)),
    dzHint,
    el('div', { class: 'dz-hint' }, `PDF only · up to ${MAX_UPLOAD_MB} MB`),
  );
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden' });

  const fileChip = el('div', { class: 'file-chip', hidden: true });
  const progress = el('div', { class: 'progress', hidden: true },
    el('div', { class: 'progress-bar' }));
  const progressBar = progress.firstChild;

  // Preset selector host
  const presetHost = el('div', { class: 'preset-resume-host', hidden: true });
  const presetSelect = el('select', { class: 'select' });

  // Resume mode segment toggle
  const resumeModeToggle = el('div', { class: 'resume-mode-toggle mb-3', hidden: true },
    el('button', {
      type: 'button',
      class: 'mode-tab active',
      onclick: () => switchResumeMode('upload'),
    }, icon('upload', 13), ' Upload new PDF'),
    el('button', {
      type: 'button',
      class: 'mode-tab',
      onclick: () => switchResumeMode('preset'),
    }, icon('copy', 13), ' Choose from previous'),
  );

  function switchResumeMode(mode) {
    resumeMode = mode;
    resumeModeToggle.children[0].classList.toggle('active', mode === 'upload');
    resumeModeToggle.children[1].classList.toggle('active', mode === 'preset');
    if (mode === 'upload') {
      dropzone.hidden = false;
      presetHost.hidden = true;
      pickedResumeId = null;
      if (!pickedFile) fileChip.hidden = true;
    } else {
      dropzone.hidden = true;
      presetHost.hidden = false;
      pickedFile = null;
      if (presetSelect.value) {
        pickedResumeId = presetSelect.value;
        const opt = presetSelect.selectedOptions[0];
        showPresetChip(opt?.dataset?.filename || 'Resume', opt?.dataset?.company || '');
      } else {
        fileChip.hidden = true;
      }
    }
  }

  // Load previous resumes for preset selector
  api.get('/api/applications/resumes').then((resumes) => {
    if (resumes && resumes.length > 0) {
      resumeModeToggle.hidden = false;
      presetSelect.innerHTML = '';
      presetSelect.append(el('option', { value: '' }, '-- Select a previously uploaded resume --'));
      for (const r of resumes) {
        const opt = el('option', {
          value: r.gridfs_id,
          dataset: { filename: r.filename, company: r.company || '' },
        }, `${r.filename} (${r.company || 'Previous'} · ${fmtBytes(r.size)})`);
        presetSelect.append(opt);
      }
      presetSelect.onchange = () => {
        if (presetSelect.value) {
          pickedResumeId = presetSelect.value;
          pickedFile = null;
          dirty = true;
          const opt = presetSelect.selectedOptions[0];
          showPresetChip(opt?.dataset?.filename || 'Resume', opt?.dataset?.company || '');
        } else {
          pickedResumeId = null;
          fileChip.hidden = true;
        }
      };
      presetHost.append(
        el('label', { class: 'preset-label' }, 'Select an existing resume:'),
        presetSelect,
      );
    }
  }).catch(() => {});

  const company = el('input', { class: 'input', required: true, maxlength: 200, placeholder: 'Acme Inc.' });
  const jobTitle = el('input', { class: 'input', required: true, maxlength: 200, placeholder: 'Senior Backend Engineer' });
  const statusSel = el('select', { class: 'select' },
    ...STATUSES.map((s) => el('option', { value: s }, s)));
  statusSel.value = defaultStatus;

  const appliedOn = el('input', { class: 'input', type: 'date' });
  const jobUrl = el('input', { class: 'input', type: 'url', maxlength: 2000, placeholder: 'https://…' });
  const notes = el('textarea', { class: 'textarea', maxlength: 10000, rows: 3, placeholder: 'Personal notes (# headers, **bold**, - lists, salary, contacts)...' });

  const jd = el('textarea', {
    class: 'textarea', maxlength: 50000, rows: 9,
    placeholder: 'Paste the job description here (supports Markdown)...',
  });
  const counter = el('div', { class: 'char-counter' }, '0 / 50,000');
  jd.addEventListener('input', () => {
    counter.textContent = `${jd.value.length.toLocaleString()} / 50,000`;
    counter.classList.toggle('over', jd.value.length > 50000);
    dirty = true;
  });
  [company, jobTitle, statusSel, appliedOn, jobUrl, notes].forEach((input) => {
    input.addEventListener('input', () => { dirty = true; });
    input.addEventListener('change', () => { dirty = true; });
  });

  if (existing) {
    company.value = existing.company || '';
    jobTitle.value = existing.job_title || '';
    statusSel.value = existing.status || 'saved';
    appliedOn.value = existing.applied_on || '';
    jobUrl.value = existing.job_url || '';
    notes.value = existing.notes || '';
    jd.value = existing.job_description || '';
    counter.textContent = `${jd.value.length.toLocaleString()} / 50,000`;
    if (existing.resume) {
      dzHint.textContent = 'Drop a new PDF to replace, or click to browse';
      showFileChip(existing.resume.filename, existing.resume.size, true);
    }
    dirty = false;
  }

  async function pickFile(file) {
    err.hidden = true;
    if (!file) return;
    const isPdfName = /\.pdf$/i.test(file.name);
    // Instant client-side validation: extension AND magic bytes.
    let magicOk = false;
    try {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      magicOk = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    } catch { magicOk = false; }
    if (!isPdfName || !magicOk) {
      err.textContent = 'That file is not a PDF. Please choose a valid PDF document.';
      err.hidden = false;
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      err.textContent = `File is too large (${fmtBytes(file.size)}). The limit is ${MAX_UPLOAD_MB} MB.`;
      err.hidden = false;
      return;
    }
    if (file.size === 0) {
      err.textContent = 'File is empty.';
      err.hidden = false;
      return;
    }
    pickedFile = file;
    pickedResumeId = null;
    dirty = true;
    showFileChip(file.name, file.size, false);
  }

  function showFileChip(name, size, existingFile) {
    fileChip.hidden = false;
    fileChip.innerHTML = '';
    fileChip.append(
      icon('pdf', 18),
      el('div', { class: 'finfo' },
        el('div', { class: 'fname', text: name }),
        el('div', { class: 'fsize' }, existingFile ? 'Uploaded resume · ' : '' + fmtBytes(size)),
      ),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'aria-label': 'Remove file',
        onclick: () => { pickedFile = null; fileChip.hidden = true; },
      }, 'Remove'),
    );
  }

  function showPresetChip(name, companyName) {
    fileChip.hidden = false;
    fileChip.innerHTML = '';
    fileChip.append(
      icon('pdf', 18),
      el('div', { class: 'finfo' },
        el('div', { class: 'fname', text: name }),
        el('div', { class: 'fsize' }, `Reusing resume from ${companyName || 'previous application'}`),
      ),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'aria-label': 'Change',
        onclick: () => { pickedResumeId = null; presetSelect.value = ''; fileChip.hidden = true; },
      }, 'Clear'),
    );
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => {
    e.preventDefault(); dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (e) => pickFile(e.dataTransfer.files[0]));

  const saveBtn = el('button', { class: 'btn btn-primary' }, isEdit ? 'Save changes' : 'Save application');
  saveBtn.addEventListener('click', async () => {
    err.hidden = true;
    if (!company.value.trim() || !jobTitle.value.trim()) {
      err.textContent = 'Company and Job title are required.';
      err.hidden = false;
      return;
    }
    if (!isEdit && !pickedFile && !pickedResumeId) {
      err.textContent = 'Please attach your resume PDF or select an existing one.';
      err.hidden = false;
      return;
    }
    const fd = new FormData();
    fd.set('company', company.value.trim());
    fd.set('job_title', jobTitle.value.trim());
    fd.set('job_description', jd.value);
    fd.set('status', statusSel.value);
    if (appliedOn.value) fd.set('applied_on', appliedOn.value);
    if (jobUrl.value.trim()) fd.set('job_url', jobUrl.value.trim());
    if (notes.value) fd.set('notes', notes.value);
    if (pickedFile) {
      fd.set('file', pickedFile, pickedFile.name);
    } else if (pickedResumeId) {
      fd.set('resume_id', pickedResumeId);
    }

    saveBtn.classList.add('loading');
    progress.hidden = false;
    try {
      if (isEdit) {
        await patchUpload(`/api/applications/${existing.id}`, fd, (pct) => { progressBar.style.width = pct + '%'; });
      } else {
        await upload('/api/applications', fd, (pct) => { progressBar.style.width = pct + '%'; });
      }
      dirty = false;
      toast(isEdit ? 'Application updated' : 'Application saved', 'success');
      drawer.close(true);
      if (onSaved) onSaved();
    } catch (e) {
      err.textContent = e.message || 'Save failed';
      err.hidden = false;
      progress.hidden = true;
    } finally {
      saveBtn.classList.remove('loading');
    }
  });

  const body = el('div', {},
    err,
    resumeModeToggle,
    dropzone, presetHost, fileInput, fileChip, progress,
    field('Company *', company),
    field('Job title *', jobTitle),
    el('div', { class: 'row', style: { gap: '12px' } },
      el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'Status'), statusSel),
      el('div', { class: 'field', style: { flex: '1' } }, el('label', {}, 'Applied date'), appliedOn),
    ),
    field('Job URL', jobUrl),
    field('Job description (Markdown)', jd, counter),
    field('Personal Notes (Markdown)', notes),
  );

  const drawer = openDrawer({
    title: isEdit ? 'Edit application' : 'New application',
    body,
    footer: el('div', {}, saveBtn),
    onClose: async () => {
      if (!dirty) return true;
      return await confirmModal({
        title: 'Discard changes?',
        body: 'You have unsaved changes. Closing this drawer will discard them.',
        confirmLabel: 'Discard', danger: true,
      });
    },
  });
}

function field(labelText, control, extra) {
  const wrap = el('div', { class: 'field' }, el('label', {}, labelText), control);
  if (extra) wrap.append(extra);
  return wrap;
}
