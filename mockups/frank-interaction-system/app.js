const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

const modules = [
  { group: 'Operate', id: 'overview', title: 'Overview', desc: 'Health, attention and recent changes.', icon: 'grid', state: 'healthy' },
  { group: 'Operate', id: 'workbench', title: 'Workbench', desc: 'Live delegated runs, artifacts and receipts.', icon: 'run', state: 'running' },
  { group: 'Operate', id: 'tasks', title: 'Task system', desc: 'Sources, mirrors and synchronisation health.', icon: 'check', state: 'healthy' },
  { group: 'Operate', id: 'research', title: 'Research pipeline', desc: 'Jobs, sources, stages and stalled work.', icon: 'pulse', state: 'warning' },
  { group: 'Knowledge', id: 'skills', title: 'Skills', desc: 'Versioned instruction and workflow packages.', icon: 'spark', state: 'healthy' },
  { group: 'Knowledge', id: 'knowledge', title: 'Memory & knowledge', desc: 'Memories, provenance and evidenced relations.', icon: 'brain', state: 'healthy' },
  { group: 'Knowledge', id: 'codegraph', title: 'Code graph', desc: 'Symbols, callers, callees and source paths.', icon: 'link', state: 'healthy' },
  { group: 'Knowledge', id: 'files', title: 'Files', desc: 'Repository, room folders, artifacts and previews.', icon: 'file', state: 'warning' },
  { group: 'Runtime', id: 'harness', title: 'Harness & Gateway', desc: 'Routes, sessions, models, drift and cost.', icon: 'route', state: 'healthy' },
  { group: 'Runtime', id: 'tools', title: 'Tools & Connectors', desc: 'MCP tools, external services and truthful health.', icon: 'settings', state: 'warning' },
  { group: 'Runtime', id: 'channels', title: 'Channels', desc: 'Room bindings, delivery and recovery state.', icon: 'link', state: 'healthy' },
  { group: 'Delivery', id: 'previews', title: 'Previews', desc: 'Hosted builds, comparison and promotion evidence.', icon: 'grid', state: 'healthy' },
  { group: 'Project tools', id: 'adstudio', title: 'Ad Template Anatomy', desc: 'Measured creative regions for Blockwise.', icon: 'grid', state: 'healthy' },
];

const skills = [
  { id: 'ask-matt', title: 'ask-matt', category: 'engineering', life: 'live', refs: '4 flows · 2 rooms', description: 'Route complex engineering decisions through an evidence-first expert review.', text: 'Collect the decision, constraints, alternatives and concrete evidence. Return a recommendation with risks and the smallest reversible next step.' },
  { id: 'preview-deploy', title: 'preview-deploy', category: 'engineering', life: 'live', refs: '7 flows · 5 projects', description: 'Deploy a hosted review surface before implementation work begins.', text: 'Create the smallest truthful hosted skeleton, return the public review URL, and iterate in place until the acceptance journey passes.' },
  { id: 'code-review', title: 'code-review', category: 'engineering', life: 'live', refs: '3 flows · 2 packs', description: 'Review changes for correctness, risk, evidence and maintainability.', text: 'Prioritise actionable defects. Tie every finding to a concrete path and consequence. Avoid style-only commentary unless it masks correctness.' },
  { id: 'morning-brief', title: 'morning-brief', category: 'productivity', life: 'live', refs: '1 routine · Frank', description: 'Assemble a concise daily brief from connected sources.', text: 'Merge calendar, work items, receipts and current blockers. State coverage honestly when a source is unavailable.' },
  { id: 'campaign-research', title: 'campaign-research', category: 'Blockwise', life: 'in progress', refs: 'Research pipeline', description: 'Build an evidenced creative research packet for a campaign.', text: 'Collect sources, score evidence, extract claims, identify visual patterns and produce a receipt-backed brief.' },
  { id: 'legacy-publish', title: 'legacy-publish', category: 'deprecated', life: 'deprecated', refs: '0 active refs', description: 'Old direct publishing workflow retained for historical receipts.', text: 'Deprecated. Use preview-deploy and the staged promotion flow instead.' },
];

const tools = [
  { id: 'google-calendar', name: 'Google Calendar', kind: 'Connector', status: 'healthy', last: '2m ago', calls: '18 today', detail: 'Read-only calendar coverage for Today and briefing skills.', deps: ['Today', 'morning-brief'] },
  { id: 'blockwise-api', name: 'Blockwise API', kind: 'Connector', status: 'degraded', last: '8m ago', calls: '42 today', detail: 'Research pipeline, templates and campaign artifacts. One stage is returning slowly.', deps: ['Research pipeline', 'campaign-research'] },
  { id: 'filesystem', name: 'Workspace Files', kind: 'Tool server', status: 'healthy', last: 'now', calls: '126 today', detail: 'Scoped repository and room file reads with staged write-back.', deps: ['Workbench', 'Files', 'code-review'] },
  { id: 'telegram', name: 'Telegram', kind: 'Channel', status: 'healthy', last: '14m ago', calls: '9 today', detail: 'Bound to Frank and Blockwise rooms. Frank remains authoritative during outages.', deps: ['Channels', 'Frank room'] },
  { id: 'zapier', name: 'Zapier MCP', kind: 'MCP server', status: 'paused', last: '3d ago', calls: '0 today', detail: 'Cross-service actions are intentionally paused. The next attempted use will be blocked honestly.', deps: ['invoice-followup', 'lead-routing'] },
  { id: 'mem0', name: 'mem0', kind: 'Memory provider', status: 'healthy', last: 'now', calls: '67 today', detail: 'Memory CRUD and retrieval for project-scoped recall.', deps: ['Memory', 'Composer context'] },
];

const state = {
  consoleView: 'overview',
  route: 'auto', routeScope: 'once', thinking: 'off',
  selectedSkill: 'ask-matt', skillFilter: 'all',
  harnessTab: 'routes', knowledgeTab: 'graph', filesTab: 'repository',
  selectedNode: 'console-decision', selectedTool: 'blockwise-api',
  stoppedRuns: new Set(), pausedTools: new Set(['zapier']),
};

const routeOptions = [
  { id: 'auto', title: 'Auto', sub: 'Frank chooses the best healthy route' },
  { id: 'fast', title: 'Fast', sub: 'low latency · everyday work' },
  { id: 'deep', title: 'Deep reasoning', sub: 'more deliberation · higher cost' },
  { id: 'code-builder', title: 'Code builder', sub: 'repository tools · workbench leash' },
  { id: 'exact', title: 'Exact setup…', sub: 'choose a model and harness directly' },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(title, detail = '', action = '') {
  const item = document.createElement('div');
  item.className = 'toast';
  item.innerHTML = `${icon('check')}<span><b>${escapeHtml(title)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>${action ? `<button>${escapeHtml(action)}</button>` : ''}`;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 4200);
}

function openDrawer(html) {
  $('#drawer').innerHTML = html;
  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
}

function drawerFrame(label, title, intro, body, footer) {
  return `<header class="drawer-head"><span>${label}</span><button class="drawer-close" data-action="close-drawer" aria-label="Close">${icon('close')}</button></header>
    <div class="drawer-body"><h2>${title}</h2><p>${intro}</p>${body}</div><footer class="drawer-footer">${footer}</footer>`;
}

function showDecision(id) {
  const calendar = id === 'calendar';
  const title = calendar ? 'Connect Google Calendar' : 'Publish Console route change';
  const intro = calendar ? 'Allow Frank to read calendar events so Today can show the full day.' : 'Change the preferred Frank route from Auto to Code builder for future delegated engineering runs.';
  const body = `<div class="meta-line"><span class="badge ${calendar ? 'good' : 'warn'}">${calendar ? 'Read only' : 'Persistent change'}</span><span class="badge">Evidence attached</span></div>
    <section class="drawer-section"><h3>Why now</h3><div class="prose-box">${calendar ? 'Today currently covers work items only. Calendar events are clearly marked as not connected.' : 'The last three engineering runs all selected the same healthy route and passed their acceptance checks.'}</div></section>
    <section class="drawer-section"><h3>Impact</h3><div class="impact-box">
      <div class="impact-row"><span>Changes</span><b>${calendar ? 'Today + morning brief coverage' : 'Next delegated engineering run'}</b></div>
      <div class="impact-row"><span>Does not change</span><b>${calendar ? 'No write or invite permissions' : 'Normal chat remains Auto'}</b></div>
      <div class="impact-row"><span>Reversible</span><b>Yes · from Console</b></div>
    </div></section>
    <section class="drawer-section"><h3>Evidence</h3><div class="relation-list"><div class="relation-card"><small>Evaluation</small><b>${calendar ? 'OAuth scope audit passed' : '3/3 route checks passed'}</b></div><div class="relation-card"><small>Estimated cost</small><b>${calendar ? '$0 · read only' : '+$0.04 per run'}</b></div></div></section>`;
  const footer = `<button class="button" data-action="decline-decision" data-id="${id}">Decline</button><button class="button primary" data-action="approve-decision" data-id="${id}">Approve</button>`;
  openDrawer(drawerFrame('Decision', title, intro, body, footer));
}

function resolveDecision(id, approved) {
  const row = $(`[data-decision="${id}"]`);
  if (row) row.remove();
  const count = Math.max(0, Number($('#waiting-count').textContent) - 1);
  $('#waiting-count').textContent = count;
  $('#mobile-frame-count').textContent = count;
  closeDrawer();
  toast(approved ? 'Decision approved' : 'Decision declined', approved ? 'The change is recorded and ready to continue.' : 'An honest decline receipt was added.');
}

function showRun(id) {
  const research = id === 'research';
  const title = research ? 'Competitor source check' : 'Build full interaction mock';
  const progress = research ? 'Stage 3 of 5 · extracting evidence' : '64% · rendering Console modules';
  const body = `<div class="meta-line"><span class="badge run">Running</span><span class="badge">${research ? 'deep' : 'code-builder'}</span><span class="badge">${research ? '$0.19' : '$0.31'} so far</span></div>
    <section class="drawer-section"><h3>Progress</h3><div class="impact-box"><div class="impact-row"><span>Current</span><b>${progress}</b></div><div class="impact-row"><span>Route</span><b>${research ? 'DeepSeek Reasoner via Goose' : 'DeepSeek Chat via container-agent'}</b></div><div class="impact-row"><span>Started</span><b>${research ? '12 minutes ago' : '8 minutes ago'}</b></div></div></section>
    <section class="drawer-section"><h3>Latest event</h3><div class="prose-box">${research ? 'Scored 18 sources. Two claims remain below the evidence threshold.' : 'Harness & Gateway route matrix rendered. Starting the mobile interaction pass.'}</div></section>
    <section class="drawer-section"><h3>Leash</h3><p>Stopping asks the harness to finish its current atomic action, then publishes a partial receipt with every artifact produced so far.</p></section>`;
  const footer = `<button class="button" data-action="close-drawer">Keep running</button><button class="button danger" data-action="stop-run" data-id="${id}">${icon('stop')}Stop run</button>`;
  openDrawer(drawerFrame('Running now', title, 'Inspect live progress without leaving the supervisory layer.', body, footer));
}

function stopRun(id) {
  const row = $(`[data-run="${id}"]`);
  if (row) row.remove();
  const running = Math.max(0, Number($('#running-count').textContent) - 1);
  $('#running-count').textContent = running;
  $('#receipt-count').textContent = Number($('#receipt-count').textContent) + 1;
  state.stoppedRuns.add(id);
  closeDrawer();
  toast('Run stopped', 'A partial receipt with produced artifacts is now in Receipts.');
}

function showReceipt(id) {
  const backup = id === 'backup';
  const body = `<div class="meta-line"><span class="badge good">Verified</span><span class="badge">${backup ? 'Operations' : 'Frank'}</span></div>
    <section class="drawer-section"><h3>Outcome</h3><div class="prose-box">${backup ? 'The encrypted VPS backup completed and the restore manifest passed its integrity check.' : 'Mapped Chat → Living Frame → Console, defined the route selector contract, and produced the operator journey artifact.'}</div></section>
    <section class="drawer-section"><h3>Run proof</h3><div class="impact-box"><div class="impact-row"><span>Route</span><b>${backup ? 'ops-safe via container-agent' : 'DeepSeek Reasoner via Goose'}</b></div><div class="impact-row"><span>Duration</span><b>${backup ? '2m 14s' : '38s'}</b></div><div class="impact-row"><span>Cost</span><b>${backup ? '$0.02' : '$0.06'}</b></div><div class="impact-row"><span>Mismatch</span><b>None</b></div></div></section>
    <section class="drawer-section"><h3>Artifacts</h3><div class="relation-list"><div class="relation-card"><small>Document</small><b>${backup ? 'restore-manifest.json' : 'interaction-model.md'}</b></div><div class="relation-card"><small>Provenance</small><b>7 evidenced relations</b></div></div></section>`;
  const footer = `<button class="button" data-action="close-drawer">Close</button><button class="button dark" data-action="open-console-receipt">Open in Workbench ${icon('arrow')}</button>`;
  openDrawer(drawerFrame('Receipt', backup ? 'VPS backup verified' : 'Interaction model mapped', 'A durable record of what happened, what ran, and what it produced.', body, footer));
}

function renderRouteMenu() {
  $('#route-menu').innerHTML = `<div class="menu-label">Route for this message or run</div>${routeOptions.map(option => `<button class="menu-option" data-route="${option.id}"><span><b>${option.title}</b><small>${option.sub}</small></span>${state.route === option.id ? icon('check', 'check') : ''}</button>`).join('')}
    ${state.route === 'exact' ? `<div class="menu-divider"></div><div class="advanced-grid"><label>Model<select id="exact-model"><option>DeepSeek Reasoner</option><option>DeepSeek Chat</option><option>Claude Sonnet</option></select></label><label>Harness<select id="exact-harness"><option>Goose</option><option>container-agent</option><option>CLI headless</option></select></label></div>` : ''}
    <div class="menu-divider"></div><div class="menu-label">Apply selection</div><div class="scope-choice"><div class="segmented">${['once','chat','default'].map(scope => `<button data-route-scope="${scope}" class="${state.routeScope === scope ? 'active' : ''}">${scope === 'once' ? 'Use once' : scope === 'chat' ? 'This chat' : 'Preferred'}</button>`).join('')}</div>${state.routeScope === 'default' ? '<small style="display:block;margin-top:7px;color:var(--warning);font:8.5px var(--mono)">Persistent defaults are confirmed in Console.</small>' : ''}</div>`;
}

function renderThinkingMenu() {
  const options = [
    ['off', 'Thinking off', 'answers straight away'],
    ['think', 'Think', 'short reasoning pass'],
    ['deep', 'Think harder', 'longer and more deliberate'],
  ];
  $('#thinking-menu').innerHTML = `<div class="menu-label">Extended thinking</div>${options.map(([id,title,sub]) => `<button class="menu-option" data-thinking="${id}"><span><b>${title}</b><small>${sub}</small></span>${state.thinking === id ? icon('check','check') : ''}</button>`).join('')}`;
}

function setRoute(id) {
  state.route = id;
  const route = routeOptions.find(item => item.id === id);
  $('#route-label').textContent = route ? route.title.replace('…','') : 'Auto';
  renderRouteMenu();
  if (id !== 'exact') setTimeout(() => { $('#route-menu').hidden = true; $('#route-trigger').setAttribute('aria-expanded', 'false'); }, 120);
}

function sendMessage() {
  const input = $('#composer-input');
  const value = input.value.trim();
  if (!value) return;
  const route = routeOptions.find(item => item.id === state.route)?.title || 'Auto';
  $('#chat-thread').insertAdjacentHTML('beforeend', `<article class="message user-message"><div class="message-meta">You · now</div><p>${escapeHtml(value)}</p></article><article class="message agent-message"><div class="agent-avatar">F</div><div class="message-body"><div class="message-meta">Frank · now</div><p>I’ve started this with <b>${escapeHtml(route)}</b>. It is visible in Running now, and the receipt will prove the actual model and harness used.</p><div class="done-frame"><span style="color:var(--running)">${icon('pulse')}Running</span><button data-action="run-detail" data-run="new-message">${escapeHtml(route)} · just started ${icon('chevron')}</button></div></div></article>`);
  input.value = '';
  input.style.height = 'auto';
  $('#chat-thread').scrollTop = $('#chat-thread').scrollHeight;
  toast('Run started', `${route} · visible in the Living Frame`);
}

function renderNav() {
  const groups = [...new Set(modules.map(m => m.group))];
  $('#console-nav-list').innerHTML = groups.map(group => `<div class="nav-group-title">${group}</div>${modules.filter(m => m.group === group).map(m => `<button class="console-nav-button ${state.consoleView === m.id ? 'active' : ''}" data-console-view="${m.id}">${icon(m.icon)}<span>${m.title}</span>${m.state !== 'running' ? `<em class="${m.state === 'warning' ? 'warn' : ''}"></em>` : ''}</button>`).join('')}`).join('');
}

function pageHead(eyebrow, title, description, actions = '') {
  return `<div class="page-head"><div class="page-title"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}

function moduleCard(m) {
  return `<button class="module-card" data-console-view="${m.id}"><div class="module-card-top"><span class="module-icon">${icon(m.icon)}</span><span class="module-state"><i class="${m.state === 'warning' ? 'warn' : ''}"></i>${m.state === 'warning' ? 'attention' : m.state}</span></div><h3>${m.title}</h3><p>${m.desc}</p><footer><span>${m.group}</span><em>Open →</em></footer></button>`;
}

function renderOverview() {
  const groups = ['Operate','Knowledge','Runtime','Delivery','Project tools'];
  return `<section class="console-page">${pageHead('Operations', 'Console', 'Understand the machine, intervene safely, and change persistent configuration. Normal work still begins in Chat.', `<button class="button" data-action="command">${icon('search')}Find anything</button><button class="button dark" data-console-view="workbench">${icon('pulse')}2 live runs</button>`)}
    <div class="health-strip"><div class="health-cell"><small><i class="status-dot healthy"></i>System</small><b>Operational</b><span>12 healthy · 2 degraded</span></div><div class="health-cell"><small><i class="status-dot running"></i>Active work</small><b>2 runs</b><span>1 workbench · 1 research</span></div><div class="health-cell"><small><i class="status-dot healthy"></i>Spend today</small><b>$3.84</b><span>72% below daily guide</span></div><div class="health-cell"><small><i class="status-dot warning"></i>Needs attention</small><b>2 items</b><span>connector + folder binding</span></div></div>
    <div class="attention-grid"><section class="panel"><header class="panel-head"><h2>Needs attention</h2><small>Truthful health only</small></header><div class="attention-row"><i class="status-dot warning"></i><span><b>Blockwise API is responding slowly</b><small>Research pipeline · p95 4.8s · since 10:31</small></span><button data-console-view="tools">Inspect →</button></div><div class="attention-row"><i class="status-dot warning"></i><span><b>Pavone room folder needs re-authorisation</b><small>Files · read unavailable · write-back already blocked</small></span><button data-console-view="files">Inspect →</button></div></section><section class="panel"><header class="panel-head"><h2>Recent changes</h2><small>Last 24 hours</small></header><div class="activity-row"><i class="status-dot healthy"></i><span><b>Frank route evaluated</b><small>Code builder · 3/3 passed</small></span></div><div class="activity-row"><i class="status-dot running"></i><span><b>preview-deploy updated</b><small>skill v1.8 · 2 references</small></span></div></section></div>
    ${groups.map(group => `<div class="section-label"><h2>${group}</h2><span></span></div><div class="module-grid">${modules.filter(m => m.group === group && m.id !== 'overview').map(moduleCard).join('')}</div>`).join('')}</section>`;
}

function renderSkills() {
  const filtered = state.skillFilter === 'all' ? skills : skills.filter(skill => skill.category.toLowerCase() === state.skillFilter || skill.life.replace(' ','-') === state.skillFilter);
  const active = skills.find(skill => skill.id === state.selectedSkill) || skills[0];
  return `<section class="console-page">${pageHead('Knowledge / registry', 'Skills', 'Browse the instruction packages Frank can use, understand their references, and launch one through a reviewable delegation.', `<button class="button">${icon('file')}Open skills folder</button><button class="button primary" data-action="use-skill" data-skill="${active.id}">${icon('play')}Use ${active.title}</button>`)}
    <div class="toolbar"><label class="search-field">${icon('search')}<input id="skill-search" placeholder="Search skills…"></label>${[['all','All'],['engineering','Engineering'],['productivity','Productivity'],['in-progress','In progress'],['deprecated','Deprecated']].map(([id,label]) => `<button class="filter-chip ${state.skillFilter===id?'active':''}" data-skill-filter="${id}">${label}</button>`).join('')}</div>
    <div class="split-view"><div class="split-list" id="skill-list">${filtered.map(skill => `<button class="list-row ${skill.id===active.id?'active':''}" data-skill-id="${skill.id}"><span><b>${skill.title}</b><small>${skill.category} · ${skill.refs}</small></span><span class="badge ${skill.life==='deprecated'?'danger':skill.life==='in progress'?'warn':'good'}">${skill.life}</span></button>`).join('')}</div><article class="split-detail"><div class="detail-pad"><div class="detail-title"><span><div class="eyebrow">${active.category} / SKILL.md</div><h2>${active.title}</h2><p>${active.description}</p></span><button class="icon-button">${icon('more')}</button></div><div class="meta-line"><span class="badge ${active.life==='deprecated'?'danger':active.life==='in progress'?'warn':'good'}">${active.life}</span><span class="badge">v1.8</span><span class="badge">Model invocation allowed</span></div><div class="subhead">Instruction preview</div><div class="prose-box">${active.text}</div><div class="subhead">Used by</div><div class="relation-list"><div class="relation-card"><small>Flow</small><b>engineering-delivery</b></div><div class="relation-card"><small>Room</small><b>Frank / central</b></div><div class="relation-card"><small>Pack</small><b>operator-core</b></div><div class="relation-card"><small>Last receipt</small><b>42 minutes ago</b></div></div></div></article></div></section>`;
}

function openSkillDelegation(skillId) {
  const skill = skills.find(item => item.id === skillId) || skills[0];
  const body = `<div class="meta-line"><span class="badge good">Skill attached</span><span class="badge">Review before launch</span></div><section class="drawer-section"><h3>Task</h3><label class="field">Instruction<textarea id="delegation-task">Use ${skill.title} to review the Console interaction system and return concrete improvements with evidence.</textarea></label></section><section class="drawer-section"><h3>Route</h3><div class="route-picker"><button class="route-pick active"><b>Auto</b><small>Recommended · Frank chooses a healthy route</small></button><button class="route-pick"><b>Code builder</b><small>Repository tools · workbench leash</small></button><button class="route-pick"><b>Deep reasoning</b><small>Longer evaluation · higher cost</small></button></div></section><section class="drawer-section"><h3>Expected result</h3><div class="impact-box"><div class="impact-row"><span>Creates</span><b>One workbench run</b></div><div class="impact-row"><span>Visibility</span><b>Running now → Workbench</b></div><div class="impact-row"><span>Completion</span><b>Receipt + artifacts</b></div></div></section>`;
  const footer = `<button class="button" data-action="close-drawer">Cancel</button><button class="button primary" data-action="launch-skill" data-skill="${skill.id}">${icon('play')}Start run</button>`;
  openDrawer(drawerFrame('New delegated run', `Use ${skill.title}`, 'The skill prepares the run; nothing starts until you review and launch it.', body, footer));
}

function renderHarness() {
  const tabButtons = [['routes','Routes'],['live','Live work'],['models','Models'],['usage','Usage & cost']].map(([id,label]) => `<button class="tab ${state.harnessTab===id?'active':''}" data-harness-tab="${id}">${label}</button>`).join('');
  let content = '';
  if (state.harnessTab === 'routes') {
    const rooms = [
      ['Frank','central','Auto','Goose → DeepSeek Reasoner','Evaluated 18m ago'],['Blockwise','research','Deep','Goose → DeepSeek Reasoner','Healthy'],['Pavone','project','Fast','DeepSeek direct → Chat','Healthy'],['Personal','private','Auto','Letta → DeepSeek Chat','Healthy'],['Operations','system','ops-safe','container-agent → Chat','Pinned'],
    ];
    content = `<div class="route-matrix">${rooms.map((r,i)=>`<article class="route-card"><header class="route-card-head"><i class="project-tint ${i===1?'coral':i===2?'green':'atlantic'}"></i><span><b>${r[0]}</b><small>${r[1]} · preferred ${r[2]}</small></span><span class="badge good">healthy</span></header><div class="route-flow"><strong>${r[2]}</strong><i>→</i><span>${r[3]}</span></div><footer><small>${r[4]}</small><button class="button small" data-action="edit-route" data-room="${r[0]}">Change</button></footer></article>`).join('')}</div>`;
  } else if (state.harnessTab === 'live') {
    content = `<div class="data-table"><div class="data-row head"><span>Run</span><span>Harness</span><span>Model</span><span>Cost</span><span></span></div><div class="data-row"><div class="cell-main"><i class="status-dot running"></i><span><b>Build interaction mock</b><small>Frank · 8m</small></span></div><span>container-agent</span><span>DeepSeek Chat</span><span>$0.31</span><button data-console-view="workbench">${icon('chevron')}</button></div><div class="data-row"><div class="cell-main"><i class="status-dot running"></i><span><b>Competitor source check</b><small>Blockwise · 12m</small></span></div><span>Goose</span><span>DeepSeek Reasoner</span><span>$0.19</span><button data-console-view="research">${icon('chevron')}</button></div></div>`;
  } else if (state.harnessTab === 'models') {
    content = `<div class="model-inventory"><article class="model-card"><header><b>DeepSeek</b><i class="status-dot healthy"></i></header><h3>DeepSeek Chat</h3><p>fast-general · code-builder<br>key present · expected model matches</p><div class="cost-bar"><i style="width:38%"></i></div></article><article class="model-card"><header><b>DeepSeek</b><i class="status-dot healthy"></i></header><h3>DeepSeek Reasoner</h3><p>deep-reasoning<br>key present · expected model matches</p><div class="cost-bar"><i style="width:68%"></i></div></article><article class="model-card"><header><b>Anthropic</b><i class="status-dot warning"></i></header><h3>Claude Sonnet</h3><p>code-builder · long-context<br>key present · provider not enabled for runs</p><div class="cost-bar"><i style="width:0%"></i></div></article></div>`;
  } else {
    content = `<div class="metric-grid"><div class="metric"><small>Today</small><b>$3.84</b><span>41 runs</span></div><div class="metric"><small>Yesterday</small><b>$5.21</b><span>58 runs</span></div><div class="metric"><small>Highest route</small><b>Deep</b><span>$1.94 today</span></div><div class="metric"><small>Fallbacks</small><b>1</b><span>2.4% of runs</span></div></div><div class="data-table"><div class="data-row head"><span>Route / model</span><span>Runs</span><span>Tokens</span><span>Cost</span><span></span></div>${[['DeepSeek Reasoner via Goose','12','1.2m','$1.94'],['DeepSeek Chat direct','18','640k','$1.08'],['DeepSeek Chat via container-agent','11','482k','$0.82']].map(row=>`<div class="data-row"><div class="cell-main"><span><b>${row[0]}</b><small>no mismatch warnings</small></span></div><span>${row[1]}</span><span>${row[2]}</span><span>${row[3]}</span><button>${icon('chevron')}</button></div>`).join('')}</div>`;
  }
  return `<section class="console-page">${pageHead('Runtime / routing', 'Harness & Gateway', 'One place to answer what can run your work, what is healthy, what it costs, and what actually ran.', `<button class="button">${icon('pulse')}Run health check</button><button class="button primary" data-action="edit-route" data-room="Frank">${icon('route')}Change Frank route</button>`)}<div class="tabs">${tabButtons}</div>${content}</section>`;
}

function openRouteDrawer(room) {
  const body = `<div class="meta-line"><span class="badge good">Current route healthy</span><span class="badge">${room} room</span></div><section class="drawer-section"><h3>Choose preferred route</h3><div class="route-picker"><button class="route-pick active" data-drawer-route="auto"><b>Auto</b><small>Score healthy routes for each task</small></button><button class="route-pick" data-drawer-route="fast"><b>Fast</b><small>DeepSeek Chat · direct provider</small></button><button class="route-pick" data-drawer-route="deep"><b>Deep reasoning</b><small>Goose · DeepSeek Reasoner</small></button><button class="route-pick" data-drawer-route="code-builder"><b>Code builder</b><small>container-agent · repository tools</small></button></div></section><section class="drawer-section"><h3>Apply as</h3><div class="impact-box"><div class="impact-row"><span>Scope</span><b>Preferred route for ${room}</b></div><div class="impact-row"><span>Begins</span><b>Next new turn or run</b></div><div class="impact-row"><span>Proof</span><b>Recorded in each done-frame</b></div></div></section><section class="drawer-section"><h3>Safety</h3><p>This does not interrupt work already running. Frank will fall back only when the preferred route is unhealthy and will mark the mismatch.</p></section>`;
  const footer = `<button class="button" data-action="close-drawer">Cancel</button><button class="button primary" data-action="save-route" data-room="${room}">Save preferred route</button>`;
  openDrawer(drawerFrame('Change route', `${room} routing`, 'Compare the route, scope and consequence before changing a persistent default.', body, footer));
}

function renderKnowledge() {
  const tabs = [['memories','Memories'],['graph','Knowledge graph'],['provenance','Provenance feed']].map(([id,label])=>`<button class="tab ${state.knowledgeTab===id?'active':''}" data-knowledge-tab="${id}">${label}</button>`).join('');
  let content = '';
  if (state.knowledgeTab === 'memories') {
    content = `<div class="split-view"><div class="split-list">${[['console-decision','Console is an operator surface','product · 7 relations'],['preview-rule','Preview-first delivery','workflow · 12 relations'],['route-preference','Auto is the normal default','preference · 5 relations'],['blockwise-sources','Campaign evidence threshold','project · 9 relations']].map((m,i)=>`<button class="list-row ${i===0?'active':''}"><span><b>${m[1]}</b><small>${m[2]}</small></span><span class="badge good">active</span></button>`).join('')}</div><article class="split-detail"><div class="detail-pad"><div class="eyebrow">Product memory</div><div class="detail-title"><span><h2>Console is an operator surface</h2><p>The Console is where a human understands, configures or intervenes in Frank’s systems. It is not a settings page.</p></span></div><div class="meta-line"><span class="badge good">Active</span><span class="badge">Confidence 0.96</span><span class="badge">Frank scope</span></div><div class="subhead">Source</div><div class="prose-box">Recorded from the Living Frame + Console design decision and supported by the product specification.</div><div class="subhead">Controls</div><div class="head-actions"><button class="button">Edit</button><button class="button">Expire</button><button class="button danger">Delete</button></div></div></article></div>`;
  } else if (state.knowledgeTab === 'provenance') {
    content = `<div class="data-table"><div class="data-row head"><span>Evidence</span><span>Relation</span><span>Target</span><span>Confidence</span><span></span></div>${[['interaction-model.md','supports','Console decision','0.98'],['Receipt #wb-184','produced','interaction-model.md','1.00'],['preview-deploy','used by','Workbench #184','1.00'],['Frank specification','defines','Operator Console','0.96']].map(row=>`<div class="data-row"><div class="cell-main">${icon('link')}<span><b>${row[0]}</b><small>evidenced relation</small></span></div><span>${row[1]}</span><span>${row[2]}</span><span>${row[3]}</span><button>${icon('chevron')}</button></div>`).join('')}</div>`;
  } else {
    const nodes = [
      ['console-decision','Memory','Console is operator surface','27%','31%','memory'],['ux-map','Receipt','Interaction model mapped','54%','20%','receipt'],['preview-rule','Memory','Preview-first delivery','24%','69%','memory'],['skill-preview','Skill','preview-deploy','53%','77%','skill'],['room-frank','Room','Frank','77%','48%',''],['run-184','Workbench','Run #184','78%','76%','receipt'],
    ];
    const selected = nodes.find(n=>n[0]===state.selectedNode)||nodes[0];
    content = `<div class="graph-shell"><div class="graph-canvas"><svg class="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none"><line class="hot" x1="27" y1="31" x2="54" y2="20"/><line x1="27" y1="31" x2="24" y2="69"/><line x1="24" y1="69" x2="53" y2="77"/><line x1="54" y1="20" x2="77" y2="48"/><line x1="53" y1="77" x2="78" y2="76"/><line x1="77" y1="48" x2="78" y2="76"/></svg>${nodes.map(n=>`<button class="graph-node ${n[5]} ${n[0]===state.selectedNode?'active':''}" style="left:${n[3]};top:${n[4]}" data-node="${n[0]}"><b>${n[2]}</b><small>${n[1]}</small></button>`).join('')}</div><aside class="graph-inspector"><div class="eyebrow">${selected[1]}</div><h2>${selected[2]}</h2><p>Only relations with an evidence record are shown. Sparse is more truthful than inferred.</p><div class="subhead">Connected by</div><div class="edge-row"><small>Supported by</small><b>interaction-model.md</b></div><div class="edge-row"><small>Produced in</small><b>Workbench run #184</b></div><div class="edge-row"><small>Scoped to</small><b>Frank room</b></div><div class="subhead">Controls</div><button class="button small">Open source</button></aside></div>`;
  }
  return `<section class="console-page">${pageHead('Knowledge / evidence', 'Memory & Knowledge', 'Review what Frank remembers and follow the real evidence connecting memories, work, rooms, skills and receipts.', `<button class="button">${icon('search')}Search all</button><button class="button">Export evidence</button>`)}<div class="tabs">${tabs}</div>${content}</section>`;
}

function renderTools() {
  const active = tools.find(tool=>tool.id===state.selectedTool)||tools[0];
  const effectiveStatus = state.pausedTools.has(active.id) ? 'paused' : active.status;
  return `<section class="console-page">${pageHead('Runtime / dependencies', 'Tools & Connectors', 'Every external dependency with truthful health, impact, recent use and an operator pause switch.', `<button class="button">${icon('pulse')}Test all healthy</button><button class="button primary">${icon('plus')}Add connector</button>`)}
    <div class="toolbar"><label class="search-field">${icon('search')}<input placeholder="Search tools and connectors…"></label><button class="filter-chip active">All 6</button><button class="filter-chip">Degraded 1</button><button class="filter-chip">Paused 1</button></div>
    <div class="split-view"><div class="split-list">${tools.map(tool=>{const st=state.pausedTools.has(tool.id)?'paused':tool.status;return `<button class="list-row ${tool.id===active.id?'active':''}" data-tool-id="${tool.id}"><i class="status-dot ${st==='degraded'?'warning':st}"></i><span><b>${tool.name}</b><small>${tool.kind} · ${tool.last}</small></span><span class="badge ${st==='healthy'?'good':st==='degraded'?'warn':''}">${st}</span></button>`}).join('')}</div><article class="split-detail"><div class="detail-pad"><div class="detail-title"><span><div class="eyebrow">${active.kind}</div><h2>${active.name}</h2><p>${active.detail}</p></span><i class="status-dot ${effectiveStatus==='degraded'?'warning':effectiveStatus}"></i></div><div class="meta-line"><span class="badge ${effectiveStatus==='healthy'?'good':effectiveStatus==='degraded'?'warn':''}">${effectiveStatus}</span><span class="badge">Last success ${active.last}</span><span class="badge">${active.calls}</span></div><div class="subhead">Used by</div><div class="relation-list">${active.deps.map(dep=>`<div class="relation-card"><small>Dependency</small><b>${dep}</b></div>`).join('')}</div><div class="subhead">Recent health</div><div class="impact-box"><div class="impact-row"><span>Availability</span><b>${effectiveStatus==='degraded'?'96.2% · below guide':'99.98%'}</b></div><div class="impact-row"><span>Last error</span><b>${effectiveStatus==='degraded'?'Timeout · stage extract':'None in 7 days'}</b></div><div class="impact-row"><span>Credentials</span><b>Present · rotated 21d ago</b></div></div><div class="subhead">Controls</div><div class="head-actions"><button class="button" data-action="test-tool" data-id="${active.id}">${icon('pulse')}Test now</button><button class="button ${effectiveStatus==='paused'?'primary':'danger'}" data-action="toggle-tool" data-id="${active.id}">${effectiveStatus==='paused'?'Resume':'Pause'}</button></div></div></article></div></section>`;
}

function renderWorkbench() {
  return `<section class="console-page">${pageHead('Operate / delegated work', 'Workbench', 'Follow runs step by step, use the leash, inspect artifacts, and retain an honest receipt even when work is stopped.', `<button class="button">Receipts</button><button class="button primary" data-action="new-delegation">${icon('plus')}New run</button>`)}
    <div class="metric-grid"><div class="metric"><small>Running</small><b>2</b><span>1 code · 1 research</span></div><div class="metric"><small>Waiting</small><b>1</b><span>approval required</span></div><div class="metric"><small>Completed today</small><b>14</b><span>13 verified</span></div><div class="metric"><small>Cost today</small><b>$2.76</b><span>workbenches only</span></div></div>
    <div class="workbench-layout"><section class="run-list"><header class="panel-head"><h2>Runs</h2><small>Today</small></header><button class="list-row active"><i class="status-dot running"></i><span><b>Build interaction mock</b><small>Frank · code-builder · 8m</small><div class="progress-track"><i style="width:64%"></i></div></span></button><button class="list-row"><i class="status-dot warning"></i><span><b>Competitor source check</b><small>Blockwise · stage 3/5</small><div class="progress-track"><i style="width:48%"></i></div></span></button><button class="list-row"><i class="status-dot healthy"></i><span><b>VPS backup verification</b><small>Operations · finished 8m ago</small></span></button></section><section class="run-detail"><header class="panel-head"><h2>Build interaction mock</h2><span class="badge run">running</span><button class="button small danger" data-action="run-detail" data-run="prototype">${icon('stop')}Stop</button></header><div class="run-step"><i class="step-mark">✓</i><span><b>Create hosted skeleton</b><small>Preview lane allocated</small></span><time>1m 12s</time></div><div class="run-step"><i class="step-mark">✓</i><span><b>Build Chat and Living Frame</b><small>Supervisor interactions connected</small></span><time>3m 46s</time></div><div class="run-step"><i class="step-mark running">3</i><span><b>Render Console modules</b><small>Harness & Gateway complete · verifying Knowledge</small></span><time>running</time></div><div class="run-step"><i class="step-mark wait">4</i><span><b>Hosted browser verification</b><small>Critical journeys and mobile width</small></span><time>queued</time></div><div class="log-box">10:54:21  route   code-builder → container-agent / deepseek-chat
10:56:04  artifact styles.css published
10:57:48  verify  route change drawer connected
10:58:02  step    rendering Knowledge graph</div></section></div></section>`;
}

function renderResearch() {
  return `<section class="console-page">${pageHead('Operate / Blockwise', 'Research Pipeline', 'See where each research job is, inspect its sources, and intervene when evidence or infrastructure blocks progress.', `<button class="button">Pipeline health</button><button class="button primary">${icon('plus')}New research job</button>`)}
    <div class="metric-grid"><div class="metric"><small>Active jobs</small><b>3</b><span>1 needs attention</span></div><div class="metric"><small>Sources today</small><b>126</b><span>84 accepted</span></div><div class="metric"><small>Evidence pass</small><b>78%</b><span>guide ≥ 72%</span></div><div class="metric"><small>Median run</small><b>11m</b><span>down 2m</span></div></div>
    <div class="split-view"><div class="split-list"><button class="list-row active"><i class="status-dot running"></i><span><b>Competitor source check</b><small>18 sources · stage 3/5</small></span></button><button class="list-row"><i class="status-dot warning"></i><span><b>Home energy claims</b><small>6 weak claims · review</small></span></button><button class="list-row"><i class="status-dot healthy"></i><span><b>Spring visual patterns</b><small>Complete · 1h ago</small></span></button></div><article class="split-detail"><div class="detail-pad"><div class="detail-title"><span><div class="eyebrow">Blockwise / job 284</div><h2>Competitor source check</h2><p>Collecting primary evidence for the next creative brief.</p></span><button class="button small danger">${icon('stop')}Stop</button></div><div class="pipeline"><div class="pipeline-stage done"><small>1 · collect</small><b>26 sources</b></div><div class="pipeline-stage done"><small>2 · score</small><b>18 accepted</b></div><div class="pipeline-stage running"><small>3 · extract</small><b>42 claims</b></div><div class="pipeline-stage"><small>4 · synthesize</small><b>Waiting</b></div><div class="pipeline-stage"><small>5 · receipt</small><b>Waiting</b></div></div><div class="subhead">Current stage</div><div class="impact-box"><div class="impact-row"><span>Progress</span><b>31 of 42 claims extracted</b></div><div class="impact-row"><span>Warning</span><b>Blockwise API p95 is 4.8s</b></div><div class="impact-row"><span>Action</span><b>No intervention required yet</b></div></div><div class="subhead">Latest sources</div><div class="relation-list"><div class="relation-card"><small>Primary · accepted</small><b>Competitor pricing page</b></div><div class="relation-card"><small>Primary · accepted</small><b>Product specification</b></div><div class="relation-card"><small>Secondary · review</small><b>Industry benchmark</b></div><div class="relation-card"><small>Rejected</small><b>Unsourced comparison</b></div></div></div></article></div></section>`;
}

function renderFiles() {
  const tabs = [['repository','Repository'],['rooms','Room folders'],['artifacts','Artifacts'],['previews','Previews']].map(([id,label])=>`<button class="tab ${state.filesTab===id?'active':''}" data-files-tab="${id}">${label}</button>`).join('');
  const repoContent = `<div class="files-layout"><aside class="file-locations"><div class="tree-label">Locations</div><button class="tree-row active">▾ Frank repository</button><button class="tree-row">　▸ apps</button><button class="tree-row">　▸ packages</button><button class="tree-row">　▾ skills</button><button class="tree-row">　　engineering</button><button class="tree-row">　　productivity</button><div class="tree-label">Pinned</div><button class="tree-row">★ AGENTS.md</button><button class="tree-row">★ product spec</button></aside><section class="file-list"><div class="tree-label">skills / engineering</div><button class="file-item active">${icon('file')}<span><b>preview-deploy/SKILL.md</b><small>4.2 KB · changed today</small></span></button><button class="file-item">${icon('file')}<span><b>code-review/SKILL.md</b><small>6.8 KB · 3d ago</small></span></button><button class="file-item">${icon('file')}<span><b>frank-tdd/SKILL.md</b><small>5.1 KB · 6d ago</small></span></button></section><article class="file-preview"><div class="detail-title"><span><div class="eyebrow">Read only · live repository</div><h2>preview-deploy / SKILL.md</h2><p>Versioned instruction package</p></span><button class="button small" data-console-view="skills">Open in Skills</button></div><div class="code-preview" style="margin-top:15px">---
name: preview-deploy
description: Create a hosted review surface before implementation.
---

# Preview-first delivery

1. Deploy the smallest truthful skeleton.
2. Return the public review URL.
3. Iterate against that hosted surface.
4. Record acceptance evidence.</div></article></div>`;
  let content = repoContent;
  if (state.filesTab === 'rooms') content = `<div class="data-table"><div class="data-row head"><span>Room / folder</span><span>Mount</span><span>Write-back</span><span>Health</span><span></span></div>${[['Frank / Documents','read + staged','approval required','healthy'],['Blockwise / Campaigns','read + artifacts','disabled','healthy'],['Pavone / Workspace','read only','blocked','warning']].map(row=>`<div class="data-row"><div class="cell-main"><i class="status-dot ${row[3]}"></i><span><b>${row[0]}</b><small>server binding</small></span></div><span>${row[1]}</span><span>${row[2]}</span><span class="badge ${row[3]==='healthy'?'good':'warn'}">${row[3]==='warning'?'reauthorise':row[3]}</span><button>${icon('chevron')}</button></div>`).join('')}</div>`;
  if (state.filesTab === 'artifacts') content = `<div class="preview-grid">${[['interaction-model.md','Workbench #184'],['source-packet.json','Research #284'],['restore-manifest.json','Operations #92']].map((p,i)=>`<article class="preview-card"><div class="preview-thumb"><div class="mini-browser"><i></i><b></b><b style="width:48%"></b></div></div><footer><span><b>${p[0]}</b><small>${p[1]}</small></span><button class="icon-button">${icon('arrow')}</button></footer></article>`).join('')}</div>`;
  if (state.filesTab === 'previews') content = renderPreviewCards();
  return `<section class="console-page">${pageHead('Knowledge / workspace', 'Files', 'One coherent place for repository content, room bindings, produced artifacts and hosted previews.', `<button class="button">${icon('search')}Search files</button><button class="button">AI tidy</button>`)}<div class="tabs">${tabs}</div>${content}</section>`;
}

function renderTasks() {
  return `<section class="console-page">${pageHead('Operate / synchronisation', 'Task system', 'Diagnose the task sources behind Today. Everyday task capture and completion remain in Chat and the Living Frame.', `<button class="button">Sync now</button><button class="button primary">${icon('plus')}Create work item</button>`)}<div class="metric-grid"><div class="metric"><small>Open work</small><b>18</b><span>5 due today</span></div><div class="metric"><small>Plane mirror</small><b>Healthy</b><span>synced 2m ago</span></div><div class="metric"><small>Google Tasks</small><b>Healthy</b><span>phone mirror · 4m</span></div><div class="metric"><small>Conflicts</small><b>0</b><span>last 7 days</span></div></div><div class="data-table"><div class="data-row head"><span>Work item</span><span>Source</span><span>State</span><span>Updated</span><span></span></div>${[['Review Console prototype','Frank domain','waiting','now'],['Campaign source approval','Plane / Blockwise','ready','12m'],['Renew signing certificate','Google Tasks','staged','1h'],['VPS backup verification','Frank domain','done','2h']].map((row,i)=>`<div class="data-row"><div class="cell-main"><i class="status-dot ${i===0?'warning':i===3?'healthy':'running'}"></i><span><b>${row[0]}</b><small>work item</small></span></div><span>${row[1]}</span><span class="badge ${row[2]==='done'?'good':row[2]==='waiting'?'warn':'run'}">${row[2]}</span><span>${row[3]}</span><button>${icon('chevron')}</button></div>`).join('')}</div></section>`;
}

function renderChannels() {
  return `<section class="console-page">${pageHead('Runtime / bindings', 'Channels', 'Bind rooms to external conversations, verify delivery, and preserve Frank as the authoritative record during outages.', `<button class="button">Test delivery</button><button class="button primary">${icon('plus')}Bind channel</button>`)}<div class="metric-grid"><div class="metric"><small>Bound rooms</small><b>2</b><span>Frank + Blockwise</span></div><div class="metric"><small>Delivery today</small><b>100%</b><span>18 of 18</span></div><div class="metric"><small>Revoked</small><b>0</b><span>no stale bindings</span></div><div class="metric"><small>Last inbound</small><b>14m</b><span>Telegram</span></div></div><div class="data-table"><div class="data-row head"><span>Room / channel</span><span>Binding</span><span>Delivery</span><span>Last event</span><span></span></div><div class="data-row"><div class="cell-main"><i class="status-dot healthy"></i><span><b>Frank → Telegram</b><small>central operator room</small></span></div><span>@frank_operator</span><span class="badge good">active</span><span>14m ago</span><button>${icon('chevron')}</button></div><div class="data-row"><div class="cell-main"><i class="status-dot healthy"></i><span><b>Blockwise → Telegram</b><small>campaign room</small></span></div><span>@blockwise_ops</span><span class="badge good">active</span><span>48m ago</span><button>${icon('chevron')}</button></div><div class="data-row"><div class="cell-main"><i class="status-dot paused"></i><span><b>Pavone</b><small>no channel bound</small></span></div><span>—</span><span class="badge">not bound</span><span>—</span><button>${icon('plus')}</button></div></div></section>`;
}

function renderCodeGraph() {
  const nodes = [['shell','frank-shell.tsx','Shell','28%','24%'],['frame','LivingFrame','Component','67%','23%'],['composer','ComposerBar','Component','26%','67%'],['providers','resolveHarness','Function','66%','66%'],['api','/api/chat','Route','47%','47%']];
  return `<section class="console-page">${pageHead('Knowledge / source structure', 'Code Graph', 'Explore symbols and real call paths. This is source structure—not the memory and provenance graph.', `<button class="button">${icon('search')}Find symbol</button><button class="button">Rebuild graph</button>`)}<div class="graph-shell"><div class="graph-canvas"><svg class="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none"><line class="hot" x1="28" y1="24" x2="67" y2="23"/><line x1="28" y1="24" x2="26" y2="67"/><line x1="28" y1="24" x2="47" y2="47"/><line x1="47" y1="47" x2="66" y2="66"/><line x1="26" y1="67" x2="47" y2="47"/></svg>${nodes.map((n,i)=>`<button class="graph-node ${i===0?'active':''}" style="left:${n[3]};top:${n[4]}"><b>${n[1]}</b><small>${n[2]}</small></button>`).join('')}</div><aside class="graph-inspector"><div class="eyebrow">File</div><h2>frank-shell.tsx</h2><p>The chat-first shell owns navigation, conversations, route state and the Living Frame connection.</p><div class="subhead">Calls</div><div class="edge-row"><small>Renders</small><b>LivingFrame</b></div><div class="edge-row"><small>Renders</small><b>ComposerBar</b></div><div class="edge-row"><small>Invokes</small><b>/api/chat</b></div><div class="subhead">Source</div><button class="button small">Open file</button></aside></div></section>`;
}

function renderPreviewCards() {
  return `<div class="preview-grid">${[['frank-interaction-system-v1','Current · updated now'],['living-frame-console-v2','Previous concept · 23m'],['frank-my-v4','Product flow · 2h']].map((p,i)=>`<article class="preview-card"><div class="preview-thumb"><div class="mini-browser"><i style="width:${i===0?'64':'46'}%"></i><b></b><b style="width:52%"></b></div></div><footer><span><b>${p[0]}</b><small>${p[1]}</small></span><button class="icon-button" data-action="preview-open">${icon('arrow')}</button></footer></article>`).join('')}</div>`;
}

function renderPreviews() {
  return `<section class="console-page">${pageHead('Delivery / hosted review', 'Previews', 'Open, compare and retain hosted review surfaces before anything is promoted to production.', `<button class="button">Compare selected</button><button class="button primary">${icon('plus')}Deploy preview</button>`)}<div class="metric-grid"><div class="metric"><small>Active topics</small><b>8</b><span>14 preserved versions</span></div><div class="metric"><small>Updated today</small><b>4</b><span>all reachable</span></div><div class="metric"><small>Browser checks</small><b>12/12</b><span>latest version</span></div><div class="metric"><small>Production gates</small><b>0</b><span>no pending promotion</span></div></div>${renderPreviewCards()}</section>`;
}

function renderAdStudio() {
  return `<section class="console-page">${pageHead('Project tools / Blockwise', 'Ad Template Anatomy', 'Inspect measured creative regions, simulate content changes, and prove that the template geometry remains stable.', `<button class="button">Reset</button><button class="button primary">Apply simulation</button>`)}<div class="anatomy-layout"><div class="template-stage"><div class="ad-canvas"><div class="ad-copy">Make the <em>system</em> visible.</div><div class="ad-cta">OPEN THE CONSOLE →</div><div class="region r1" data-label="headline · 62 chars"></div><div class="region r2" data-label="cta · locked"></div></div></div><aside class="anatomy-panel"><div class="eyebrow">Selected region</div><h2 style="font-size:17px;margin:5px 0">Headline</h2><div class="meta-line"><span class="badge good">Within bounds</span><span class="badge">62 / 74 chars</span></div><label class="field">Copy<textarea>Make the system visible.</textarea></label><label class="field">Fit mode<select><option>Scale type within region</option><option>Reject overflow</option></select></label><label class="field">Maximum lines<input value="3"></label><div class="subhead">Measured box</div><div class="impact-box"><div class="impact-row"><span>Position</span><b>x 36 · y 112</b></div><div class="impact-row"><span>Size</span><b>354 × 204</b></div><div class="impact-row"><span>Movement</span><b>0 px</b></div></div></aside></div></section>`;
}

function renderConsole() {
  renderNav();
  const renderers = { overview: renderOverview, skills: renderSkills, harness: renderHarness, knowledge: renderKnowledge, tools: renderTools, workbench: renderWorkbench, research: renderResearch, files: renderFiles, tasks: renderTasks, channels: renderChannels, codegraph: renderCodeGraph, previews: renderPreviews, adstudio: renderAdStudio };
  $('#console-main').innerHTML = (renderers[state.consoleView] || renderOverview)();
  $('#console-main').scrollTop = 0;
}

function openConsole(view = 'overview') {
  state.consoleView = view;
  $('#home-shell').hidden = true;
  $('#console-shell').hidden = false;
  renderConsole();
}

function openFrank() {
  $('#console-shell').hidden = true;
  $('#home-shell').hidden = false;
  closeDrawer();
}

function renderCommandResults(query = '') {
  const q = query.toLowerCase();
  const found = modules.filter(m => `${m.title} ${m.desc} ${m.group}`.toLowerCase().includes(q));
  $('#command-results').innerHTML = `<div class="command-group">Modules</div>${found.map(m=>`<button class="command-item" data-command-view="${m.id}">${icon(m.icon)}<span><b>${m.title}</b><small>${m.group} · ${m.desc}</small></span>${icon('chevron')}</button>`).join('') || '<div class="empty-state">No matching module.</div>'}`;
}

function openCommand() {
  $('#command-modal').hidden = false;
  renderCommandResults('');
  setTimeout(() => $('#command-search').focus(), 30);
}

function closeCommand() { $('#command-modal').hidden = true; }

document.addEventListener('click', event => {
  const target = event.target.closest('button,[data-action],[data-console-view],[data-route],[data-thinking],[data-route-scope],[data-skill-id],[data-skill-filter],[data-harness-tab],[data-knowledge-tab],[data-node],[data-tool-id],[data-files-tab],[data-command-view]');
  if (!target) return;
  const action = target.dataset.action;
  if (target.id === 'open-console') return openConsole('overview');
  if (target.id === 'back-to-frank') return openFrank();
  if (target.id === 'route-trigger') {
    const menu = $('#route-menu'); renderRouteMenu(); menu.hidden = !menu.hidden; $('#thinking-menu').hidden = true; target.setAttribute('aria-expanded', String(!menu.hidden)); return;
  }
  if (target.id === 'thinking-trigger') { const menu=$('#thinking-menu'); renderThinkingMenu(); menu.hidden=!menu.hidden; $('#route-menu').hidden=true; return; }
  if (target.dataset.route) return setRoute(target.dataset.route);
  if (target.dataset.thinking) { state.thinking=target.dataset.thinking; $('#thinking-label').textContent=state.thinking==='off'?'Thinking':state.thinking==='think'?'Think':'Think harder'; $('#thinking-menu').hidden=true; return; }
  if (target.dataset.routeScope) { state.routeScope=target.dataset.routeScope; renderRouteMenu(); if(state.routeScope==='default') toast('Persistent change requires Console','The route is staged for review in Harness & Gateway.'); return; }
  if (target.dataset.consoleView) { if($('#console-shell').hidden) openConsole(target.dataset.consoleView); else { state.consoleView=target.dataset.consoleView; renderConsole(); } return; }
  if (target.dataset.commandView) { closeCommand(); openConsole(target.dataset.commandView); return; }
  if (target.dataset.skillId) { state.selectedSkill=target.dataset.skillId; renderConsole(); return; }
  if (target.dataset.skillFilter) { state.skillFilter=target.dataset.skillFilter; renderConsole(); return; }
  if (target.dataset.harnessTab) { state.harnessTab=target.dataset.harnessTab; renderConsole(); return; }
  if (target.dataset.knowledgeTab) { state.knowledgeTab=target.dataset.knowledgeTab; renderConsole(); return; }
  if (target.dataset.node) { state.selectedNode=target.dataset.node; renderConsole(); return; }
  if (target.dataset.toolId) { state.selectedTool=target.dataset.toolId; renderConsole(); return; }
  if (target.dataset.filesTab) { state.filesTab=target.dataset.filesTab; renderConsole(); return; }
  if (action === 'decision') return showDecision(target.dataset.decision);
  if (action === 'approve-decision') return resolveDecision(target.dataset.id,true);
  if (action === 'decline-decision') return resolveDecision(target.dataset.id,false);
  if (action === 'run-detail') return showRun(target.dataset.run);
  if (action === 'stop-run') return stopRun(target.dataset.id);
  if (action === 'open-receipt') return showReceipt(target.dataset.receipt);
  if (action === 'close-drawer') return closeDrawer();
  if (action === 'use-skill') return openSkillDelegation(target.dataset.skill);
  if (action === 'launch-skill') { closeDrawer(); openFrank(); toast(`${target.dataset.skill} started`,'Workbench run created · visible in Running now'); return; }
  if (action === 'edit-route') return openRouteDrawer(target.dataset.room);
  if (action === 'save-route') { closeDrawer(); toast(`${target.dataset.room} route updated`,'The next new run will prove the selected route.'); return; }
  if (action === 'toggle-tool') { const id=target.dataset.id; if(state.pausedTools.has(id)) state.pausedTools.delete(id); else state.pausedTools.add(id); toast(state.pausedTools.has(id)?'Connector paused':'Connector resumed',state.pausedTools.has(id)?'The next attempted use will be blocked honestly.':'New uses may continue.'); renderConsole(); return; }
  if (action === 'test-tool') { toast('Health test started',`${target.dataset.id} · result will appear here`); setTimeout(()=>toast('Health test complete','Connection succeeded · 248ms'),900); return; }
  if (action === 'open-console-receipt') { closeDrawer(); openConsole('workbench'); return; }
  if (action === 'command') return openCommand();
  if (action === 'toggle-rail') { $('#chat-rail').classList.toggle('open'); return; }
  if (action === 'toggle-frame') { $('#living-frame').classList.toggle('open'); return; }
  if (action === 'toggle-console-nav') { $('#console-nav').classList.toggle('open'); return; }
  if (action === 'collapse-frame') { $('#living-frame').classList.remove('open'); if(innerWidth>960) toast('Living Frame collapsed','Counts remain available from the Frame control.'); return; }
  if (action === 'new-chat') { $('#chat-thread').innerHTML='<div class="day-line"><span>New chat</span></div><div class="empty-state">A clean context in Frank. The Living Frame keeps supervising existing work.</div>'; $('#composer-input').focus(); return; }
  if (action === 'new-delegation') return openSkillDelegation('preview-deploy');
  if (action === 'preview-open') return toast('Preview opened','Hosted review surface opened in a new tab.');
  if (action === 'dictate') return toast('Dictation ready','Prototype feedback: microphone is listening.');
  if (action === 'context') return toast('Context is 31% full','Compact or start fresh from the full context menu.');
  if (action === 'today-detail') return toast('Today item opened','Underlying work item shown without leaving the conversation.');
});

$('#drawer-backdrop').addEventListener('click', closeDrawer);
$('#send-message').addEventListener('click', sendMessage);
$('#composer-input').addEventListener('keydown', event => { if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage();} });
$('#composer-input').addEventListener('input', event => { event.target.style.height='auto'; event.target.style.height=`${Math.min(event.target.scrollHeight,130)}px`; });
$('#chat-search').addEventListener('input', event => { const q=event.target.value.toLowerCase(); $$('.chat-row,.recent-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q)); });
$('#command-search').addEventListener('input', event => renderCommandResults(event.target.value));
$('#command-modal').addEventListener('click', event => { if(event.target===$('#command-modal')) closeCommand(); });
document.addEventListener('keydown', event => {
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openCommand();}
  if(event.key==='Escape'){closeCommand();closeDrawer();$('#route-menu').hidden=true;$('#thinking-menu').hidden=true;$('#chat-rail').classList.remove('open');$('#living-frame').classList.remove('open');}
});

renderRouteMenu();
renderThinkingMenu();
