import "@maxgraph/core/css/common.css";
import { Graph, InternalEvent, RubberBandHandler } from "@maxgraph/core";
import { fetchGraphSnapshot } from "./graph-client.js";

const STATUS_COLORS = {
  declared: "#e7e4dc",
  queued: "#f1dfb2",
  running: "#c5dcec",
  succeeded: "#c9e3d0",
  failed: "#f0c3b8",
  blocked: "#e6c8dc",
  cancelled: "#d9d7d0",
  unavailable: "#dedbd3",
};

const $ = (tag, className, text = "") => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
};

function graphStyle(status) {
  return {
    rounded: true,
    arcSize: 14,
    fillColor: STATUS_COLORS[status] || STATUS_COLORS.declared,
    strokeColor: "#252525",
    fontColor: "#171717",
    fontSize: 13,
    spacing: 8,
    whiteSpace: "wrap",
  };
}

function buildToolbar(root, state) {
  const toolbar = $("div", "graph-toolbar");
  const lens = $("span", "graph-lens", state.lens);
  const status = $("span", "graph-status", "Read-only provider projection");
  const refresh = $("button", "graph-button", "Refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => state.load());
  const fit = $("button", "graph-button", "Center");
  fit.type = "button";
  fit.addEventListener("click", () => state.graph?.center(true, true));
  toolbar.append(lens, status, refresh, fit);
  root.append(toolbar);
  return { status };
}

function renderSnapshot(state, snapshot) {
  const { graph } = state;
  const parent = graph.getDefaultParent();
  const existing = graph.getChildCells(parent, true, true);
  if (existing.length) graph.removeCells(existing);
  const cells = new Map();
  const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(snapshot.nodes.length || 1))));
  graph.batchUpdate(() => {
    snapshot.nodes.forEach((node, index) => {
      const cell = graph.insertVertex({
        parent,
        id: node.id,
        value: node.label,
        position: [36 + (index % columns) * 230, 30 + Math.floor(index / columns) * 92],
        size: [190, 48],
        style: graphStyle(node.status),
      });
      cells.set(node.id, cell);
    });
    snapshot.edges.forEach((edge) => {
      const source = cells.get(edge.from);
      const target = cells.get(edge.to);
      if (source && target) graph.insertEdge({ parent, id: edge.id, source, target, style: { edgeStyle: "orthogonalEdgeStyle", rounded: true, strokeColor: "#6e6a60", endArrow: "block" } });
    });
  });
  graph.center(true, true);
  state.meta.textContent = `${snapshot.nodes.length} nodes · ${snapshot.edges.length} edges · ${snapshot.graph_revision.slice(0, 18)}`;
}

export function mountGraphWorkbench(root, options = {}) {
  root.replaceChildren();
  root.classList.add("graph-workbench");
  const state = {
    kind: options.kind || "tool",
    entityId: options.entityId || "",
    lens: options.lens || "tool.pipeline",
    graph: null,
    meta: $("p", "graph-meta", "Loading graph projection…"),
    load: null,
  };
  const heading = $("div", "graph-heading");
  heading.append($("div", "graph-kicker", "Shared workbench"), $("h2", "graph-title", options.title || "Graph"));
  const note = $("p", "graph-note", "Frank renders an authorized projection. Hermes remains the authority for settings, traces, and execution.");
  const controls = buildToolbar(root, state);
  const canvas = $("div", "graph-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Read-only graph canvas. Use arrow keys to move between nodes.");
  const meta = state.meta;
  const empty = $("p", "graph-empty", "No graph projection is available.");
  root.prepend(heading, note);
  root.append(canvas, meta, empty);

  InternalEvent.disableContextMenu(canvas);
  const graph = new Graph(canvas);
  graph.setEnabled(false);
  graph.setConnectable(false);
  graph.setTooltips(false);
  graph.setCellsLocked(true);
  new RubberBandHandler(graph);
  state.graph = graph;
  state.meta = meta;
  graph.addListener(InternalEvent.CLICK, (_sender, event) => {
    const cell = event.getProperty("cell");
    if (cell?.value) controls.status.textContent = `Selected ${String(cell.value)} · read-only`;
  });
  canvas.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") graph.selectPreviousCell();
    else graph.selectNextCell();
    const selected = graph.getSelectionCell();
    if (selected) graph.scrollCellToVisible(selected);
  });

  state.load = async () => {
    empty.hidden = true;
    controls.status.textContent = "Loading authorized projection…";
    try {
      const snapshot = await (options.load || fetchGraphSnapshot)({ kind: state.kind, entityId: state.entityId, lens: state.lens, settingsRevisionId: options.settingsRevisionId, traceId: options.traceId });
      renderSnapshot(state, snapshot);
      controls.status.textContent = "Read-only provider projection";
    } catch (error) {
      empty.hidden = false;
      controls.status.textContent = "Graph unavailable";
      state.meta.textContent = error.message || "Graph is unavailable.";
    }
  };
  void state.load();
  return { destroy: () => graph.destroy(), reload: state.load, graph };
}
