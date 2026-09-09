const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const shell = $('.app-shell');
const title = $('#page-title');
const subtitle = $('#page-subtitle');
const attachmentMenu = $('.attachment-menu');
const staged = $('.staged-attachments');

const meta = {
  hub: ['Hub', 'Frank client surfaces'],
  project: ['Project', 'Live project home'],
  files: ['Files', 'VPS Explorer'],
  alerts: ['Alerts', 'Only what needs action'],
  more: ['More', 'Window controls']
};

function isMobile() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function showView(name, projectName) {
  if (!meta[name]) name = 'hub';
  $$('.view').forEach(view => view.classList.toggle('is-active', view.dataset.view === name));
  $$('[data-go]').forEach(button => button.classList.toggle('is-active', button.dataset.go === name));
  $$('.bottom-nav button').forEach(button => {
    const selected = button.dataset.go === name || (name === 'files' && button.dataset.go === 'more');
    button.classList.toggle('is-active', selected);
  });
  if (name === 'project' && projectName) {
    $('#project-name').textContent = projectName;
    meta.project[1] = `${projectName} home`;
  }
  title.textContent = meta[name][0];
  subtitle.textContent = meta[name][1];
  shell.classList.remove('drawer-open', 'tree-open');
  $('.alert-drawer').setAttribute('aria-hidden', 'true');
  $('.mobile-tree-sheet').setAttribute('aria-hidden', 'true');
  if (history.replaceState) {
    const url = new URL(location.href);
    url.searchParams.set('view', name);
    history.replaceState({}, '', url);
  }
}

$$('[data-go]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  showView(button.dataset.go, button.dataset.project);
}));

$('.alerts-button').addEventListener('click', () => {
  shell.classList.add('drawer-open');
  $('.alert-drawer').setAttribute('aria-hidden', 'false');
});
$('.drawer-close').addEventListener('click', () => shell.classList.remove('drawer-open'));
$('.drawer-scrim').addEventListener('click', () => shell.classList.remove('drawer-open'));

$('.mobile-tree-trigger').addEventListener('click', () => {
  shell.classList.add('tree-open');
  $('.mobile-tree-sheet').setAttribute('aria-hidden', 'false');
});
$('.tree-sheet-close').addEventListener('click', () => shell.classList.remove('tree-open'));

$('.attach-trigger').addEventListener('click', event => {
  event.stopPropagation();
  attachmentMenu.hidden = !attachmentMenu.hidden;
});
document.addEventListener('click', event => {
  if (!event.target.closest('.attachment-picker')) attachmentMenu.hidden = true;
});

function stageAttachment(kind) {
  const folder = kind === 'folder';
  const chip = document.createElement('div');
  chip.className = 'staged-chip';
  chip.innerHTML = `<strong>${folder ? 'client-mockups' : 'screen-notes.pdf'}</strong><span>${folder ? '12 files · ready' : '840 KB · ready'}</span><button type="button" aria-label="Remove">×</button>`;
  chip.querySelector('button').addEventListener('click', () => chip.remove());
  staged.append(chip);
  attachmentMenu.hidden = true;
}

$$('[data-attach]').forEach(button => button.addEventListener('click', () => stageAttachment(button.dataset.attach)));

$('.composer').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('.composer textarea');
  if (!input.value.trim() && !staged.children.length) return;
  input.value = '';
  staged.replaceChildren();
});

$$('.file-row').forEach(row => row.addEventListener('click', () => {
  $$('.file-row').forEach(item => item.classList.remove('is-selected'));
  row.classList.add('is-selected');
}));

function resolveAlert(button) {
  const item = button.closest('.drawer-alert, .alert-card, .brief-row');
  if (!item) return;
  item.classList.add('is-resolved');
  window.setTimeout(() => item.remove(), 260);
  $$('.badge, .nav-icon-wrap i').forEach(badge => badge.textContent = '2');
  const note = $('.resolved-note');
  if (note) note.hidden = false;
}

$$('[data-resolve], [data-alert-action]').forEach(button => button.addEventListener('click', () => resolveAlert(button)));
$$('[data-dismiss]').forEach(button => button.addEventListener('click', () => resolveAlert(button)));

$('.offline-toggle').addEventListener('click', event => {
  event.currentTarget.classList.toggle('is-on');
  const enabled = event.currentTarget.classList.contains('is-on');
  $('.offline-banner').hidden = !enabled;
  $$('.live-pulse').forEach(dot => dot.style.background = enabled ? '#a15c2a' : '');
});

const releaseWidget = $('.loading-demo');
releaseWidget.classList.add('is-loading');
const params = new URLSearchParams(location.search);
if (params.get('loading') !== '1') window.setTimeout(() => releaseWidget.classList.remove('is-loading'), 900);
showView(params.get('view') || 'hub', params.get('project'));
if (params.get('alerts') === '1' && !isMobile()) {
  shell.classList.add('drawer-open');
  $('.alert-drawer').setAttribute('aria-hidden', 'false');
}
if (params.get('attach') === '1') attachmentMenu.hidden = false;
if (params.get('tree') === '1' && isMobile()) {
  shell.classList.add('tree-open');
  $('.mobile-tree-sheet').setAttribute('aria-hidden', 'false');
}
if (params.get('offline') === '1') {
  $('.offline-toggle').classList.add('is-on');
  $('.offline-banner').hidden = false;
}
