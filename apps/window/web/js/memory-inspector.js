const SCHEMA = "schema://frank.memory-inspector/v1";

function element(tag, className = "", text = "") {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function control(label, handler, className = "home-inline-button") {
  const value = element("button", className, label);
  value.type = "button";
  value.addEventListener("click", handler);
  return value;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.description || body.error || `Request failed (${response.status})`);
  return body;
}

function timestamp(value) {
  if (!value) return "Unknown time";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function sectionHeading(title, detail = "") {
  const heading = element("div", "section-heading");
  heading.append(element("h2", "", title));
  if (detail) heading.append(element("span", "", detail));
  return heading;
}

function summaryCard(label, value, note, status = "") {
  const card = element("article", "connection-summary-card");
  card.append(
    element("span", "home-provider", label),
    element("strong", `connection-summary-value${status ? ` status-${status}` : ""}`, String(value)),
    element("span", "connection-summary-note", note),
  );
  return card;
}

function inputStyle(input, multiline = false) {
  input.style.width = "100%";
  input.style.border = "1px solid var(--line)";
  input.style.borderRadius = "8px";
  input.style.background = "var(--bg)";
  input.style.padding = "9px 10px";
  input.style.fontSize = "12px";
  if (multiline) {
    input.style.minHeight = "150px";
    input.style.resize = "vertical";
    input.style.lineHeight = "1.5";
  }
}

function memoryRow(memory, sourceById, openSource) {
  const row = element("article", "connection-activity-row");
  const title = element("strong", "", memory.text || "Empty memory");
  const details = [memory.type || "memory", timestamp(memory.retained_at || memory.occurred_at)];
  if (memory.tags?.length) details.push(memory.tags.join(" · "));
  row.append(title, element("p", "", details.join(" · ")));
  if (memory.context) row.append(element("p", "", memory.context));
  if (memory.consolidation_failed_at) row.append(element("p", "home-error", `Consolidation failed ${timestamp(memory.consolidation_failed_at)}`));
  const source = sourceById.get(memory.source_document_id);
  if (source) row.append(control(`Source · ${source.memory_count} facts`, () => openSource(source)));
  else row.append(element("span", "quiet", "Derived observation · source tracked by Hindsight"));
  return row;
}

function activityRow(item) {
  const row = element("div", "connection-activity-row");
  const label = item.action || item.type || "memory operation";
  row.append(element("strong", "", `${label} · ${item.status || "recorded"}`));
  row.append(element("p", "", timestamp(item.timestamp || item.created_at)));
  if (item.error) row.append(element("p", "home-error", item.error));
  return row;
}

export function mountMemoryInspector({ host, project, setStatus }) {
  const controller = new AbortController();
  const projectId = encodeURIComponent(project.id);
  let disposed = false;
  let snapshot = null;

  host.classList.remove("home-grid", "project-signal-grid", "grid-stack", "project-grid-fallback");
  host.classList.add("memory-inspector-host");
  host.replaceChildren();
  const shell = element("div", "tool-workspace");
  const main = element("div", "tool-workspace-main");
  const intro = element("div", "tool-workspace-intro");
  const introCopy = element("div");
  introCopy.append(
    element("span", "home-kicker", "Hermes memory"),
    element("h2", "", `${project.name || project.id} memory`),
    element("p", "", "Inspect exactly what Hindsight retains and recalls for this project. Frank displays provider truth and never stores a second copy."),
  );
  const introStatus = element("span", "", "Loading Hindsight…");
  intro.append(introCopy, introStatus);
  main.append(intro);

  const overview = element("div", "connection-overview");
  const recallSection = element("section", "connections-section");
  const recallForm = element("form");
  recallForm.style.display = "flex";
  recallForm.style.gap = "8px";
  recallForm.style.marginTop = "10px";
  const recallInput = element("input");
  recallInput.type = "search";
  recallInput.maxLength = 600;
  recallInput.placeholder = "Ask what Hermes would recall for the next turn…";
  recallInput.setAttribute("aria-label", "Test memory recall");
  inputStyle(recallInput);
  const recallButton = control("Test recall", () => {}, "home-action home-action-primary");
  recallButton.type = "submit";
  recallForm.append(recallInput, recallButton);
  const recallResults = element("div", "connection-activity");
  recallSection.append(sectionHeading("Recall test", "Uses this project bank only"), recallForm, recallResults);

  const columns = element("div", "connection-columns");
  const memoriesSection = element("section", "connections-section connection-panel");
  const memoriesList = element("div", "connection-activity");
  memoriesSection.append(sectionHeading("Retained memories", "Newest provider facts"), memoriesList);
  const sourcesSection = element("section", "connections-section connection-panel");
  const sourcesList = element("div", "connection-activity");
  sourcesSection.append(sectionHeading("Retained sources", "Correct or forget at source"), sourcesList);
  columns.append(memoriesSection, sourcesSection);

  const editorSection = element("section", "connections-section");
  editorSection.hidden = true;
  const editorHeading = sectionHeading("Memory source", "Hindsight will re-extract facts after correction");
  const editorStatus = element("p", "quiet");
  const editorText = element("textarea");
  editorText.maxLength = 100000;
  editorText.setAttribute("aria-label", "Retained memory source");
  inputStyle(editorText, true);
  editorText.style.marginTop = "10px";
  const editorActions = element("div", "connection-row-actions");
  const saveButton = control("Save correction", () => {}, "home-action home-action-primary");
  const forgetButton = control("Forget source", () => {}, "home-inline-button danger-text");
  const closeButton = control("Close source", () => { editorSection.hidden = true; }, "home-inline-button");
  editorActions.append(saveButton, forgetButton, closeButton);
  editorSection.append(editorHeading, editorStatus, editorText, editorActions);

  const activitySection = element("section", "connections-section");
  const activityList = element("div", "connection-activity");
  activitySection.append(sectionHeading("Memory activity", "Recall, retention and provider failures"), activityList);
  main.append(overview, recallSection, columns, editorSection, activitySection);
  shell.append(main);
  host.append(shell);

  function renderSnapshot(value) {
    snapshot = value;
    if (value?.schema !== SCHEMA || value.project?.id !== project.id) throw new Error("Memory identity mismatch.");
    const provider = value.provider || {};
    const counts = value.counts || {};
    introStatus.textContent = `${provider.status || "attention"} · ${provider.bank_id || "unknown bank"}`;
    overview.replaceChildren(
      summaryCard("Provider", provider.name || "Hindsight", `API ${provider.version || "unknown"}`, provider.status === "ready" ? "ready" : "error"),
      summaryCard("Bank", provider.bank_id || "—", "Workspace-isolated"),
      summaryCard("Memories", Number(counts.memories || 0), "Extracted durable facts"),
      summaryCard("Sources", Number(counts.documents || 0), "Retained conversations and corrections"),
      summaryCard("Failures", Number(counts.failed || 0), `${Number(counts.pending || 0)} pending`, Number(counts.failed || 0) ? "error" : "ready"),
    );
    const sources = new Map((value.documents || []).map((item) => [item.id, item]));
    memoriesList.replaceChildren();
    (value.memories || []).forEach((memory) => memoriesList.append(memoryRow(memory, sources, openSource)));
    if (!memoriesList.childElementCount) memoriesList.append(element("p", "connection-empty", "No durable memories have been retained for this project yet."));
    sourcesList.replaceChildren();
    (value.documents || []).forEach((source) => {
      const row = element("div", "connection-activity-row");
      row.append(element("strong", "", `${source.memory_count} extracted facts`));
      row.append(element("p", "", `${source.context || "Project conversation"} · ${timestamp(source.updated_at || source.created_at)}`));
      if (source.metadata?.session_id) row.append(element("p", "", `Session ${source.metadata.session_id}`));
      row.append(control("Inspect source", () => openSource(source)));
      sourcesList.append(row);
    });
    if (!sourcesList.childElementCount) sourcesList.append(element("p", "connection-empty", "No retained source documents yet."));
    activityList.replaceChildren();
    const activity = [...(value.operations || []), ...(value.audit || [])]
      .sort((a, b) => String(b.created_at || b.timestamp || "").localeCompare(String(a.created_at || a.timestamp || "")));
    activity.forEach((item) => activityList.append(activityRow(item)));
    if (!activityList.childElementCount) activityList.append(element("p", "connection-empty", "No provider activity has been recorded yet."));
    setStatus(`Hindsight bank ${provider.bank_id} · ${Number(counts.memories || 0)} memories · ${Number(counts.failed || 0)} failures`, Number(counts.failed || 0) ? "error" : "success");
  }

  async function refresh() {
    introStatus.textContent = "Refreshing Hindsight…";
    try {
      const value = await requestJson(`/api/projects/${projectId}/memory`, { signal: controller.signal });
      if (!disposed) renderSnapshot(value);
    } catch (error) {
      if (error.name === "AbortError" || disposed) return;
      introStatus.textContent = error.message || "Hindsight unavailable.";
      setStatus(error.message || "Hindsight memory is unavailable.", "error");
    }
  }

  async function openSource(source) {
    editorSection.hidden = false;
    editorStatus.textContent = "Loading retained source…";
    editorText.value = "";
    saveButton.disabled = true;
    forgetButton.disabled = true;
    try {
      const value = await requestJson(`/api/projects/${projectId}/memory/documents/${encodeURIComponent(source.id)}`, { signal: controller.signal });
      if (disposed) return;
      editorText.value = value.document?.content || "";
      editorStatus.textContent = `${source.memory_count} derived facts · source ${source.id}`;
      saveButton.disabled = false;
      forgetButton.disabled = false;
      saveButton.onclick = async () => {
        saveButton.disabled = true;
        editorStatus.textContent = "Replacing source and re-extracting durable facts…";
        try {
          await requestJson(`/api/projects/${projectId}/memory/documents/${encodeURIComponent(source.id)}`, {
            method: "PUT", body: JSON.stringify({ content: editorText.value }),
          });
          editorStatus.textContent = "Correction retained. Hindsight re-extracted this source.";
          await refresh();
        } catch (error) {
          editorStatus.textContent = error.message || "Correction failed.";
        } finally { saveButton.disabled = false; }
      };
      forgetButton.onclick = async () => {
        if (!window.confirm(`Forget this retained source and its ${source.memory_count} derived facts? This cannot be undone.`)) return;
        forgetButton.disabled = true;
        editorStatus.textContent = "Forgetting source…";
        try {
          await requestJson(`/api/projects/${projectId}/memory/documents/${encodeURIComponent(source.id)}`, {
            method: "DELETE", body: JSON.stringify({ confirmation: `FORGET ${source.id}` }),
          });
          editorSection.hidden = true;
          await refresh();
        } catch (error) {
          editorStatus.textContent = error.message || "Forget failed.";
        } finally { forgetButton.disabled = false; }
      };
    } catch (error) {
      editorStatus.textContent = error.message || "Source unavailable.";
    }
    editorSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  recallForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = recallInput.value.trim();
    if (!query) return;
    recallButton.disabled = true;
    recallResults.replaceChildren(element("p", "quiet", "Asking this project bank…"));
    try {
      const value = await requestJson(`/api/projects/${projectId}/memory/recall`, {
        method: "POST", body: JSON.stringify({ query }),
      });
      recallResults.replaceChildren();
      if (value.answer) recallResults.append(element("p", "home-summary", value.answer));
      (value.results || []).forEach((item) => {
        const row = element("div", "connection-activity-row");
        row.append(element("strong", "", item.text || "Memory result"));
        row.append(element("p", "", [item.type, Number.isFinite(item.score) ? `score ${item.score.toFixed(3)}` : ""].filter(Boolean).join(" · ")));
        recallResults.append(row);
      });
      if (!recallResults.childElementCount) recallResults.append(element("p", "connection-empty", "No memories matched this query."));
    } catch (error) {
      recallResults.replaceChildren(element("p", "home-error", error.message || "Recall failed."));
    } finally { recallButton.disabled = false; }
  });

  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      controller.abort();
      host.classList.remove("memory-inspector-host");
    },
  };
}
