// Frank work widgets: Hub Overnight/Waiting/Running slides, project work
// summaries, and the task/routine drawer. Truthful states only: ready, empty,
// loading, stale, unavailable, and error are rendered explicitly; nothing is
// invented. Mutations use the same-origin work API, an exact content type,
// and one operation id per logical change, shared with the conversational
// tools and the project widgets.
import { define } from "./registry.js";

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function workMutation(prefix, payload = {}) {
  const operationId = freshOperationId(prefix);
  return {
    operationId,
    body: JSON.stringify({ ...payload, operation_id: operationId }),
  };
}

function freshOperationId(prefix = "work") {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

async function requestJson(url, options = {}) {
  const { operationId, ...requestOptions } = options;
  const headers = { "Content-Type": "application/json", ...(requestOptions.headers || {}) };
  if (operationId) headers["Idempotency-Key"] = operationId;
  const response = await fetch(url, { ...requestOptions, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || body.description || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.code || "";
    throw error;
  }
  return body;
}

const STALE_AFTER_MS = 120000;

function renderState(root, kind, message) {
  const state = node("div", `work-state is-${kind}`, message);
  root.replaceChildren(state);
  return state;
}

async function loadSnapshot(url, root, renderReady, options = {}) {
  const started = Date.now();
  renderState(root, "loading", "Loading…");
  try {
    const snapshot = await requestJson(url, options);
    if (snapshot.schema !== "schema://frank.widget-snapshot/v1") {
      renderState(root, "error", "Unexpected work summary response.");
      return;
    }
    if (Date.now() - (snapshot.generated_at || 0) * 1000 > STALE_AFTER_MS && Date.now() - started > STALE_AFTER_MS) {
      renderState(root, "stale", "This summary is stale; retry in a moment.");
      return;
    }
    if (snapshot.status === "unavailable") {
      renderState(root, "unavailable", snapshot.summary || "Work summaries are unavailable.");
      return;
    }
    if (snapshot.status === "error") {
      renderState(root, "error", snapshot.summary || "Work summaries failed.");
      return;
    }
    renderReady(root, snapshot);
  } catch (error) {
    if (error.name === "AbortError") return;
    renderState(root, "error", `Work summaries failed: ${error.message}`);
  }
}

function rowList(rows, chipKey, interactive = false) {
  const list = node("ul", "work-rows");
  for (const row of rows || []) {
    const item = node("li");
    if (interactive) {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); item.click(); }
      });
    }
    if (row[chipKey]) item.append(node("span", "work-chip", row[chipKey]));
    item.append(node("span", "work-row-title", row.title || row.name || row.id || ""));
    list.append(item);
  }
  return list;
}

// --- Hub slides -----------------------------------------------------------

function mountHubSlide(root, endpoint) {
  loadSnapshot(endpoint, root, (element, snapshot) => {
    const data = snapshot.data || {};
    element.replaceChildren(node("p", "work-note", snapshot.summary || ""));
    if (Array.isArray(data.rows) && data.rows.length) element.append(rowList(data.rows, "label"));
    if (Array.isArray(data.completed) && data.completed.length) element.append(rowList(data.completed, "result"));
    if (Array.isArray(data.scheduled_activity) && data.scheduled_activity.length) {
      element.append(node("p", "work-section-title", "Scheduled while away"));
      element.append(rowList(data.scheduled_activity, "last_status"));
    }
  });
}

define({
  id: "overnight",
  title: "Overnight",
  surfaces: ["hub"],
  description: "Completed work and scheduled activity since the last acknowledged visit.",
  mount(el) {
    mountHubSlide(el, "/api/work/hub/overnight");
    const acknowledge = node("button", "work-button secondary", "Mark seen");
    acknowledge.type = "button";
    acknowledge.addEventListener("click", async () => {
      acknowledge.disabled = true;
      try {
        await requestJson("/api/work/hub/acknowledge", {
          method: "POST",
          body: JSON.stringify({}),
          operationId: freshOperationId("ack"),
        });
        mountHubSlide(el, "/api/work/hub/overnight");
      } catch {
        acknowledge.disabled = false;
      }
    });
    el.append(acknowledge);
  },
});

define({
  id: "waiting",
  title: "Waiting on you",
  surfaces: ["hub"],
  description: "Blocked tasks, review requests, and pending approvals.",
  mount(el) {
    mountHubSlide(el, "/api/work/hub/waiting");
  },
});

define({
  id: "running",
  title: "Running",
  surfaces: ["hub"],
  description: "Work currently executing through Hermes.",
  mount(el) {
    mountHubSlide(el, "/api/work/hub/running");
  },
});

// --- Project work widget ---------------------------------------------------

const VALID_ACTIONS = {
  ready: ["start", "block", "comment", "archive"],
  running: ["review", "comment", "terminate", "block"],
  blocked: ["unblock", "comment", "archive"],
  review: ["changes", "complete", "comment", "archive"],
  triage: ["ready", "comment", "archive"],
  todo: ["ready", "comment", "archive"],
  scheduled: ["ready", "comment", "archive"],
  done: ["retry", "archive"],
  archived: [],
};

function actionsFor(nativeState, runState) {
  const actions = [...(VALID_ACTIONS[nativeState] || [])];
  if (["failed", "cancelled"].includes(runState) && !actions.includes("retry")) actions.push("retry");
  if (runState === "stopping" && actions.includes("terminate")) {
    // Stop remains stopping until Hermes confirms exit; terminate cannot repeat.
    return actions.filter((action) => action !== "terminate");
  }
  return actions;
}

const ACTION_LABELS = {
  ready: "Mark ready", start: "Start", block: "Block", unblock: "Unblock",
  review: "Request review", changes: "Request changes", complete: "Complete",
  retry: "Retry", archive: "Archive", terminate: "Stop run", comment: "Comment",
};

function projectWorkSummary(el, projectId) {
  const host = node("div", "work-root");
  el.append(host);
  loadSnapshot(`/api/work/tasks?project_id=${encodeURIComponent(projectId)}&limit=50&summary=widget`, host, (element, listing) => {
    projectWorkRender(element, listing, projectId);
  });
}

async function mountAllWork(host, projectId) {
  let drawer = host.querySelector(".work-drawer");
  if (!drawer) {
    drawer = node("div", "work-drawer");
    host.append(drawer);
  }
  drawer.replaceChildren(node("h4", "", "All work"));
  try {
    const listing = await requestJson(`/api/work/tasks?project_id=${encodeURIComponent(projectId)}&limit=50`);
    const rows = listing.tasks || [];
    if (!rows.length) {
      drawer.append(renderState(document.createElement("div"), "empty", "No durable work yet. Create the first task."));
    }
    const list = rowList(rows.map((task) => ({ ...task, title: `${task.label} · ${task.title}` })), "label", true);
    list.addEventListener("click", (event) => {
      const item = event.target.closest("li");
      const index = [...list.children].indexOf(item);
      if (index >= 0 && rows[index]) mountTaskDrawer(host, projectId, rows[index]);
    });
    drawer.append(list);
  } catch (error) {
    drawer.append(node("p", "work-state is-error", `Work list unavailable: ${error.message}`));
  }
}

function drawerFields(drawer, fields) {
  const form = node("div", "work-form");
  for (const field of fields) form.append(field);
  drawer.append(form);
  return form;
}

function field(label, control) {
  const wrap = node("label", "work-field");
  wrap.append(node("span", "", label), control);
  return wrap;
}

function mountTaskDrawer(host, projectId, task) {
  let drawer = host.querySelector(".work-drawer");
  if (!drawer) {
    drawer = node("div", "work-drawer");
    host.append(drawer);
  }
  drawer.replaceChildren(node("h4", "", task ? "Task" : "New work"));
  const conflict = node("div", "work-conflict");
  conflict.hidden = true;

  if (!task) {
    const title = document.createElement("input");
    title.maxLength = 200;
    title.placeholder = "Outcome-oriented title";
    const body = document.createElement("textarea");
    body.maxLength = 8000;
    body.rows = 4;
    body.placeholder = "Plain-text outcome and context";
    drawer.append(field("Title", title), field("Body", body), conflict);
    const create = node("button", "work-button", "Create task");
    create.type = "button";
    create.addEventListener("click", async () => {
      create.disabled = true;
      conflict.hidden = true;
      try {
        const mutation = workMutation("task-create", { project_id: projectId, title: title.value, body: body.value });
        await requestJson("/api/work/tasks", {
          method: "POST",
          ...mutation,
        });
        drawer.replaceChildren(node("h4", "", "Task created"));
        drawer.append(node("p", "work-state is-empty", "Created passive by default: triaged, no worker, nothing fans out until you start it."));
        projectWorkSummaryRefresh(host, projectId);
      } catch (error) {
        create.disabled = false;
        conflict.hidden = false;
        conflict.textContent = error.message;
      }
    });
    const actions = node("div", "work-actions");
    actions.append(create);
    drawer.append(actions);
    return;
  }

  const list = node("ul", "work-detail-list");
  const rows = [
    ["Status", `${task.label} (${task.native_state})`],
    ["Updated", task.updated_at ? new Date(task.updated_at * 1000).toLocaleString() : "unknown"],
    ["Assignee", task.assignee || "default"],
  ];
  if (task.run_state) rows.push(["Run", task.run_state]);
  for (const [key, value] of rows) {
    const item = node("li");
    item.append(node("span", "work-detail-key", key), node("span", "", String(value)));
    list.append(item);
  }
  drawer.append(list, conflict);
  const actionRow = node("div", "work-actions");
  const valid = actionsFor(task.native_state, task.run_state || "");
  for (const action of valid) {
    const button = node("button", "work-button secondary", ACTION_LABELS[action] || action);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      conflict.hidden = true;
      try {
        const mutation = workMutation(`act-${action}`, { project_id: projectId });
        await requestJson(`/api/work/tasks/${encodeURIComponent(task.id)}/actions/${action}`, {
          method: "POST",
          ...mutation,
        });
        projectWorkSummaryRefresh(host, projectId);
        button.textContent = "Done";
      } catch (error) {
        button.disabled = false;
        conflict.hidden = false;
        conflict.textContent = error.code === "workspace_busy"
          ? "The project workspace is busy; the request stays queued."
          : error.message;
      }
    });
    actionRow.append(button);
  }
  if (!valid.length) actionRow.append(node("span", "work-note", "No actions for this state."));
  drawer.append(actionRow);
}

function projectWorkSummaryRefresh(host, projectId) {
  const summaryRoot = host?.matches?.(".work-root") ? host : host?.closest?.(".work-root") || host?.querySelector?.(".work-root");
  if (summaryRoot && projectId) mountProjectWorkInto(summaryRoot, projectId);
}

const projectWorkMounts = new WeakMap();

export function mountProjectWorkInto(element, projectId) {
  projectWorkMounts.get(element)?.abort();
  const controller = new AbortController();
  projectWorkMounts.set(element, controller);
  const listingHost = node("div");
  element.replaceChildren(listingHost);
  loadSnapshot(`/api/work/tasks?project_id=${encodeURIComponent(projectId)}&limit=50`, listingHost, (root, listing) => {
    if (projectWorkMounts.get(element) !== controller) return;
    projectWorkRender(root, listing, projectId);
  }, { signal: controller.signal });
}

function projectWorkRender(element, listing, projectId) {
  const tasks = listing.tasks || [];
  const counts = { running: 0, waiting: 0, queued: 0, completed: 0 };
  for (const task of tasks) if (counts[task.group] !== undefined) counts[task.group] += 1;
  element.replaceChildren();
  const metrics = node("div", "work-metrics");
  for (const [label, count] of Object.entries(counts)) {
    metrics.append(node("span", "work-metric", `${count} ${label}`));
  }
  element.append(metrics);
  const active = tasks.find((task) => task.group === "running");
  if (active) {
    const activeRow = node("div", "work-active");
    activeRow.append(node("strong", "", active.title || active.id));
    if (active.run_state) activeRow.append(node("span", "work-run-state", active.run_state));
    element.append(activeRow);
  }
  const waiting = tasks.filter((task) => task.group === "waiting").slice(0, 5);
  if (waiting.length) {
    element.append(node("p", "work-section-title", "Waiting"));
    element.append(rowList(waiting, "native_state"));
  }
  const actions = node("div", "work-actions");
  const open = node("button", "work-button", "New work");
  open.type = "button";
  open.addEventListener("click", () => mountTaskDrawer(element, projectId, null));
  const inspect = node("button", "work-button secondary", "All work");
  inspect.type = "button";
  inspect.addEventListener("click", () => mountAllWork(element, projectId));
  const routine = node("button", "work-button secondary", "Routines");
  routine.type = "button";
  routine.addEventListener("click", () => mountRoutineDrawer(element, projectId));
  actions.append(open, inspect, routine);
  element.append(actions);
}

// --- Routine controls -------------------------------------------------------

function mountRoutineDrawer(host, projectId) {
  let drawer = host.querySelector(".work-drawer");
  if (!drawer) {
    drawer = node("div", "work-drawer");
    host.append(drawer);
  }
  drawer.replaceChildren(node("h4", "", "Routines"));
  const conflict = node("div", "work-conflict");
  conflict.hidden = true;

  const listHost = node("div");
  drawer.append(listHost);

  const name = document.createElement("input");
  name.maxLength = 120;
  name.placeholder = "Name";
  const schedule = document.createElement("input");
  schedule.placeholder = "e.g. 0 9 * * 1-5 (Perth time shown)";
  const prompt = document.createElement("textarea");
  prompt.rows = 3;
  prompt.maxLength = 8000;
  prompt.placeholder = "Plain instructions for each run";
  const continuity = document.createElement("input");
  continuity.type = "checkbox";

  const previewButton = node("button", "work-button secondary", "Preview next runs");
  previewButton.type = "button";
  const preview = node("p", "work-note", "");
  previewButton.addEventListener("click", async () => {
    preview.textContent = "Computing…";
    try {
      const result = await requestJson("/api/work/routines/preview", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, schedule: schedule.value }),
      });
      preview.textContent = (result.next_executions || [])
        .map((item) => new Date(item.epoch * 1000).toLocaleString())
        .join(" · ") || "No upcoming executions.";
    } catch (error) {
      preview.textContent = error.message;
    }
  });

  const create = node("button", "work-button", "Create routine");
  create.type = "button";
  create.addEventListener("click", async () => {
    create.disabled = true;
    conflict.hidden = true;
    try {
      const mutation = workMutation("routine-create", { project_id: projectId, name: name.value, schedule: schedule.value, prompt: prompt.value, continuity: continuity.checked });
      await requestJson("/api/work/routines", {
        method: "POST",
        ...mutation,
      });
      drawer.replaceChildren(
        node("h4", "", "Routine created"),
        node("p", "work-state is-empty", "Hermes owns the schedule; Frank only displays and controls it."));
    } catch (error) {
      create.disabled = false;
      conflict.hidden = false;
      conflict.textContent = error.message;
    }
  });

  drawer.append(
    field("Name", name), field("Schedule", schedule), previewButton, preview,
    field("Instructions", prompt),
    (() => { const wrap = node("label", "work-field"); const row = node("span"); row.append(continuity, node("span", "", "Continue from previous runs")); wrap.append(row); return wrap; })(),
    conflict);
  const actions = node("div", "work-actions");
  actions.append(create);
  drawer.append(actions);

  requestJson(`/api/work/routines?project_id=${encodeURIComponent(projectId)}`)
    .then((result) => {
      const routines = result.routines || [];
      if (!routines.length) {
        listHost.append(node("p", "work-state is-empty", "No routines yet."));
        return;
      }
      const rows = routines.map((item) => ({
        id: item.id,
        title: `${item.enabled ? "enabled" : "paused"} · ${item.name} · ${item.schedule_display}`,
        native_state: item.state,
      }));
      const list = rowList(rows, "native_state", true);
      list.addEventListener("click", (event) => {
        const item = event.target.closest("li");
        const index = [...list.children].indexOf(item);
        if (index >= 0 && routines[index]) mountRoutineControls(listHost, projectId, routines[index]);
      });
      listHost.append(list);
    })
    .catch((error) => listHost.append(node("p", "work-state is-error", `Routines unavailable: ${error.message}`)));
}

function mountRoutineControls(host, projectId, routine) {
  const controls = node("div", "work-actions");
  const conflict = node("div", "work-conflict");
  conflict.hidden = true;
  const act = (label, path, needsConfirm = false) => {
    const button = node("button", "work-button secondary", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      conflict.hidden = true;
      try {
        if (needsConfirm && !window.confirm(`${label} routine "${routine.name}"?`)) {
          button.disabled = false;
          return;
        }
        const mutation = workMutation("routine", { project_id: projectId });
        await requestJson(`/api/work/routines/${encodeURIComponent(routine.id)}/actions/${path}`, {
          method: "POST",
          ...mutation,
        });
        button.textContent = "Done";
      } catch (error) {
        button.disabled = false;
        conflict.hidden = false;
        conflict.textContent = error.message;
      }
    });
    return button;
  };
  controls.append(
    act(routine.paused ? "Resume" : "Pause", routine.paused ? "resume" : "pause"),
    act("Run now", "run-now"),
  );
  const remove = node("button", "work-button danger", "Delete");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete routine "${routine.name}"? Project files and past results are not touched.`)) return;
    remove.disabled = true;
    try {
      await requestJson(`/api/work/routines/${encodeURIComponent(routine.id)}?project_id=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        body: JSON.stringify({ project_id: projectId, confirm: routine.id }),
      });
      remove.textContent = "Deleted";
    } catch (error) {
      remove.disabled = false;
      conflict.hidden = false;
      conflict.textContent = error.message;
    }
  });
  controls.append(remove);
  host.append(controls, conflict);
}

// Entity-home integration: homes.js calls window.frankWork.projectWidget(body, projectId)
// via the one-line integration patch; the Hub slides mount through registry ids above.
window.frankWork = {
  projectWidget: (element, projectId) => mountProjectWorkInto(element, projectId),
};
