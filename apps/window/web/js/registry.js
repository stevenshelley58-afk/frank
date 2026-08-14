const widgets = new Map();

function normalized(manifest) {
  if (!manifest?.id || typeof manifest.mount !== "function") throw new Error("widget needs id + mount");
  const surfaces = Array.isArray(manifest.surfaces) ? [...new Set(manifest.surfaces)] : [];
  if (!surfaces.length) throw new Error(`widget ${manifest.id} needs a surface`);
  return {
    version: "1.0.0",
    description: "",
    defaultSize: "medium",
    allowedSizes: ["small", "medium", "wide"],
    provider: "frank.window",
    freshness: "snapshot",
    multiple: false,
    ...manifest,
    surfaces,
  };
}

export function define(manifest) {
  const widget = normalized(manifest);
  if (widgets.has(widget.id)) throw new Error(`duplicate widget ${widget.id}`);
  widgets.set(widget.id, Object.freeze(widget));
}

export function get(id) { return widgets.get(id); }

export function list(surface) {
  return [...widgets.values()].filter((widget) => !surface || widget.surfaces.includes(surface));
}

function failure(el, widget, ctx, error) {
  el.replaceChildren();
  const box = document.createElement("div");
  box.className = "w-fail";
  const message = document.createElement("p");
  message.textContent = `${widget?.title || el.dataset.widget || "Widget"} is unavailable.`;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => mount(widget?.id || el.dataset.widget, el, ctx));
  box.append(message, retry);
  el.append(box);
  console.error(widget?.id || el.dataset.widget, error);
}

export function mount(id, el, ctx = {}) {
  const widget = widgets.get(id);
  el.replaceChildren();
  el.dataset.widget = id;
  if (!widget) {
    failure(el, null, ctx, new Error(`missing widget ${id}`));
    return;
  }
  try {
    const result = widget.mount(el, ctx);
    if (result && typeof result.then === "function") result.catch((error) => failure(el, widget, ctx, error));
  } catch (error) {
    failure(el, widget, ctx, error);
  }
}

export function mountAll(surface, host, ctx = {}) {
  host.replaceChildren();
  for (const widget of list(surface)) {
    const card = document.createElement("section");
    card.className = "w-card";
    const heading = document.createElement("h3");
    heading.textContent = widget.title;
    const body = document.createElement("div");
    body.className = "w-body";
    card.append(heading, body);
    host.append(card);
    mount(widget.id, body, ctx);
  }
}
