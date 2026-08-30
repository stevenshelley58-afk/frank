const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;"}[char]));

function mapLabel(row) {
  const label = row.title || String(row.projection_id || "").split(":").pop().replaceAll("/", " · ");
  return String(label).replace(/^Vps\b/, "VPS");
}

function projectionType(row) {
  const declared = row.type || row.manifest?.projection_type;
  if (declared === "workflow_data_flow") return "workflow + data flow";
  if (declared) return String(declared).replaceAll("_", " ");
  return String(row.projection_id || "").endsWith("/workflow") ? "workflow" : "architecture";
}

function mapSummary(row) {
  if (!row?.available) return "This projection does not have a current validated map.";
  const manifest = row.manifest && typeof row.manifest === "object" ? row.manifest : {};
  const nodeCount = manifest.stable_id_map && typeof manifest.stable_id_map === "object"
    ? Object.keys(manifest.stable_id_map).length
    : 0;
  const relationshipCount = Number.isInteger(manifest.relationship_count) ? manifest.relationship_count : null;
  const renderedRelationshipCount = Number.isInteger(manifest.rendered_relationship_count) ? manifest.rendered_relationship_count : null;
  const details = [];
  if (nodeCount) details.push(`${nodeCount} mapped ${nodeCount === 1 ? "record" : "records"}`);
  if (relationshipCount !== null) {
    details.push(renderedRelationshipCount !== null && renderedRelationshipCount !== relationshipCount
      ? `${renderedRelationshipCount} of ${relationshipCount} relationships shown`
      : `${relationshipCount} ${relationshipCount === 1 ? "relationship" : "relationships"}`);
  } else if (Array.isArray(manifest.exclusions) && manifest.exclusions.includes("relationships_render_in_control_graph")) {
    details.push("Relationships are listed in Control");
  }
  details.push(projectionType(row));
  const missing = Array.isArray(manifest.missing_coverage) ? manifest.missing_coverage : [];
  if (missing.length) details.push(`coverage gaps: ${missing.join(", ")}`);
  const findings = Array.isArray(manifest.findings) ? manifest.findings : [];
  const finding = findings.find((item) => item?.message);
  if (finding) details.push(String(finding.message));
  const freshness = String(manifest.freshness || row.freshness || "").trim();
  if (freshness) details.push(`${freshness[0].toUpperCase()}${freshness.slice(1)} validated evidence`);
  return details.length ? details.join(" · ") : "A validated projection of the canonical graph.";
}

export async function mountMap(root) {
  if (!root) return;
  root.innerHTML = `<div class="operate-surface map-surface"><header class="operate-heading"><div><span class="operate-kicker">Map · validated projections</span><h2 id="map-heading">Maps</h2><p id="map-summary">Choose a projection to inspect the canonical graph.</p></div><span class="truth-pill" id="map-state">Checking source…</span></header><div class="map-layout"><aside class="map-list" aria-label="Map projections"><div class="map-list-title">Projections</div><div id="map-projections"></div></aside><section class="map-viewer" id="map-viewer"><div class="operate-empty">Select a validated projection.</div></section></div></div>`;
  const state = root.querySelector("#map-state");
  const heading = root.querySelector("#map-heading");
  const summary = root.querySelector("#map-summary");
  const list = root.querySelector("#map-projections");
  const viewer = root.querySelector("#map-viewer");
  try {
    const response = await fetch("/api/control/projections", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Map is disabled");
    const rows = Array.isArray(data.projections) ? data.projections : [];
    const available = rows.filter((row) => row.available);
    state.textContent = available.length ? `${available.length} of ${rows.length} validated` : "No current projection";
    list.innerHTML = rows.length ? rows.map((row) => `<button type="button" class="map-row${row.available && available[0] === row ? " is-selected" : ""}" data-projection="${esc(row.projection_id)}"${row.available ? "" : " disabled"} title="${esc(row.available ? mapLabel(row) : "No current validated artifact")}"><span>${esc(mapLabel(row))}</span><small>${esc(row.available ? (row.manifest?.freshness || "current") : (row.declared_status || "unknown"))}</small></button>`).join("") : `<div class="map-list-empty">No projections are available.</div>`;
    const select = async (projectionId, button, row, { updateUrl = true } = {}) => {
      list.querySelectorAll(".map-row").forEach((item) => item.classList.toggle("is-selected", item === button));
      heading.textContent = mapLabel(row);
      summary.textContent = mapSummary(row);
      if (updateUrl) window.history.pushState({ view: "map", projectionId }, "", `/map?projection_id=${encodeURIComponent(projectionId)}`);
      viewer.innerHTML = `<iframe class="map-frame" title="${esc(mapLabel(row))} Archify projection" src="/api/control/maps/artifact?projection_id=${encodeURIComponent(projectionId)}"></iframe>`;
    };
    list.querySelectorAll(".map-row:not([disabled])").forEach((button) => button.addEventListener("click", () => select(button.dataset.projection, button, rows.find((row) => row.projection_id === button.dataset.projection))));
    const requested = new URLSearchParams(window.location.search).get("projection_id");
    const first = ([...list.querySelectorAll(".map-row:not([disabled])")].find((button) => button.dataset.projection === requested)) || list.querySelector(".map-row:not([disabled])");
    if (first) await select(first.dataset.projection, first, rows.find((row) => row.projection_id === first.dataset.projection), { updateUrl: !requested });
    else viewer.innerHTML = `<div class="operate-empty"><strong>The last validated map is not available.</strong><span>Generation failures preserve the prior passing map; this preview has no current pointer.</span></div>`;
  } catch {
    state.textContent = "Disabled by release flag";
    list.innerHTML = "";
    viewer.innerHTML = `<div class="operate-empty"><strong>Map is not promoted in this release.</strong><span>Enable <code>map_view</code> only in the isolated Step 5 preview.</span></div>`;
  }
}
