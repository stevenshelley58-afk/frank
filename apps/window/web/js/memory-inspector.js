const graphModule = () => import("../graph/graph-workbench.bundle.js");

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

function knowledgeContent(content) {
  const article = element("article", "project-knowledge-copy");
  const lines = String(content || "").replaceAll("\r", "").split("\n");
  let list = null;
  let fence = null;
  let fenceLanguage = "";
  const finishList = () => { list = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      if (fence === null) {
        finishList();
        fence = [];
        fenceLanguage = line.slice(3).trim().toLowerCase();
      } else {
        const definition = fence.join("\n");
        if (fenceLanguage === "mermaid") {
          const diagram = element("div", "project-knowledge-diagram");
          diagram.setAttribute("aria-label", "Architecture diagram");
          article.append(diagram);
          void graphModule()
            .then(({ renderMermaid }) => diagram.isConnected ? renderMermaid(diagram, definition) : undefined)
            .catch(() => {
              diagram.classList.add("project-knowledge-code");
              diagram.textContent = definition;
            });
        } else {
          article.append(element("pre", "project-knowledge-code", definition));
        }
        fence = null;
        fenceLanguage = "";
      }
      continue;
    }
    if (fence !== null) { fence.push(raw); continue; }
    if (!line) { finishList(); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      finishList();
      const level = Math.min(4, heading[1].length + 1);
      article.append(element(`h${level}`, "", heading[2]));
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!list) { list = element("ul"); article.append(list); }
      list.append(element("li", "", bullet[1]));
      continue;
    }
    finishList();
    article.append(element("p", "", line.replaceAll("**", "").replaceAll("`", "")));
  }
  if (fence !== null && fence.length) article.append(element("pre", "project-knowledge-code", fence.join("\n")));
  if (!article.childElementCount) article.append(element("p", "connection-empty", "This page has not been generated yet."));
  return article;
}

function knowledgeGraphSnapshot(graph, project) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  return {
    graph_revision: `hindsight-${nodes.length}-${edges.length}`,
    groups: [],
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: "entity",
      status: "declared",
      presentation: {},
      extensions: { "frank.graph.mentions": Number(node.mention_count || 0) },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      status: "declared",
      extensions: {
        "frank.graph.weight": Number(edge.weight || 1),
        "frank.graph.relationship": edge.type || "cooccurrence",
      },
    })),
    project,
  };
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
  let graphHandle = null;
  let graphRenderRevision = 0;
  let activeTab = "overview";

  host.classList.remove("home-grid", "project-signal-grid", "grid-stack", "project-grid-fallback");
  host.classList.add("memory-inspector-host");
  host.replaceChildren();
  const shell = element("div", "tool-workspace");
  const main = element("div", "tool-workspace-main");
  const intro = element("div", "tool-workspace-intro");
  const introCopy = element("div");
  introCopy.append(
    element("span", "home-kicker", "Project knowledge"),
    element("h2", "", `${project.name || project.id}`),
    element("p", "", "A human-readable view of what the project is, its operating rules, how it works, and the provider evidence behind it."),
  );
  const introStatus = element("span", "", "Loading Hindsight…");
  intro.append(introCopy, introStatus);
  main.append(intro);

  const tabs = element("nav", "project-knowledge-tabs");
  tabs.setAttribute("aria-label", "Project knowledge views");
  const panels = new Map();
  const tabButtons = new Map();
  const panel = (id) => {
    const value = element("section", "project-knowledge-panel");
    value.dataset.knowledgePanel = id;
    value.hidden = id !== activeTab;
    panels.set(id, value);
    return value;
  };
  const overviewPanel = panel("overview");
  const rulesPanel = panel("rules");
  const architecturePanel = panel("architecture");
  const graphPanel = panel("map");
  const memoryPanel = panel("memory");

  function selectTab(id) {
    activeTab = id;
    for (const [key, value] of panels) value.hidden = key !== id;
    for (const [key, value] of tabButtons) value.setAttribute("aria-selected", key === id ? "true" : "false");
    if (id !== "map") {
      graphRenderRevision += 1;
      graphHandle?.destroy?.();
      graphHandle = null;
    }
    if (id === "map" && snapshot) void renderKnowledgeGraph(snapshot);
  }
  for (const [id, label] of [["overview", "Overview"], ["rules", "Rules & facts"], ["architecture", "How it works"], ["map", "Project atlas"], ["memory", "Memory activity"]]) {
    const button = control(label, () => selectTab(id), "project-knowledge-tab");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", id === activeTab ? "true" : "false");
    tabs.append(button);
    tabButtons.set(id, button);
  }
  main.append(tabs);

  const overview = element("div", "connection-overview");
  const pageNav = element("div", "project-knowledge-page-nav");
  const pageBody = element("div", "project-knowledge-page");
  const codePageNav = element("div", "project-knowledge-page-nav");
  const codePageBody = element("div", "project-knowledge-page");
  overviewPanel.append(
    overview,
    sectionHeading("Project guide", "Living pages synthesized by Hindsight"), pageNav, pageBody,
    sectionHeading("Application wiki", "Source-grounded pages generated by CodeWiki"), codePageNav, codePageBody,
  );

  const directivesList = element("div", "project-rule-list");
  const rulePageBody = element("div", "project-knowledge-page");
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

  const memoriesSection = element("section", "connections-section connection-panel");
  const memoriesList = element("div", "connection-activity");
  memoriesSection.append(sectionHeading("Retained memories", "Newest provider facts"), memoriesList);
  const sourcesSection = element("section", "connections-section");
  const sourcesList = element("div", "connection-activity");
  sourcesSection.append(sectionHeading("Retained sources", "Correct or forget at source"), sourcesList);
  rulesPanel.append(
    sectionHeading("Operating rules", "Living rulebook and explicit Hindsight directives"),
    rulePageBody,
    directivesList,
    memoriesSection,
  );

  const architectureBody = element("div", "project-knowledge-page");
  architecturePanel.append(sectionHeading("How the application works", "Human-readable architecture and flows"), architectureBody);
  const graphHost = element("div", "project-knowledge-graph");
  graphPanel.append(sectionHeading("Project atlas", "Explore Hindsight knowledge as readable, expandable areas"), graphHost);

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
  const promoteButton = control("Remember everywhere", () => {}, "home-inline-button");
  const forgetButton = control("Forget source", () => {}, "home-inline-button danger-text");
  const closeButton = control("Close source", () => { editorSection.hidden = true; }, "home-inline-button");
  editorActions.append(saveButton, promoteButton, forgetButton, closeButton);
  editorSection.append(editorHeading, editorStatus, editorText, editorActions);

  const activitySection = element("section", "connections-section");
  const activityList = element("div", "connection-activity");
  activitySection.append(sectionHeading("Memory activity", "Recall, retention and provider failures"), activityList);
  memoryPanel.append(recallSection, sourcesSection, editorSection, activitySection);
  main.append(overviewPanel, rulesPanel, architecturePanel, graphPanel, memoryPanel);
  shell.append(main);
  host.append(shell);

  function renderKnowledgeGraphError(error) {
    if (disposed || activeTab !== "map" || !graphHost.isConnected) return;
    graphHost.replaceChildren(element("p", "home-error", error.message || "Project atlas unavailable."));
  }

  function renderKnowledgeGraph(value) {
    const revision = ++graphRenderRevision;
    graphHandle?.destroy?.();
    graphHandle = null;
    const graph = value.entity_graph || {};
    if (!graph.nodes?.length) {
      graphHost.replaceChildren(element("p", "connection-empty", "No entity relationships have been extracted for this project yet."));
      return Promise.resolve();
    }
    return graphModule().then(({ mountGraphWorkbench }) => {
      if (disposed || revision !== graphRenderRevision || activeTab !== "map" || !graphHost.isConnected || snapshot !== value) return;
      graphHandle = mountGraphWorkbench(graphHost, {
        kind: "project",
        entityId: project.id,
        lens: "project.knowledge",
        title: `${project.name || project.id} project atlas`,
        load: async () => knowledgeGraphSnapshot(graph, project),
        validate: (loaded) => loaded,
      });
    }).catch((error) => {
      if (revision === graphRenderRevision) renderKnowledgeGraphError(error);
    });
  }

  function renderPage(page, target) {
    target.replaceChildren();
    if (!page) {
      target.append(element("p", "connection-empty", "This project guide has not been generated yet."));
      return;
    }
    target.append(
      element("p", "project-knowledge-provenance", `${page.source || "Hindsight living page"} · updated ${timestamp(page.updated_at || page.last_refreshed_at || page.created_at)}`),
      knowledgeContent(page.content),
    );
  }

  function renderSnapshot(value) {
    snapshot = value;
    if (value?.schema !== SCHEMA || value.project?.id !== project.id) throw new Error("Memory identity mismatch.");
    const provider = value.provider || {};
    const counts = value.counts || {};
    introStatus.textContent = `${provider.status || "attention"} · ${provider.bank_id || "unknown bank"}`;
    overview.replaceChildren(
      summaryCard("Guide pages", Number(counts.pages || 0), "Human-readable living summaries"),
      summaryCard("App wiki", Number(counts.code_pages || 0), "Pages generated from source code"),
      summaryCard("Rules", Number(counts.rules || 0), "Living rules and active directives"),
      summaryCard("Facts", Number(counts.memories || 0), "Durable project knowledge"),
      summaryCard("Sources", Number(counts.documents || 0), "Traceable retained evidence"),
      summaryCard("Memory health", Number(counts.failed || 0) ? "Attention" : "Healthy", `${provider.name || "Hindsight"} ${provider.version || ""} · ${Number(counts.pending || 0)} pending`, Number(counts.failed || 0) ? "error" : "ready"),
    );
    const pages = Array.isArray(value.knowledge_pages) ? value.knowledge_pages : [];
    const codePages = Array.isArray(value.code_pages) ? value.code_pages : [];
    const overviewPage = pages.find((page) => /project brief|overview|product/i.test(page.name)) || pages[0];
    const codeOverview = codePages.find((page) => /overview|architecture/i.test(page.name)) || codePages[0];
    const rulesPage = pages.find((page) => /rule|policy|decision/i.test(page.name));
    const architecturePage = codePages.find((page) => /architecture|system|overview|data flow|sequence/i.test(page.name))
      || pages.find((page) => /architecture|how .*works|system design|technical/i.test(page.name));
    pageNav.replaceChildren();
    pages.forEach((page) => pageNav.append(control(page.name, () => renderPage(page, pageBody), "project-knowledge-page-button")));
    if (!pages.length) pageNav.append(element("span", "quiet", "No living pages yet"));
    renderPage(overviewPage, pageBody);
    codePageNav.replaceChildren();
    codePages.forEach((page) => codePageNav.append(control(page.name, () => renderPage(page, codePageBody), "project-knowledge-page-button")));
    if (!codePages.length) codePageNav.append(element("span", "quiet", "The source-code wiki has not been generated yet."));
    renderPage(codeOverview, codePageBody);
    renderPage(architecturePage, architectureBody);
    rulePageBody.hidden = !rulesPage;
    if (rulesPage) renderPage(rulesPage, rulePageBody);
    directivesList.replaceChildren();
    (value.directives || []).forEach((directive) => {
      const card = element("article", "project-rule-card");
      card.append(
        element("span", "home-provider", `Priority ${directive.priority || 0}`),
        element("h3", "", directive.name),
        element("p", "", directive.content),
      );
      directivesList.append(card);
    });
    if (!directivesList.childElementCount) directivesList.append(element("p", "connection-empty", "No additional hard enforcement directives are registered for this project."));
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
    if (activeTab === "map") void renderKnowledgeGraph(value);
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
    promoteButton.disabled = true;
    forgetButton.disabled = true;
    try {
      const value = await requestJson(`/api/projects/${projectId}/memory/documents/${encodeURIComponent(source.id)}`, { signal: controller.signal });
      if (disposed) return;
      editorText.value = value.document?.content || "";
      editorStatus.textContent = `${source.memory_count} derived facts · source ${source.id}`;
      saveButton.disabled = false;
      promoteButton.disabled = false;
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
      promoteButton.onclick = async () => {
        const destination = "the global operator scope (remembered in every project)";
        if (!window.confirm(`Remember this source everywhere? Its content and provenance (source ${source.id}) will be promoted to ${destination}. You can forget it later.`)) return;
        promoteButton.disabled = true;
        editorStatus.textContent = "Promoting to the global scope…";
        try {
          const idempotencyKey = `${projectId}-${source.id}-${Date.now()}`;
          const result = await requestJson(`/api/projects/${projectId}/memory/documents/${encodeURIComponent(source.id)}/promote-global`, {
            method: "POST",
            body: JSON.stringify({ confirmation: `PROMOTE ${source.id}`, idempotency_key: idempotencyKey }),
          });
          editorStatus.textContent = `Promoted to ${result.global_bank_id} (from ${result.origin_bank} · ${result.origin_document}). Hindsight re-extracted it globally.`;
        } catch (error) {
          editorStatus.textContent = error.message || "Promotion failed.";
        } finally { promoteButton.disabled = false; }
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
      graphRenderRevision += 1;
      controller.abort();
      graphHandle?.destroy?.();
      graphHandle = null;
      host.classList.remove("memory-inspector-host");
    },
  };
}
