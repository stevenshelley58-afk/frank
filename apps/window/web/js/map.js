const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;"}[char]));

function mapLabel(row) { return row.title || String(row.projection_id || "").split(":").pop().replaceAll("/", " · "); }

export async function mountMap(root) {
  if (!root) return;
  root.innerHTML = `<div class="operate-surface map-surface"><header class="operate-heading"><div><span class="operate-kicker">Map · validated projections</span><h2>VPS World</h2><p>One canonical graph, rendered by the pinned Archify viewer.</p></div><span class="truth-pill" id="map-state">Checking source…</span></header><div class="map-layout"><aside class="map-list" aria-label="Map projections"><div class="map-list-title">Projections</div><div id="map-projections"></div></aside><section class="map-viewer" id="map-viewer"><div class="operate-empty">Select a validated projection.</div></section></div></div>`;
  const state = root.querySelector("#map-state");
  const list = root.querySelector("#map-projections");
  const viewer = root.querySelector("#map-viewer");
  try {
    const response = await fetch("/api/control/projections", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Map is disabled");
    const rows = Array.isArray(data.projections) ? data.projections : [];
    state.textContent = rows.some((row) => row.available) ? "Validated source" : "No current projection";
    list.innerHTML = rows.length ? rows.map((row, index) => `<button type="button" class="map-row${index === 0 ? " is-selected" : ""}" data-projection="${esc(row.projection_id)}"><span>${esc(mapLabel(row))}</span><small>${esc(row.available ? (row.manifest?.freshness || "current") : (row.declared_status || "unknown"))}</small></button>`).join("") : `<div class="map-list-empty">No projections are available.</div>`;
    const select = async (projectionId, button, { updateUrl = true } = {}) => {
      list.querySelectorAll(".map-row").forEach((item) => item.classList.toggle("is-selected", item === button));
      if (updateUrl) window.history.pushState({ view: "map", projectionId }, "", `/map?projection_id=${encodeURIComponent(projectionId)}`);
      viewer.innerHTML = `<iframe class="map-frame" title="${esc(projectionId)} Archify projection" src="/api/control/maps/artifact?projection_id=${encodeURIComponent(projectionId)}"></iframe>`;
    };
    list.querySelectorAll(".map-row").forEach((button) => button.addEventListener("click", () => select(button.dataset.projection, button)));
    const requested = new URLSearchParams(window.location.search).get("projection_id");
    const first = ([...list.querySelectorAll(".map-row")].find((button) => button.dataset.projection === requested)) || list.querySelector(".map-row");
    if (first && rows.find((row) => row.projection_id === first.dataset.projection)?.available) await select(first.dataset.projection, first, { updateUrl: !requested });
    else viewer.innerHTML = `<div class="operate-empty"><strong>The last validated map is not available.</strong><span>Generation failures preserve the prior passing map; this preview has no current pointer.</span></div>`;
  } catch {
    state.textContent = "Disabled by release flag";
    list.innerHTML = "";
    viewer.innerHTML = `<div class="operate-empty"><strong>Map is not promoted in this release.</strong><span>Enable <code>map_view</code> only in the isolated Step 5 preview.</span></div>`;
  }
}
