const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;"}[char]));

export async function mountLive(root) {
  if (!root) return;
  root.innerHTML = `<div class="operate-surface live-surface"><header class="operate-heading"><div><span class="operate-kicker">Live · upstream authority</span><h2>AgentTrail</h2><p>Observe plans, files, and current work from the pinned VPS board.</p></div><span class="truth-pill" id="live-state">Checking source…</span></header><div class="live-frame-wrap" id="live-frame-wrap"><div class="operate-empty">Loading the verified AgentTrail board…</div></div></div>`;
  const state = root.querySelector("#live-state");
  const frame = root.querySelector("#live-frame-wrap");
  try {
    const response = await fetch("/api/control/overview", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok || !data.live?.enabled) {
      state.textContent = "Disabled by release flag";
      frame.innerHTML = `<div class="operate-empty"><strong>Live is not promoted in this release.</strong><span>Enable <code>live_view</code> only after the isolated Step 5 preview gate passes.</span></div>`;
      return;
    }
    state.textContent = "Pinned · read only";
    frame.innerHTML = `<iframe class="live-frame" src="${escapeHtml(data.live.board_url || "/agenttrail/")}" title="Live AgentTrail board"></iframe>`;
  } catch {
    state.textContent = "Unavailable";
    frame.innerHTML = `<div class="operate-empty"><strong>AgentTrail is unavailable.</strong><span>Live activity is never inferred from runtime health.</span></div>`;
  }
}
