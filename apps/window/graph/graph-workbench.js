import "@maxgraph/core/css/common.css";
import "./graph-workbench.css";
import { Graph as MaxGraph, InternalEvent, RubberBandHandler } from "@maxgraph/core";
import Sigma from "sigma";
import Graphology from "graphology";
import { fetchGraphSnapshot, validateGraphSnapshot } from "./graph-client.js";
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
  toolbar.append(lens, status, filter, refresh, fit);
  root.append(toolbar);
  return { status, filter };
}

function destroyActiveRenderer(state) {
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
  delete state.maxHost.dataset.active;
  delete state.sigmaHost.dataset.active;
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

function clearSnapshot(state) {
  destroyActiveRenderer(state);
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
  const kind = "tool";
  const state = {
    kind, entityId: options.entityId || "",
    lens: "tool.pipeline", graph: null, sigma: null,
    nodes: new Map(), meta: $("p", "graph-meta", "Loading graph projection…"),
    details: $("p", "graph-details"), load: null, loadGeneration: 0,
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
  const instructions = $("p", "graph-instructions", "Focus the graph and press Enter or Space to move to the accessible node list. The arrow keys navigate the small graph when available.");
  instructions.id = `graph-instructions-${++workbenchSequence}`;
  canvas.setAttribute("aria-describedby", instructions.id);
  const maxHost = $("div", "graph-renderer-host graph-max-host");
  const sigmaHost = $("div", "graph-renderer-host graph-sigma-host");
  canvas.append(maxHost, sigmaHost);
  const empty = $("p", "graph-empty", "No graph available.");
  const stage = $("div", "graph-stage");
  stage.append(canvas, instructions, empty);
  const nodeList = $("ul", "graph-node-list");
  nodeList.setAttribute("aria-label", "Graph nodes");
  root.prepend(heading);
  root.append(state.legend, stage, nodeList, state.details, state.meta);
  Object.assign(state, { canvas, maxHost, sigmaHost, nodeList });
  state.select = (id) => {
    const node = state.nodes.get(id);
    if (!node) return;
    controls.status.textContent = `Selected ${node.label}`;
    state.details.textContent = `${node.label} · ${node.kind} · ${node.status}`;
  };
  state.fit = () => {
    if (state.sigma) state.sigma.getCamera().animatedReset({ duration: 250 });
    else state.graph?.center(true, true);
  };
  controls.filter.addEventListener("input", () => {
    state.filter = controls.filter.value.trim().toLowerCase();
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
      const snapshot = validateGraphSnapshot(loaded, params);
      renderNodeList(state, snapshot);
      renderGroupLegend(state, snapshot);
      const renderer = chooseGraphRenderer(snapshot, params);
      if (renderer === "sigma") renderSigma(state, snapshot);
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
