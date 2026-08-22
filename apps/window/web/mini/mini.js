(function () {
  "use strict";

  const STORE = "mini_frank_projects_v1";
  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  const state = {
    config: { priority_available: false, priority_amount: 5, hosted_days: 30 },
    draft: { problem: "", outcome: "", people: "", current_way: "", email: "", delivery: "free" },
    current: null,
    timer: null,
    generation: 0,
    submitting: false,
    mobile: "solution",
  };

  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const validId = (value) => /^[A-Za-z0-9_-]{8,80}$/.test(String(value || ""));
  const validClaim = (value) => /^[A-Za-z0-9_-]{20,200}$/.test(String(value || ""));

  function projects() {
    try {
      const result = JSON.parse(localStorage.getItem(STORE) || "[]");
      return Array.isArray(result) ? result.filter((item) => item && validId(item.id) && validClaim(item.claim)) : [];
    } catch (_error) { return []; }
  }

  function save(job, claim) {
    if (!job || !claim) return;
    const list = projects().filter((item) => item.id !== job.id);
    list.unshift({ id: job.id, claim, title: job.title, problem: job.problem, stage: job.stage,
      created_at: job.created_at, updated_at: job.updated_at });
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 50))); }
    catch (_error) { notify("Your private link works, but this browser could not save it."); }
  }

  function rememberAccess(access) {
    if (!access || !validId(access.id) || !validClaim(access.claim)) return;
    const list = projects().filter((item) => item.id !== access.id);
    list.unshift({ id: access.id, claim: access.claim, title: "Your solution", problem: "Private project", stage: "saved" });
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 50))); }
    catch (_error) { notify("Keep this private link safe. This browser could not save it."); }
  }

  function forgetAccess(id) {
    try { localStorage.setItem(STORE, JSON.stringify(projects().filter((item) => item.id !== id))); }
    catch (_error) { /* The invalid entry remains local to this browser. */ }
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store", credentials: "omit", ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
    });
    let body = {};
    try { body = await response.json(); } catch (_error) { body = {}; }
    if (!response.ok) {
      const error = new Error(body.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function notify(message) {
    clearTimeout(notify.timer);
    toast.textContent = message;
    toast.hidden = false;
    notify.timer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function stop() {
    clearTimeout(state.timer);
    state.timer = null;
    state.generation += 1;
  }

  function show(html) {
    app.innerHTML = html;
    app.setAttribute("aria-busy", "false");
    requestAnimationFrame(() => app.focus({ preventScroll: true }));
  }

  function clearHash() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function accessFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get("project");
    const claim = params.get("key");
    if (!validId(id)) return null;
    if (validClaim(claim)) return { id, claim };
    const saved = projects().find((item) => item.id === id);
    return saved ? { id, claim: saved.claim } : null;
  }

  function setHash(access) {
    history.replaceState(null, "", `#${new URLSearchParams({ project: access.id })}`);
  }

  function quote() {
    return `<p class="problem-quote"><strong>Your problem</strong><br>${esc(state.draft.problem)}</p>`;
  }

  function ask(error = "") {
    stop();
    show(`<section class="screen ask-screen">
      <div class="ask-copy"><h1>Give us your problem.<br>We will give you a solution.</h1>
      <p class="lead">A real, working result. Give us up to 24 hours.</p></div>
      <form class="composer" data-form="ask" novalidate>
        <label class="field-label" for="problem">What do you need solved?</label>
        <div class="composer-box"><textarea id="problem" name="problem" maxlength="6000" required
          placeholder="For example: I need a simpler way for customers to book without calling me.">${esc(state.draft.problem)}</textarea>
          <div class="composer-footer"><span class="composer-note">Describe it normally. You do not need to know what to build.</span>
          <button class="solid-button" type="submit">Start</button></div></div>
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
      </form></section>`);
  }

  function choosePath() {
    show(`<section class="screen screen-centre"><div class="flow-layout">
      <div class="flow-copy"><h1>That is enough to begin.</h1><p>Add a little context, or let us make the sensible decisions and start.</p>${quote()}</div>
      <div class="choice-list"><section class="path-choice"><h2>Help me refine it</h2>
        <p>Answer three short, optional questions so we can aim more precisely.</p>
        <button class="outline-button" type="button" data-action="refine">Refine my problem</button></section>
      <section class="path-choice"><h2>Start building with this</h2>
        <p>We will do our best with what you told us and make only safe assumptions.</p>
        <button class="solid-button" type="button" data-action="delivery">Start building</button></section></div>
    </div></section>`);
  }

  function refine() {
    show(`<section class="screen screen-centre"><div class="flow-layout">
      <div class="flow-copy"><h1>A little context helps.</h1><p>All three are optional. Short, ordinary answers are perfect.</p>${quote()}</div>
      <form class="form-panel" data-form="refine"><div class="guided-field">
        <label for="outcome">What would a good result change for you?</label>
        <textarea id="outcome" name="outcome" maxlength="1000" placeholder="Fewer missed calls and more confirmed bookings.">${esc(state.draft.outcome)}</textarea></div>
      <div class="guided-field"><label for="people">Who will use it?</label>
        <input id="people" name="people" maxlength="500" placeholder="Customers and our two staff" value="${esc(state.draft.people)}"></div>
      <div class="guided-field"><label for="current-way">How do you handle it now?</label>
        <textarea id="current-way" name="current_way" maxlength="1000" placeholder="Phone calls, a paper diary and text messages.">${esc(state.draft.current_way)}</textarea></div>
      <div class="form-actions"><button class="text-button" type="button" data-action="path">Back</button>
        <button class="outline-button" type="button" data-action="skip">Skip these</button>
        <button class="solid-button" type="submit">Continue</button></div></form>
    </div></section>`);
  }

  function deliveryCard(value, price, heading, copy, unavailable, badge) {
    const selected = state.draft.delivery === value;
    return `<section class="delivery-choice${selected ? " is-selected" : ""}${unavailable ? " is-unavailable" : ""}"><label>
      <input type="radio" name="delivery" value="${value}"${selected ? " checked" : ""}${unavailable ? " disabled" : ""}>
      ${badge ? `<span class="default-badge">${esc(badge)}</span>` : ""}<span class="price">${esc(price)}</span>
      <h2>${esc(heading)}</h2><p>${esc(copy)}</p><span class="choice-state"><span class="choice-indicator" aria-hidden="true"></span>
      ${selected ? "Selected" : unavailable ? "Not available yet" : "Choose this"}</span></label></section>`;
  }

  function delivery(error = "") {
    const priority = Boolean(state.config.priority_available);
    const amount = Number(state.config.priority_amount) || 5;
    if (!priority) state.draft.delivery = "free";
    show(`<section class="screen screen-centre"><div class="flow-layout">
      <div class="flow-copy"><h1>Where should we send it?</h1><p>We will email your private project link as soon as the working result is ready.</p>${quote()}</div>
      <form data-form="delivery" novalidate><div class="form-panel email-panel"><div class="guided-field">
        <label for="email">Your email</label><input id="email" name="email" type="email" autocomplete="email" maxlength="320" required
          placeholder="you@business.com" value="${esc(state.draft.email)}"><p class="guided-hint">For this project and its updates. No account or marketing list.</p>
      </div></div><div class="delivery-list" role="radiogroup" aria-label="Choose when we start">
        ${deliveryCard("free", "Free", "Give us up to 24 hours", "We use spare capacity intelligently and email you when it is ready.", false, "Default")}
        ${deliveryCard("priority", `$${amount}`, "Start working now", priority ? "Your job moves to the front. The quality is the same." : "The start-now checkout is being connected. Free is ready to use.", !priority, "")}
      </div>${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
      <div class="form-actions"><button class="text-button" type="button" data-action="path">Back</button>
        <button class="solid-button" type="submit"${state.submitting ? " disabled" : ""}>${state.submitting ? "Sending…" : state.draft.delivery === "priority" ? `Continue for $${amount}` : "Start my free build"}</button></div>
      </form></div></section>`);
  }

  const statuses = {
    queued: ["working", "We have your problem.", "Your request is safely queued. We will email you when the solution is ready."],
    working: ["working", "We are building your solution.", "We are researching, choosing the right starting point and making the real result."],
    checking: ["working", "We are checking your solution.", "The build has finished. We are checking the important parts before you receive it."],
    needs_attention: ["attention", "We still have your request.", "The build needs another look. Your place and details are saved."],
  };

  function status(job) {
    const [mark, heading, copy] = statuses[job.stage] || statuses.queued;
    show(`<section class="screen screen-centre"><div class="status-card">
      <div class="status-mark ${mark}" aria-hidden="true">${job.stage === "needs_attention" ? "!" : ""}</div>
      <h1>${esc(heading)}</h1><p>${esc(copy)}</p><span class="email-chip">Updates will go to ${esc(job.email || "your email")}</span>
      ${job.stage === "needs_attention" ? "" : `<div class="loading-line" aria-hidden="true"></div>`}
      <div class="status-actions">${job.stage === "needs_attention" ? `<button class="solid-button" type="button" data-action="retry">Try again</button>` : ""}
        <button class="outline-button" type="button" data-action="projects">My projects</button></div>
    </div></section>`);
    if (job.stage !== "needs_attention") pollLater();
  }

  function previewUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "preview.frank.fail" ? url.href : ""; }
    catch (_error) { return ""; }
  }

  function date(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "30 days after delivery";
    try { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value * 1000)); }
    catch (_error) { return "30 days after delivery"; }
  }

  function ready(job) {
    stop();
    const result = job.result || {};
    const preview = previewUrl(result.artifact_url);
    const source = previewUrl(result.source_url);
    const details = previewUrl(result.details_url);
    show(`<section class="project-view"><div class="mobile-view-tabs" role="tablist" aria-label="Project view">
      <button class="mobile-view-tab" type="button" role="tab" data-action="mobile-details" aria-selected="${state.mobile === "details"}">Details</button>
      <button class="mobile-view-tab" type="button" role="tab" data-action="mobile-solution" aria-selected="${state.mobile === "solution"}">Solution</button></div>
      <aside class="project-sidebar" data-mobile-view="${state.mobile}"><div class="project-head"><h1>${esc(result.title || job.title)}</h1>
        <p>Version ${Number(job.revision) || 1} · hosted until ${esc(date(job.hosted_until))}</p></div>
      <div class="project-details"><p class="project-summary"><strong>This is yours.</strong><br>${esc(result.summary)}</p>
        <p class="project-problem">${esc(job.problem)}</p><div class="project-links">
        ${preview ? `<a class="link-button" href="${esc(preview)}" target="_blank" rel="noopener noreferrer">Open solution</a>` : ""}
        ${source ? `<a class="link-button" href="${esc(source)}" download>Download source</a>` : ""}
        ${details ? `<a class="link-button" href="${esc(details)}" target="_blank" rel="noopener noreferrer">Build details</a>` : ""}</div></div>
      <div class="project-footer"><button class="solid-button" type="button" data-action="change">Request a change</button>
        <button class="outline-button" type="button" data-action="handoff">Keep it live or connect it</button></div></aside>
      <div class="preview-pane" data-mobile-view="${state.mobile}"><div class="preview-toolbar"><strong>Working solution</strong><span>Private preview</span></div>
        <div class="preview-frame-wrap">${preview ? `<iframe class="preview-frame" src="${esc(preview)}" title="${esc(result.title || "Your solution")}" sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts" referrerpolicy="no-referrer"></iframe>` : `<p class="notice">The preview link is unavailable. Your source and details are still available.</p>`}</div></div>
    </section>`);
  }

  function change(error = "") {
    const amount = Number(state.config.priority_amount) || 5;
    show(`<section class="screen screen-centre"><div class="flow-layout">
      <div class="flow-copy"><h1>What should we change?</h1><p>Describe it normally. We will keep the working parts and update this project.</p></div>
      <form class="form-panel change-form" data-form="change"><label class="field-label" for="change">Your change</label>
        <textarea id="change" name="change" maxlength="2000" required placeholder="Ask whether customers need an afternoon appointment. Keep everything else the same."></textarea>
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}<div class="change-timing">
        <button class="outline-button" type="submit" data-delivery="free">Free, up to 24 hours</button>
        <button class="solid-button" type="submit" data-delivery="priority"${state.config.priority_available ? "" : " disabled"}>${state.config.priority_available ? `Start now, $${amount}` : "Start now is being connected"}</button></div>
        <div class="form-actions"><button class="text-button" type="button" data-action="project">Back to solution</button></div>
      </form></div></section>`);
  }

  function handoff(job) {
    show(`<section class="screen screen-centre"><div class="flow-layout">
      <div class="flow-copy"><h1>This is yours.</h1><p>Use it, download it, or ask us to turn it into a stable live system connected to your business.</p>
        <span class="handoff-note">Your preview is hosted until ${esc(date(job.hosted_until))}</span></div>
      <div class="handoff-list"><section class="handoff-choice"><h2>Run it yourself</h2><p>Your source stays yours. Build details are optional.</p>
        <button class="outline-button" type="button" data-action="project">Back to your solution</button></section>
      <section class="handoff-choice"><h2>Make it fully live</h2><p>Steven reviews the real build, effort, delivery risk and value before sending any price.</p>
        ${job.offer_requested ? `<span class="status-chip">Your price request is saved</span><button class="outline-button" type="button" data-action="offer">Send the request again</button>` : `<button class="solid-button" type="button" data-action="offer">Ask Steven for a price</button>`}</section></div>
    </div></section>`);
  }

  function projectList() {
    stop();
    const list = projects();
    const labels = { queued: "Queued", working: "Building", checking: "Checking", ready: "Ready", needs_attention: "Needs another look" };
    show(`<section class="screen projects-screen"><div class="projects-wrap"><div class="projects-title"><div><h1>My projects</h1>
      <p>Private projects saved in this browser.</p></div><button class="solid-button" type="button" data-action="home">Start something new</button></div>
      ${list.length ? `<div class="project-list">${list.map((item) => `<button class="project-row" type="button" data-project-id="${esc(item.id)}">
        <span><span class="project-row-title">${esc(item.title || "Your solution")}</span><span class="project-row-problem">${esc(item.problem || "Private project")}</span></span>
        <span class="project-row-stage">${esc(labels[item.stage] || "Saved")}</span><span class="project-row-time">${esc(date(item.updated_at || item.created_at))}</span></button>`).join("")}</div>` :
        `<div class="empty-projects"><h2>No projects saved here yet.</h2><p>Start with a business problem, or open the private link we emailed you.</p>
        <button class="solid-button" type="button" data-action="home">Give us a problem</button></div>`}</div></section>`);
  }

  function how() {
    stop();
    show(`<section class="screen screen-centre"><div class="flow-layout"><div class="flow-copy"><h1>You give us the problem.</h1>
      <p>We research it, build the useful part and send back a real working result.</p></div><div class="choice-list">
      <section class="path-choice"><h2>Explain it normally</h2><p>No technical brief needed.</p></section>
      <section class="path-choice"><h2>Leave the building to us</h2><p>We email your private link when it is ready.</p></section>
      <section class="path-choice"><h2>Use what we made</h2><p>Try it, download it, request changes or ask us to make it fully live.</p>
        <button class="solid-button" type="button" data-action="home">Start</button></section></div></div></section>`);
  }

  function display(job) { if (job.stage === "ready" && job.result) ready(job); else status(job); }

  function pollLater() {
    clearTimeout(state.timer);
    const generation = state.generation;
    state.timer = setTimeout(async () => {
      if (generation !== state.generation || !state.current) return;
      try {
        const body = await request(`/api/mini/jobs/${encodeURIComponent(state.current.id)}`, { headers: { "X-Mini-Claim": state.current.claim } });
        state.current.job = body.job;
        state.draft.problem = body.job.problem;
        save(body.job, state.current.claim);
        display(body.job);
      } catch (error) {
        if (error.status === 404) { clearHash(); state.current = null; projectList(); notify("That private project link is incomplete or no longer valid."); }
        else pollLater();
      }
    }, 10000);
  }

  async function openProject(access) {
    stop();
    rememberAccess(access);
    state.current = { ...access, job: null };
    setHash(access);
    show(`<section class="screen screen-centre"><div class="status-card"><div class="status-mark working" aria-hidden="true"></div>
      <h1>Opening your project…</h1><p>Checking the latest real build state.</p><div class="loading-line" aria-hidden="true"></div></div></section>`);
    try {
      const body = await request(`/api/mini/jobs/${encodeURIComponent(access.id)}`, { headers: { "X-Mini-Claim": access.claim } });
      state.current.job = body.job;
      state.draft.problem = body.job.problem;
      save(body.job, access.claim);
      display(body.job);
    } catch (error) {
      if (error.status === 404) forgetAccess(access.id);
      clearHash(); state.current = null; projectList();
      notify(error.status === 404 ? "That private link is incomplete or no longer valid." : error.message);
    }
  }

  async function submitJob(form) {
    if (state.submitting) return;
    const data = new FormData(form);
    state.draft.email = String(data.get("email") || "").trim();
    state.draft.delivery = String(data.get("delivery") || "free");
    if (!/^\S+@\S+\.\S+$/.test(state.draft.email)) { delivery("Enter the email where we should send your private link."); return; }
    state.submitting = true; delivery();
    try {
      const body = await request("/api/mini/jobs", { method: "POST", body: JSON.stringify(state.draft) });
      state.submitting = false;
      state.current = { id: body.job.id, claim: body.claim_token, job: body.job };
      save(body.job, body.claim_token); setHash(state.current); display(body.job);
      if (body.checkout_url) openCheckout(body.checkout_url);
    } catch (error) { state.submitting = false; delivery(error.message); }
  }

  async function submitChange(form, submitter) {
    if (!state.current || state.submitting) return;
    const text = String(new FormData(form).get("change") || "").trim();
    if (text.length < 10) { change("Tell us what should change in a little more detail."); return; }
    state.submitting = true;
    try {
      const body = await request(`/api/mini/jobs/${encodeURIComponent(state.current.id)}/changes`, { method: "POST",
        headers: { "X-Mini-Claim": state.current.claim }, body: JSON.stringify({ change: text, delivery: submitter?.dataset.delivery || "free" }) });
      state.submitting = false; state.current.job = body.job; save(body.job, state.current.claim); display(body.job);
      if (body.checkout_url) openCheckout(body.checkout_url);
    } catch (error) { state.submitting = false; change(error.message); }
  }

  async function retry() {
    try {
      const body = await request(`/api/mini/jobs/${encodeURIComponent(state.current.id)}/dispatch`, { method: "POST", headers: { "X-Mini-Claim": state.current.claim } });
      state.current.job = body.job; save(body.job, state.current.claim); display(body.job);
    } catch (error) { notify(error.message); }
  }

  async function offer() {
    if (state.submitting) return;
    state.submitting = true;
    try {
      const body = await request(`/api/mini/jobs/${encodeURIComponent(state.current.id)}/offer`, { method: "POST", headers: { "X-Mini-Claim": state.current.claim } });
      state.submitting = false; state.current.job = body.job; save(body.job, state.current.claim); handoff(body.job);
    } catch (error) { state.submitting = false; notify(error.message); }
  }

  function openCheckout(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error("Checkout must use HTTPS.");
      location.assign(url.href);
    } catch (_error) { notify("The secure checkout link is unavailable. Your project is still saved."); }
  }

  function home() {
    clearHash(); state.current = null;
    state.draft = { problem: "", outcome: "", people: "", current_way: "", email: "", delivery: "free" };
    ask();
  }

  document.addEventListener("click", (event) => {
    const row = event.target.closest("[data-project-id]");
    if (row) { const item = projects().find((project) => project.id === row.dataset.projectId); if (item) openProject(item); return; }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "home") home();
    else if (action === "projects") { clearHash(); projectList(); }
    else if (action === "how") how();
    else if (action === "refine") refine();
    else if (action === "path") choosePath();
    else if (action === "skip") { state.draft.outcome = ""; state.draft.people = ""; state.draft.current_way = ""; delivery(); }
    else if (action === "delivery") delivery();
    else if (action === "retry") retry();
    else if (action === "project") display(state.current.job);
    else if (action === "change") change();
    else if (action === "handoff") handoff(state.current.job);
    else if (action === "offer") offer();
    else if (action === "mobile-details" || action === "mobile-solution") { state.mobile = action === "mobile-details" ? "details" : "solution"; ready(state.current.job); }
  });

  app.addEventListener("change", (event) => {
    if (event.target.matches('input[name="delivery"]')) {
      state.draft.email = app.querySelector('input[name="email"]')?.value.trim() || "";
      state.draft.delivery = event.target.value; delivery();
    }
  });

  app.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.matches('[data-form="ask"]')) {
      const problem = String(new FormData(form).get("problem") || "").trim();
      if (problem.length < 10) { ask("Give us a little more detail so we know what needs solving."); return; }
      state.draft.problem = problem; choosePath();
    } else if (form.matches('[data-form="refine"]')) {
      const data = new FormData(form); state.draft.outcome = String(data.get("outcome") || "").trim();
      state.draft.people = String(data.get("people") || "").trim(); state.draft.current_way = String(data.get("current_way") || "").trim(); delivery();
    } else if (form.matches('[data-form="delivery"]')) submitJob(form);
    else if (form.matches('[data-form="change"]')) submitChange(form, event.submitter);
  });

  window.addEventListener("hashchange", () => {
    const access = accessFromHash();
    if (access && (access.id !== state.current?.id || access.claim !== state.current?.claim)) openProject(access);
  });

  ask();
  request("/api/mini/config").then((config) => { state.config = { ...state.config, ...config }; }).catch(() => {});
  const initial = accessFromHash();
  if (initial) openProject(initial);
}());
