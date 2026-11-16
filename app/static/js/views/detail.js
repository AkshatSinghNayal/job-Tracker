// views/detail.js — split view: JD + Notes (left) + PDF viewer (right); tabs on mobile.
// Both JD and Notes render full Markdown formatting with tech skill highlighting.
import { api, fetchBlob, patchUpload } from '../api.js';
import { STATUSES } from '../store.js';
import {
  el, toast, statusBadge, confirmModal, fmtDate, fmtBytes, companyGradient, icon,
} from '../components/ui.js';
import { extractSkills } from '../components/keywords.js';
import { renderMarkdown } from '../components/markdown.js';
import { openNewApplicationDrawer } from './applications.js';

export async function renderApplicationDetail(host, appId) {
  const blobUrls = [];
  let record = null;

  const wrap = el('div', {});
  host.append(wrap);

  const destroy = () => {
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls.length = 0;
  };

  const load = async () => {
    try {
      record = await api.get(`/api/applications/${appId}`);
    } catch (err) {
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'empty-state' },
        el('div', { class: 'big' }, '⚠'),
        el('h3', {}, 'Application not found'),
        el('p', { class: 'small' }, err.message),
        el('a', { class: 'btn btn-secondary', href: '#/apps' }, '← Back to applications'),
      ));
      return;
    }
    wrap.innerHTML = '';
    wrap.append(detailEl());
  };

  function detailEl() {
    const back = el('a', {
      class: 'btn btn-ghost btn-sm mb-4',
      href: '#/apps',
      'aria-label': 'Back to applications',
    }, '← Back to Applications');

    const grad = companyGradient(record.company || '');
    const statusSel = el('select', {
      class: 'select status-select',
      'aria-label': 'Status',
      style: { width: 'auto' },
      onchange: async (e) => {
        try {
          const fd = new FormData();
          fd.set('status', e.target.value);
          await patchUpload(`/api/applications/${appId}`, fd);
          record.status = e.target.value;
          toast('Application status updated', 'success');
          load();
        } catch (err) {
          toast(err.message, 'error');
          e.target.value = record.status;
        }
      },
    }, ...STATUSES.map((s) => el('option', { value: s }, s)));
    statusSel.value = record.status || 'saved';

    const header = el('div', { class: 'detail-header mb-4' },
      el('div', {
        class: 'avatar',
        'aria-hidden': 'true',
        style: {
          width: '56px', height: '56px', fontSize: '24px', background: grad,
          color: '#fff', borderRadius: '14px', border: '2px solid #18181b',
          boxShadow: '3px 3px 0 #18181b', display: 'grid', placeItems: 'center', fontWeight: '800',
        },
      }, (record.company || '?')[0].toUpperCase()),
      el('div', { class: 'grow' },
        el('div', { class: 'detail-top-title' },
          el('h1', { text: record.company }),
          el('span', { class: 'detail-job-title', text: `·  ${record.job_title}` }),
        ),
        el('div', { class: 'meta-line' },
          statusBadge(record.status),
          el('span', { class: 'date' }, `Applied on ${fmtDate(record.applied_on)}`),
          record.job_url ? el('a', {
            href: record.job_url,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'external-link',
          }, icon('external', 13), 'View Job Posting') : null,
        ),
      ),
      statusSel,
    );

    // Bottom action buttons (Edit full application or Delete)
    const actions = el('div', { class: 'detail-actions mt-4' },
      el('button', {
        class: 'btn btn-secondary btn-sm',
        'aria-label': 'Edit application',
        onclick: () => openNewApplicationDrawer(load, record),
      }, icon('edit', 14), 'Edit Application Details'),
      el('button', {
        class: 'btn btn-danger btn-sm',
        onclick: async () => {
          const ok = await confirmModal({
            title: 'Delete application?',
            body: `This permanently deletes the application for ${record.company} and its stored resume PDF. This cannot be undone.`,
            confirmLabel: 'Delete',
          });
          if (!ok) return;
          try {
            await api.del(`/api/applications/${appId}`);
            toast('Application deleted', 'success');
            location.hash = '#/apps';
          } catch (err) { toast(err.message, 'error'); }
        },
      }, icon('trash', 14), 'Delete Application'),
    );

    // Left Section 1: Job Description Panel
    const copyBtn = el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(record.job_description || '');
          copyBtn.innerHTML = '';
          copyBtn.append(icon('check', 14), ' Copied! ✓');
          copyBtn.style.color = 'var(--success)';
          setTimeout(() => {
            copyBtn.innerHTML = '';
            copyBtn.append(icon('copy', 14), ' Copy JD');
            copyBtn.style.color = '';
          }, 2000);
          toast('Job description copied to clipboard', 'success');
        } catch { toast('Could not copy', 'error'); }
      },
    }, icon('copy', 14), ' Copy JD');

    const jdContentEl = el('div', { class: 'md-content' });
    jdContentEl.innerHTML = renderMarkdown(record.job_description || '*No job description saved.*');

    // Client-side skill keyword extraction & interactive highlighting
    const skills = extractSkills(record.job_description || '');
    let activeHighlight = null;
    let skillsSection = null;

    if (skills.length > 0) {
      const chipList = el('div', { class: 'skills-chip-list', role: 'group', 'aria-label': 'Detected skills' });
      for (const skill of skills) {
        const chip = el('button', {
          class: 'skill-chip',
          'aria-label': `Highlight ${skill} in job description`,
          dataset: { skill },
          onclick: () => {
            if (activeHighlight === skill) {
              activeHighlight = null;
              chipList.querySelectorAll('.skill-chip').forEach((c) => c.classList.remove('active'));
              highlightSkill(jdContentEl, record.job_description || '', null);
            } else {
              activeHighlight = skill;
              chipList.querySelectorAll('.skill-chip').forEach((c) => c.classList.toggle('active', c.dataset.skill === skill));
              highlightSkill(jdContentEl, record.job_description || '', skill);
            }
          },
        }, skill);
        chipList.append(chip);
      }

      const clearBtn = el('button', {
        class: 'btn btn-ghost btn-xs skills-clear-btn',
        style: { display: 'none' },
        onclick: () => {
          activeHighlight = null;
          chipList.querySelectorAll('.skill-chip').forEach((c) => c.classList.remove('active'));
          highlightSkill(jdContentEl, record.job_description || '', null);
          clearBtn.style.display = 'none';
        },
      }, 'Clear highlight');

      skillsSection = el('div', { class: 'skills-box mb-4' },
        el('div', { class: 'skills-header' },
          el('div', { class: 'skills-title' },
            icon('sparkle', 14),
            el('span', {}, 'Detected Requirements & Tech Stack'),
            el('span', { class: 'skills-count-pill' }, String(skills.length)),
          ),
          el('div', { class: 'row', style: { gap: '8px' } },
            clearBtn,
            el('span', { class: 'skills-hint' }, 'Click to find in JD'),
          ),
        ),
        chipList,
      );

      chipList.addEventListener('click', () => {
        clearBtn.style.display = activeHighlight ? 'inline-flex' : 'none';
      });
    }

    const jdPanel = el('section', { class: 'card jd-panel', 'aria-label': 'Job description' },
      el('div', { class: 'row', style: { marginBottom: '14px', alignItems: 'center' } },
        el('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flex: '1' } },
          el('h2', { style: { margin: '0', fontSize: 'var(--fs-lg)' } }, 'Job Description'),
          el('span', { class: 'notes-badge-pill' }, 'Markdown Formatted'),
        ),
        copyBtn,
      ),
      skillsSection,
      jdContentEl,
    );

    // Left Section 2: Dedicated Notes Panel below JD
    const notesPanel = buildNotesPanel(record);

    // Left column wrapping JD and Notes
    const leftCol = el('div', { class: 'detail-left-col' }, jdPanel, notesPanel, actions);

    // Right: PDF viewer via blob URL (Bearer-fetched, revoked on close)
    const frame = el('iframe', {
      class: 'pdf-frame',
      title: `Resume PDF for ${record.company}`,
      'aria-label': `Resume PDF for ${record.company}`,
    });

    const expandBtn = el('button', {
      class: 'btn btn-ghost btn-sm',
      title: 'Toggle Full Height',
      onclick: () => {
        frame.classList.toggle('pdf-fullscreen');
      },
    }, icon('expand', 14), 'Expand');

    const pdfTools = el('div', { class: 'pdf-toolbar row-wrap' },
      record.resume ? el('div', { class: 'pdf-meta-chip' },
        icon('pdf', 14),
        el('span', { class: 'pdf-name', text: record.resume.filename }),
        el('span', { class: 'faint small', text: fmtBytes(record.resume.size) }),
      ) : null,
      el('div', { class: 'grow' }),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: async () => {
          try {
            const blob = await fetchBlob(`/api/applications/${appId}/resume?download=1`);
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: record.resume?.filename || 'resume.pdf' });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, icon('download', 14), 'Download'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        id: 'open-tab',
        'aria-label': 'Open resume in new tab',
        onclick: (e) => { e.preventDefault(); openPdfNewTab(); },
      }, icon('external', 14), 'Open Tab'),
      expandBtn,
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => openNewApplicationDrawer(load, record),
      }, icon('refresh', 14), 'Replace'),
    );

    const pdfPanel = el('section', { class: 'card pdf-wrapper-card', 'aria-label': 'Resume' }, pdfTools, frame);

    async function loadPdf() {
      if (!record.resume) {
        frame.replaceWith(el('div', {
          class: 'card card-pad empty-state',
          style: { height: '480px', display: 'grid', placeItems: 'center' },
        }, el('p', { class: 'muted' }, 'No resume PDF attached.')));
        return;
      }
      try {
        const blob = await fetchBlob(`/api/applications/${appId}/resume`);
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        frame.src = url;
      } catch (err) {
        toast(`Could not load resume: ${err.message}`, 'error');
      }
    }

    async function openPdfNewTab() {
      try {
        const blob = await fetchBlob(`/api/applications/${appId}/resume`);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { toast(err.message, 'error'); }
    }

    // Mobile: tabs; desktop: split
    const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
    let container;
    if (isMobile()) {
      const leftPane = el('div', { role: 'tabpanel', id: 'tab-jd' }, leftCol);
      const pdfPane = el('div', { role: 'tabpanel', id: 'tab-pdf', hidden: true }, pdfPanel);
      const tabs = el('div', { class: 'tabs mb-4', role: 'tablist' },
        tabBtn('Job & Notes', leftPane, pdfPane, true),
        tabBtn('Resume PDF', pdfPane, leftPane, false),
      );
      container = el('div', {}, tabs, leftPane, pdfPane);
    } else {
      container = el('div', { class: 'detail-split' }, leftCol, pdfPanel);
    }
    loadPdf();
    return el('div', {}, back, header, container);
  }

  function tabBtn(label, showPane, hidePane, selected) {
    return el('button', {
      class: 'tab',
      role: 'tab',
      'aria-selected': String(selected),
      onclick: (e) => {
        showPane.hidden = false;
        hidePane.hidden = true;
        const parent = e.target.closest('.tabs');
        if (parent) {
          parent.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === e.target)));
        }
      },
    }, label);
  }

  load();
  return { destroy };
}

function buildNotesPanel(record) {
  const panel = el('section', { class: 'card notes-panel', 'aria-label': 'Personal Notes' });
  let isEditing = false;

  const header = el('div', { class: 'notes-header' },
    el('div', { class: 'notes-title' },
      icon('edit', 16),
      el('span', {}, 'Personal Notes'),
      el('span', { class: 'notes-badge-pill' }, 'Markdown Supported'),
    ),
  );

  const body = el('div', { class: 'notes-body' });

  function renderView() {
    body.innerHTML = '';
    header.querySelectorAll('.notes-header-action').forEach((a) => a.remove());

    if (isEditing) {
      const textarea = el('textarea', {
        class: 'textarea notes-editor-textarea',
        placeholder: 'Write personal notes in Markdown (# headings, **bold**, - checklists, interview prep, recruiter info)...',
        'aria-label': 'Personal Notes Editor',
      });
      textarea.value = record.notes || '';

      const saveBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
      }, icon('check', 14), 'Save Notes');

      const cancelBtn = el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => {
          isEditing = false;
          renderView();
        },
      }, 'Cancel');

      saveBtn.onclick = async () => {
        saveBtn.classList.add('loading');
        try {
          const val = textarea.value.trim();
          const fd = new FormData();
          fd.set('notes', val);
          await patchUpload(`/api/applications/${record.id}`, fd);
          record.notes = val;
          isEditing = false;
          toast('Notes updated successfully', 'success');
          renderView();
        } catch (err) {
          toast(err.message || 'Failed to update notes', 'error');
        } finally {
          saveBtn.classList.remove('loading');
        }
      };

      const editorBox = el('div', { class: 'notes-editor-box' },
        textarea,
        el('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
          el('span', { class: 'faint small' }, 'Supports Markdown: # header, **bold**, - lists, `code`, [link](url)'),
          el('div', { class: 'row', style: { gap: '8px' } }, cancelBtn, saveBtn),
        ),
      );

      body.append(editorBox);
      setTimeout(() => textarea.focus(), 50);
    } else {
      const editBtn = el('button', {
        class: 'btn btn-secondary btn-sm notes-header-action',
        onclick: () => {
          isEditing = true;
          renderView();
        },
      }, icon('edit', 14), 'Edit Notes');

      const copyBtn = el('button', {
        class: 'btn btn-ghost btn-sm notes-header-action',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(record.notes || '');
            toast('Notes copied to clipboard', 'success');
          } catch {
            toast('Could not copy notes', 'error');
          }
        },
      }, icon('copy', 14), 'Copy');

      const headerActions = el('div', { class: 'row notes-header-action', style: { gap: '8px' } },
        record.notes ? copyBtn : null,
        editBtn,
      );
      header.append(headerActions);

      if (record.notes && record.notes.trim()) {
        const mdContainer = el('div', { class: 'md-content' });
        mdContainer.innerHTML = renderMarkdown(record.notes);
        body.append(mdContainer);
      } else {
        const emptyBox = el('div', { class: 'notes-empty-state' },
          el('p', { class: 'muted small mb-3' }, 'No notes added for this application yet.'),
          el('button', {
            class: 'btn btn-primary btn-sm',
            onclick: () => {
              isEditing = true;
              renderView();
            },
          }, icon('plus', 14), 'Add Notes (Markdown)'),
        );
        body.append(emptyBox);
      }
    }
  }

  renderView();
  panel.append(header, body);
  return panel;
}

function highlightSkill(container, rawText, term) {
  if (!term || !rawText) {
    container.innerHTML = renderMarkdown(rawText || '*No job description saved.*');
    return;
  }
  container.innerHTML = renderMarkdown(rawText, term);
  const firstMatch = container.querySelector('mark.jd-highlight');
  if (firstMatch) {
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
