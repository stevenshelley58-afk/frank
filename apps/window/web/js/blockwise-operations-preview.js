import { OPERATIONS_TOOLS, operationsTool } from "./operations-tools.js";

const PREVIEW_ID = "blockwise-operations";
const WIDGET_PREFIX = "operations-";

const LAYOUTS = Object.freeze({
  "operations-command": { x: 0, y: 0, w: 4, h: 2 },
  "operations-inbox": { x: 4, y: 0, w: 4, h: 2 },
  "operations-calendar": { x: 8, y: 0, w: 4, h: 2 },
  "operations-customers": { x: 0, y: 2, w: 3, h: 2 },
  "operations-email-flows": { x: 3, y: 2, w: 3, h: 2 },
  "operations-notifications": { x: 6, y: 2, w: 3, h: 2 },
  "operations-billing": { x: 9, y: 2, w: 3, h: 2 },
  "operations-analytics": { x: 0, y: 4, w: 6, h: 2 },
  "operations-connections": { x: 6, y: 4, w: 6, h: 2 },
});

const commandManifest = {
  id: "operations-command",
  version: "0.1.0-preview",
  title: "Today",
  description: "The owner queue and overall Blockwise operating signal.",
  surfaces: ["project"],
  default_size: "small",
  allowed_sizes: ["small", "medium", "wide"],
  provider: "frank.operations",
  freshness: "snapshot",
  accepts_connection: false,
  multiple: false,
  preview: true,
};

export const BLOCKWISE_PREVIEW_MANIFESTS = Object.freeze([
  commandManifest,
  ...OPERATIONS_TOOLS.map((tool) => ({
    id: `${WIDGET_PREFIX}${tool.id}`,
    version: "0.1.0-preview",
    title: tool.name,
    description: tool.description,
    surfaces: ["project"],
    default_size: "small",
    allowed_sizes: ["small", "medium", "wide"],
    provider: tool.provider.toLowerCase().replaceAll(" + ", "."),
    freshness: "snapshot",
    accepts_connection: false,
    multiple: false,
    preview: true,
  })),
]);

export function isBlockwiseOperationsPreview() {
  return new URLSearchParams(window.location.search).get("preview") === PREVIEW_ID;
}

function instance(widgetId, index) {
  return {
    instance_id: `preview-${index + 1}`,
    widget_id: widgetId,
    size: LAYOUTS[widgetId]?.w >= 5 ? "medium" : "small",
    config: {},
    layout: { ...LAYOUTS[widgetId] },
  };
}

export function blockwisePreviewHome(project = {}) {
  const widgetIds = Object.keys(LAYOUTS);
  return {
    schema: "schema://frank.home/v1",
    entity: {
      kind: "project",
      id: "blockwise",
      name: project.name || "Blockwise",
      blurb: "Run the whole Blockwise customer operation from one place.",
      profile: { live: project.live || "https://blockwise.sale" },
    },
    revision: 0,
    instances: widgetIds.map(instance),
    updated_at: null,
    blueprint_version: 0,
    max_widgets: 24,
    preview: true,
  };
}

function internalToolLink(tool) {
  if (tool.id === "connections") {
    return { kind: "internal", label: "Manage connections", target: { view: "connections" } };
  }
  return {
    kind: "internal",
    label: `Open ${tool.name.toLowerCase()}`,
    target: { view: "operations-tool", id: tool.id, name: tool.name },
  };
}

function commandSnapshot() {
  return {
    status: "recorded",
    summary: "Five items need you today",
    data: {
      preview: true,
      headline: "Your customer operation is under control.",
      metrics: [
        { value: "2", label: "Replies due" },
        { value: "3", label: "Bookings today" },
        { value: "2", label: "Accounts to review" },
      ],
      note: "No system failures in this preview.",
    },
    links: [
      internalToolLink(operationsTool("inbox")),
      internalToolLink(operationsTool("notifications")),
    ],
  };
}

function toolSnapshot(tool) {
  return {
    status: "recorded",
    summary: tool.description,
    data: {
      preview: true,
      metric: tool.metrics[0][0],
      metric_label: tool.metrics[0][1],
      supporting_metrics: tool.metrics.slice(1).map(([value, label]) => ({ value, label })),
      rows: tool.items.slice(0, 2).map((item) => ({
        title: item.title,
        detail: item.meta,
        status: item.status,
      })),
    },
    links: [internalToolLink(tool)],
  };
}

export function blockwisePreviewSnapshot(instanceValue) {
  if (!instanceValue || typeof instanceValue !== "object") return null;
  const tool = operationsTool(instanceValue.widget_id.slice(WIDGET_PREFIX.length));
  const base = instanceValue.widget_id === "operations-command" ? commandSnapshot() : tool ? toolSnapshot(tool) : null;
  if (!base) return null;
  return {
    ...base,
    schema: "schema://frank.widget-snapshot/v1",
    entity_kind: "project",
    entity_id: "blockwise",
    instance_id: instanceValue.instance_id,
    widget_id: instanceValue.widget_id,
    generated_at: new Date().toISOString(),
    preview: true,
  };
}
