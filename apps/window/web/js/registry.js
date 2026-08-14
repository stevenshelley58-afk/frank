const widgets = new Map();

export function define(manifest) {
  if (!manifest?.id || typeof manifest.mount !== "function") throw new Error("widget needs id + mount");
  widgets.set(manifest.id, manifest);
}
export function get(id) { return widgets.get(id); }
export function list(surface) {
  return [...widgets.values()].filter((w) => !surface || w.surfaces.includes(surface));
}
export function mount(id, el, ctx) {
  const w = widgets.get(id);
  el.innerHTML = "";
  el.dataset.widget = id;
  if (!w) { el.innerHTML = `<div class="w-fail"><p>Missing ${id}</p></div>`; return; }
  try { w.mount(el, ctx || {}); }
  catch (err) {
    el.innerHTML = `<div class="w-fail"><p>${w.title || id} failed.</p><button type="button" data-retry="${id}">Retry</button></div>`;
    el.querySelector("[data-retry]")?.addEventListener("click", () => mount(id, el, ctx));
    console.error(id, err);
  }
}
export function mountAll(surface, host, ctx) {
  host.innerHTML = "";
  for (const w of list(surface)) {
    const card = document.createElement("section");
    card.className = "w-card";
    const h = document.createElement("h3");
    h.textContent = w.title;
    const body = document.createElement("div");
    body.className = "w-body";
    card.append(h, body);
    host.append(card);
    mount(w.id, body, ctx);
  }
}
