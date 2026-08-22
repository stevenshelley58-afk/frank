import "@maxgraph/core/css/common.css";
import "./graph-workbench.css";
import { Graph as G6Graph } from "@antv/g6";
import { Graph as MaxGraph, InternalEvent, RubberBandHandler } from "@maxgraph/core";
import Sigma from "sigma";
import Graphology from "graphology";
import mermaid from "mermaid";
import { fetchGraphSnapshot, validateGraphSnapshot } from "./graph-client.js";
import { buildProjectAtlas } from "./project-atlas.js";
import {
  chooseGraphRenderer,
  MAXGRAPH_NODE_THRESHOLD,
  MAXGRAPH_EDGE_THRESHOLD,
} from "./renderer-policy.js";

export {
  chooseGraphRenderer,
  MAXGRAPH_NODE_THRESHOLD,
  MAXGRAPH_EDGE_THRESHOLD,
} from "./renderer-policy.js";

const STATUS_COLORS = {
  declared: "#e7e4dc", queued: "#f1dfb2", running: "#c5dcec",
  succeeded: "#c9e3d0", failed: "#f0c3b8", blocked: "#e6c8dc",
  cancelled: "#d9d7d0", unavailable: "#dedbd3",
};
const GROUP_COLORS = { code: "#6b8fb3", vault: "#a9824b", memory: "#8069a8" };
let workbenchSequence = 0;
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });

export async function renderMermaid(host, definition) {
  const id = `frank-mermaid-${++workbenchSequence}`;
  const { svg } = await mermaid.render(id, String(definition || "").slice(0, 100_000));
  host.innerHTML = svg;
}

const $ = (tag, className, text = "") => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
};

function groupCategory(snapshot, node, groups = null) {
  const group = (groups || new Map(snapshot.groups.map((item) => [item.id, item]))).get(node.presentation?.group_id);
  const text = [group?.label, group?.id, node.source?.source_type].filter(Boolean).join(" ").toLowerCase();
  if (/\b(code|repo|repository|source|file|github|gitlab)\b/.test(text)) return "code";
  if (/\b(vault|secret|secrets|credential)\b/.test(text)) return "vault";
  if (/\b(memory|hermes)\b/.test(text)) return "memory";
  return "";
}

function graphColor(snapshot, node, groups = null) {
  return GROUP_COLORS[groupCategory(snapshot, node, groups)] || STATUS_COLORS[node.status] || STATUS_COLORS.declared;
}

function graphStyle(status, color) {
  return {
    rounded: true, arcSize: 14,
    fillColor: color || STATUS_COLORS[status] || STATUS_COLORS.declared,
    strokeColor: "#252525", fontColor: "#171717", fontSize: 13,
    spacing: 8, whiteSpace: "wrap",
  };
}

function renderGroupLegend(state, snapshot) {
  state.legend.replaceChildren();
  const groups = new Map(snapshot.groups.map((item) => [item.id, item]));
  const categories = new Set(snapshot.nodes.map((node) => groupCategory(snapshot, node, groups)).filter(Boolean));
  if (!categories.size) {
    state.legend.hidden = true;
    return;
  }
  state.legend.hidden = false;
  state.legend.append($("span", "graph-legend-title", "Groups"));
  for (const category of ["code", "vault", "memory"]) {
    if (!categories.has(category)) continue;
    const item = $("span", "graph-legend-item");
    const swatch = $("i", "graph-legend-swatch");
    swatch.style.backgroundColor = GROUP_COLORS[category];
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, $("span", "", category[0].toUpperCase() + category.slice(1)));
    state.legend.append(item);
  }
}

function buildToolbar(root, state) {
  const toolbar = $("div", "graph-toolbar");
  const lens = $("span", "graph-lens", state.lens);
  const status = $("span", "graph-status", "Loading");
  const filter = $("input", "graph-filter");
  filter.type = "search";
  filter.placeholder = "Filter nodes";
  filter.setAttribute("aria-label", "Filter graph nodes");
  const refresh = $("button", "graph-button", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => state.load());
  const fit = $("button", "graph-button", "Center");
  fit.type = "button";
  fit.addEventListener("click", () => state.fit());
  toolbar.append(lens, status, filter);
  if (state.kind === "project") {
    filter.placeholder = "Search project knowledge";
    const overview = $("button", "graph-button", "Overview");
    overview.type = "button";
    overview.addEventListener("click", () => void state.resetAtlas?.());
    const browse = $("button", "graph-button", "Browse entities");
    browse.type = "button";
    browse.setAttribute("aria-expanded", "false");
    browse.addEventListener("click", () => {
      const open = root.dataset.entityList !== "open";
      root.dataset.entityList = open ? "open" : "closed";
      browse.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) state.nodeList?.querySelector("button")?.focus();
    });
    toolbar.append(overview, browse);
  }
  toolbar.append(refresh, fit);
  root.append(toolbar);
  return { status, filter };
}

function destroyActiveRenderer(state) {
  if (state.g6) {
    state.g6.destroy();
    state.g6 = null;
  }
  if (state.sigma) {
    state.sigma.kill();
    state.sigma = null;
  }
  if (state.graph) {
    state.graph.destroy();
    state.graph = null;
  }
  state.maxHost.replaceChildren();
  state.sigmaHost.replaceChildren();
  state.atlasHost.replaceChildren();
  delete state.maxHost.dataset.active;
  delete state.sigmaHost.dataset.active;
  delete state.atlasHost.dataset.active;
}

function renderMaxGraph(state, snapshot) {
  destroyActiveRenderer(state);
  const groups = new Map(snapshot.groups.map((item) => [item.id, item]));
  const graph = new MaxGraph(state.maxHost);
  graph.setEnabled(false);
  graph.setConnectable(false);
  graph.setTooltips(false);
  graph.setCellsLocked(true);
  new RubberBandHandler(graph);
  const parent = graph.getDefaultParent();
  const cells = new Map();
  const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(snapshot.nodes.length || 1))));
  graph.batchUpdate(() => {
    snapshot.nodes.forEach((node, index) => {
      const cell = graph.insertVertex({
        parent, id: node.id, value: node.label,
        position: [36 + (index % columns) * 230, 30 + Math.floor(index / columns) * 92],
        size: [190, 48], style: graphStyle(node.status, graphColor(snapshot, node, groups)),
      });
      cells.set(node.id, cell);
    });
    snapshot.edges.forEach((edge) => {
      const source = cells.get(edge.from);
      const target = cells.get(edge.to);
      if (source && target) graph.insertEdge({
        parent, id: edge.id, source, target,
        style: { edgeStyle: "orthogonalEdgeStyle", rounded: true, strokeColor: "#6e6a60", endArrow: "block" },
      });
    });
  });
  graph.center(true, true);
  graph.addListener(InternalEvent.CLICK, (_sender, event) => {
    const cell = event.getProperty("cell");
    if (cell?.id) state.select(cell.id);
  });
  state.graph = graph;
  state.maxHost.dataset.active = "true";
}

function renderSigma(state, snapshot) {
  destroyActiveRenderer(state);
  const groups = new Map(snapshot.groups.map((item) => [item.id, item]));
  const graph = new Graphology({ multi: true, type: "directed" });
  const count = Math.max(1, snapshot.nodes.length);
  const radius = Math.max(120, Math.sqrt(count) * 34);
  snapshot.nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    graph.addNode(node.id, {
      label: node.label, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
      size: node.extensions?.["frank.graph.entry"] ? 10 : 7,
      color: graphColor(snapshot, node, groups),
    });
  });
  snapshot.edges.forEach((edge) => {
    if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
      graph.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, { color: "#8a857a", size: 1 });
    }
  });
  const sigma = new Sigma(graph, state.sigmaHost, {
    renderLabels: true, labelColor: { color: "#171717" },
    labelRenderedSizeThreshold: 5, defaultNodeColor: "#e7e4dc",
    allowInvalidContainer: true,
  });
  sigma.on("clickNode", ({ node }) => state.select(node));
  state.sigma = sigma;
  state.sigmaHost.dataset.active = "true";
}

function atlasDatum(value) {
  return value?.data || {};
}

function atlasEventId(event) {
  return event?.target?.id || event?.target?.attributes?.id || event?.target?.config?.id || "";
}

function atlasInspectorShell(kicker, title, copy) {
  const shell = $("article", "atlas-inspector-card");
  shell.append(
    $("span", "atlas-inspector-kicker", kicker),
    $("h3", "atlas-inspector-title", title),
    $("p", "atlas-inspector-copy", copy),
  );
  return shell;
}

function renderAtlasIntro(state) {
  const atlas = state.atlas;
  state.details.replaceChildren();
  const shell = atlasInspectorShell(
    "Project atlas",
    `${atlas.topics.length} knowledge areas`,
    "Start with the shape of the project. Double-click an area to open it, then select an entity to inspect its evidence and relationships.",
  );
  const metrics = $("dl", "atlas-metrics");
  for (const [label, value] of [["Entities", atlas.nodes.length], ["Relationships", atlas.edges.length]]) {
    const item = $("div", "atlas-metric");
    item.append($("dt", "", label), $("dd", "", String(value)));
    metrics.append(item);
  }
  const topicList = $("div", "atlas-topic-list");
  atlas.topics.forEach((topic) => {
    const button = $("button", "atlas-topic-button");
    button.type = "button";
    button.style.setProperty("--topic-color", topic.color.ink);
    button.append(
      $("span", "atlas-topic-button-label", topic.label),
      $("span", "atlas-topic-button-count", `${topic.members.length} entities`),
    );
    button.addEventListener("click", () => void state.selectTopic(topic.id, true));
    topicList.append(button);
  });
  shell.append(metrics, $("h4", "atlas-inspector-subhead", "Knowledge areas"), topicList);
  state.details.append(shell);
}

function renderAtlasTopic(state, topicId) {
  const topic = state.atlas.topics.find((item) => item.id === topicId);
  if (!topic) return;
  state.details.replaceChildren();
  const shell = atlasInspectorShell(
    "Knowledge area",
    topic.label,
    `${topic.members.length} related entities with ${topic.relationshipCount} recorded connections. Double-click the area on the map to open or close it.`,
  );
  const list = $("div", "atlas-related-list");
  [...topic.members]
    .sort((left, right) => right.mentions - left.mentions || left.label.localeCompare(right.label))
    .slice(0, 12)
    .forEach((member) => {
      const button = $("button", "atlas-related-button");
      button.type = "button";
      button.append(
        $("span", "", member.label),
        $("small", "", member.mentions ? `${member.mentions} mentions` : "Retained entity"),
      );
      button.addEventListener("click", () => void state.select(member.id, true));
      list.append(button);
    });
  shell.append($("h4", "atlas-inspector-subhead", "Leading entities"), list);
  state.details.append(shell);
}

function renderAtlasNode(state, nodeId) {
  const node = state.atlas.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const data = atlasDatum(node);
  const connected = data.neighborIds || [];
  state.details.replaceChildren();
  const shell = atlasInspectorShell(
    data.topicLabel || "Project knowledge",
    data.label || node.id,
    data.mentions
      ? `Hindsight has retained ${data.mentions} mentions of this entity in the project bank.`
      : "This entity is retained in the project knowledge graph.",
  );
  const metrics = $("dl", "atlas-metrics");
  for (const [label, value] of [["Mentions", data.mentions || 0], ["Connections", connected.length]]) {
    const item = $("div", "atlas-metric");
    item.append($("dt", "", label), $("dd", "", String(value)));
    metrics.append(item);
  }
  shell.append(metrics);
  if (connected.length) {
    shell.append($("h4", "atlas-inspector-subhead", "Direct relationships"));
    const list = $("div", "atlas-related-list");
    connected.slice(0, 10).forEach((relatedId) => {
      const related = state.atlas.nodes.find((item) => item.id === relatedId);
      if (!related) return;
      const button = $("button", "atlas-related-button");
      button.type = "button";
      button.append($("span", "", atlasDatum(related).label || related.id), $("small", "", atlasDatum(related).topicLabel || "Project context"));
      button.addEventListener("click", () => void state.select(related.id, true));
      list.append(button);
    });
    shell.append(list);
  }
  state.details.append(shell);
}

async function renderProjectAtlas(state, snapshot) {
  destroyActiveRenderer(state);
  const atlas = buildProjectAtlas(snapshot);
  state.atlas = atlas;
  const topicById = new Map(atlas.topics.map((topic) => [topic.id, topic]));
  const topicForDatum = (datum) => topicById.get(atlasDatum(datum).topicId) || atlas.topics[0];
  const graph = new G6Graph({
    container: state.atlasHost,
    data: { nodes: atlas.nodes, edges: atlas.edges, combos: atlas.combos },
    autoFit: "view",
    animation: false,
    layout: {
      type: "combo-combined",
      comboPadding: 34,
      comboSpacing: 90,
      nodeSpacing: 28,
      nodeSize: 156,
      layout: (comboId) => comboId
        ? { type: "concentric", nodeSize: 156, nodeSpacing: 28, preventOverlap: true }
        : { type: "grid", cols: 3, condense: true, preventOverlap: true, nodeSize: [300, 160] },
    },
    node: {
      type: "rect",
      style: (datum) => {
        const data = atlasDatum(datum);
        const topic = topicForDatum(datum);
        return {
          size: [156, 46],
          radius: 12,
          fill: topic?.color.wash || "#f7f4ec",
          stroke: topic?.color.ink || "#4c514a",
          lineWidth: 1.2,
          shadowColor: "rgba(38, 34, 28, 0.12)",
          shadowBlur: 9,
          labelText: data.label || datum.id,
          labelFill: "#1c1b18",
          labelFontFamily: "Georgia, 'Times New Roman', serif",
          labelFontSize: 12,
          labelMaxWidth: 132,
          labelWordWrap: true,
          cursor: "pointer",
        };
      },
      state: {
        selected: { lineWidth: 3, stroke: "#e33d20" },
        active: { lineWidth: 2.2, shadowBlur: 16 },
        inactive: { opacity: 0.28 },
      },
    },
    combo: {
      type: "rect",
      style: (datum) => {
        const data = atlasDatum(datum);
        const color = data.color || { ink: "#174f43", fill: "#dbeae1", wash: "#edf5f0" };
        const collapsed = datum.style?.collapsed !== false;
        return {
          collapsed,
          collapsedSize: [224, 94],
          radius: collapsed ? 22 : 28,
          padding: [42, 28, 28, 28],
          fill: collapsed ? color.fill : color.wash,
          fillOpacity: collapsed ? 0.98 : 0.58,
          stroke: color.ink,
          strokeOpacity: collapsed ? 0.78 : 0.48,
          lineWidth: collapsed ? 1.6 : 1.2,
          shadowColor: "rgba(38, 34, 28, 0.14)",
          shadowBlur: collapsed ? 18 : 8,
          labelText: data.label || datum.id,
          labelFill: color.ink,
          labelFontFamily: "Georgia, 'Times New Roman', serif",
          labelFontSize: collapsed ? 16 : 14,
          labelFontWeight: 700,
          labelPlacement: collapsed ? "center" : "top",
          labelOffsetY: collapsed ? -8 : 8,
          collapsedMarker: true,
          collapsedMarkerType: "child-count",
          collapsedMarkerFill: color.ink,
          collapsedMarkerFontSize: 11,
          cursor: "pointer",
        };
      },
      state: {
        selected: { lineWidth: 3, stroke: "#e33d20" },
        active: { lineWidth: 2.4 },
        inactive: { opacity: 0.32 },
      },
    },
    edge: {
      type: "quadratic",
      style: {
        stroke: "#827c70",
        strokeOpacity: 0.24,
        lineWidth: 1.15,
        endArrow: false,
      },
      state: {
        active: { stroke: "#e33d20", strokeOpacity: 0.78, lineWidth: 2 },
        inactive: { strokeOpacity: 0.06 },
      },
    },
    behaviors: [
      "drag-canvas",
      "zoom-canvas",
      "drag-element",
      "click-select",
      { type: "collapse-expand", trigger: "dblclick", animation: true },
      { type: "hover-activate", degree: 1, state: "active", inactiveState: "inactive" },
      { type: "auto-adapt-label", padding: 8 },
    ],
    transforms: [{ type: "process-parallel-edges", mode: "merge" }],
    plugins: [{ type: "minimap", key: "atlas-minimap", size: [150, 94], position: "right-bottom" }],
  });
  state.g6 = graph;
  graph.on("node:click", (event) => {
    const id = atlasEventId(event);
    if (id) void state.select(id, false);
  });
  graph.on("combo:click", (event) => {
    const id = atlasEventId(event);
    if (id) void state.selectTopic(id, false);
  });
  await graph.render();
  state.atlasHost.dataset.active = "true";
  renderAtlasIntro(state);
}

function clearSnapshot(state) {
  destroyActiveRenderer(state);
  state.atlas = null;
  state.meta.textContent = "";
  state.details.textContent = "";
  state.legend.replaceChildren();
  state.legend.hidden = true;
  state.nodeList.replaceChildren();
  delete state.nodeList.dataset.totalNodes;
  state.renderNodeList = null;
  state.nodes.clear();
}

function renderNodeList(state, snapshot) {
  state.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  state.nodeList.dataset.totalNodes = String(snapshot.nodes.length);
  state.nodeList.setAttribute("aria-label", `Graph nodes; ${snapshot.nodes.length} total. Search to narrow the list.`);
  state.renderNodeList = () => {
    const needle = state.filter;
    const visibleNodes = [...state.nodes.values()]
      .filter((node) => !needle || node.label.toLowerCase().includes(needle))
      .slice(0, 200);
    state.nodeList.replaceChildren();
    visibleNodes.forEach((node) => {
      const item = $("li", "graph-node-list-item");
      const button = $("button", "graph-node-button", node.label);
      button.type = "button";
      button.addEventListener("click", () => state.select(node.id));
      item.append(button);
      state.nodeList.append(item);
    });
    state.nodeList.setAttribute("aria-label", `Graph nodes; ${state.nodes.size} total, showing ${visibleNodes.length}. Search to narrow the list.`);
  };
  state.renderNodeList();
}

export function mountGraphWorkbench(root, options = {}) {
  root.replaceChildren();
  root.classList.add("graph-workbench");
  const kind = options.kind || "tool";
  root.classList.toggle("graph-project-atlas", kind === "project");
  const state = {
    kind, entityId: options.entityId || "",
    lens: options.lens || "tool.pipeline", graph: null, sigma: null, g6: null, atlas: null,
    nodes: new Map(), meta: $("p", "graph-meta", "Loading graph projection…"),
    details: $("div", "graph-details"), load: null, loadGeneration: 0,
    destroyed: false, filter: "", legend: $("div", "graph-group-legend"),
  };
  const heading = $("div", "graph-heading");
  heading.append($("h2", "graph-title", options.title || "Graph"));
  const controls = buildToolbar(root, state);
  const canvas = $("div", "graph-canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Read-only graph visualization; use the node list below to inspect nodes");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-keyshortcuts", "Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight");
  const instructions = $("p", "graph-instructions", kind === "project"
    ? "Double-click a knowledge area to open it. Select an entity for details, or press Enter to use the accessible entity list."
    : "Focus the graph and press Enter or Space to move to the accessible node list. The arrow keys navigate the small graph when available.");
  instructions.id = `graph-instructions-${++workbenchSequence}`;
  canvas.setAttribute("aria-describedby", instructions.id);
  const maxHost = $("div", "graph-renderer-host graph-max-host");
  const sigmaHost = $("div", "graph-renderer-host graph-sigma-host");
  const atlasHost = $("div", "graph-renderer-host graph-atlas-host");
  canvas.append(maxHost, sigmaHost, atlasHost);
  const empty = $("p", "graph-empty", "No graph available.");
  const stage = $("div", "graph-stage");
  stage.append(canvas, instructions, empty);
  const nodeList = $("ul", "graph-node-list");
  nodeList.setAttribute("aria-label", "Graph nodes");
  root.prepend(heading);
  root.append(state.legend, stage, nodeList, state.details, state.meta);
  Object.assign(state, { canvas, maxHost, sigmaHost, atlasHost, nodeList });
  state.selectTopic = async (id, focus = false) => {
    const topic = state.atlas?.topics.find((item) => item.id === id);
    if (!topic) return;
    controls.status.textContent = `Selected ${topic.label}`;
    renderAtlasTopic(state, id);
    if (focus && state.g6) await state.g6.focusElement(id, { duration: 320 });
  };
  state.resetAtlas = async () => {
    if (!state.g6 || !state.atlas) return;
    for (const topic of state.atlas.topics) await state.g6.collapseElement(topic.id, { animation: false });
    await state.g6.fitView({ padding: 52 }, { duration: 320 });
    controls.status.textContent = "Ready · project atlas";
    renderAtlasIntro(state);
  };
  state.select = async (id, focus = false) => {
    const node = state.nodes.get(id);
    if (!node) return;
    controls.status.textContent = `Selected ${node.label}`;
    if (state.g6 && state.atlas) {
      const atlasNode = state.atlas.nodes.find((item) => item.id === id);
      const topicId = atlasDatum(atlasNode).topicId;
      if (focus && topicId) await state.g6.expandElement(topicId, { animation: true });
      renderAtlasNode(state, id);
      if (focus) await state.g6.focusElement(id, { duration: 320 });
    } else {
      state.details.textContent = `${node.label} · ${node.kind} · ${node.status}`;
    }
    options.onSelect?.(node);
  };
  state.fit = () => {
    if (state.g6) void state.g6.fitView({ padding: 44 }, { duration: 280 });
    else if (state.sigma) state.sigma.getCamera().animatedReset({ duration: 250 });
    else state.graph?.center(true, true);
  };
  controls.filter.addEventListener("input", () => {
    state.filter = controls.filter.value.trim().toLowerCase();
    if (state.kind === "project") root.dataset.entityList = state.filter ? "open" : "closed";
    state.renderNodeList?.();
    if (state.sigma) state.sigma.setSetting("nodeReducer", (_node, data) => ({
      ...data, hidden: Boolean(state.filter && !String(data.label || "").toLowerCase().includes(state.filter)),
    }));
    if (state.graph) {
      state.graph.getChildVertices(state.graph.getDefaultParent()).forEach((cell) => {
        state.graph.getModel().setVisible(cell, !state.filter || String(cell.value || "").toLowerCase().includes(state.filter));
      });
      state.graph.refresh();
    }
  });
  InternalEvent.disableContextMenu(canvas);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (state.kind === "project") root.dataset.entityList = "open";
      state.nodeList.querySelector("button")?.focus();
      return;
    }
    if (!state.graph || !["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") state.graph.selectPreviousCell();
    else state.graph.selectNextCell();
    const selected = state.graph.getSelectionCell();
    if (selected) { state.graph.scrollCellToVisible(selected); state.select(selected.id); }
  });
  state.load = async () => {
    const generation = ++state.loadGeneration;
    clearSnapshot(state);
    controls.filter.value = "";
    state.filter = "";
    root.dataset.graphState = "loading";
    empty.hidden = true;
    controls.status.textContent = "Loading…";
    try {
      const params = { kind: state.kind, entityId: state.entityId, lens: state.lens };
      const loaded = await (options.load || fetchGraphSnapshot)(params);
      if (state.destroyed || generation !== state.loadGeneration) return;
      const snapshot = (options.validate || validateGraphSnapshot)(loaded, params);
      renderNodeList(state, snapshot);
      renderGroupLegend(state, snapshot);
      const renderer = chooseGraphRenderer(snapshot, params);
      if (renderer === "g6") await renderProjectAtlas(state, snapshot);
      else if (renderer === "sigma") renderSigma(state, snapshot);
      else renderMaxGraph(state, snapshot);
      options.onRenderer?.(renderer);
      root.dataset.graphRenderer = renderer;
      state.meta.textContent = `${snapshot.nodes.length} nodes · ${snapshot.edges.length} edges · ${snapshot.graph_revision.slice(0, 18)}`;
      controls.status.textContent = `Ready · ${renderer}`;
      const bounds = canvas.getBoundingClientRect();
      root.dataset.canvasWidth = String(Math.round(bounds.width));
      root.dataset.canvasHeight = String(Math.round(bounds.height));
      root.dataset.graphState = "ready";
    } catch (error) {
      if (state.destroyed || generation !== state.loadGeneration) return;
      clearSnapshot(state);
      empty.hidden = false;
      controls.status.textContent = "Graph unavailable";
      state.meta.textContent = error.message || "Graph is unavailable.";
      delete root.dataset.canvasWidth;
      delete root.dataset.canvasHeight;
      delete root.dataset.graphRenderer;
      root.dataset.graphState = "unavailable";
    }
  };
  void state.load();
  return {
    destroy: () => { state.destroyed = true; state.loadGeneration += 1; clearSnapshot(state); },
    reload: state.load, graph: state.graph, state,
  };
}
