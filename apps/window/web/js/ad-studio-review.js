const clean = (value) => String(value ?? "").trim();

function artifactWords(artifact) {
  return [artifact?.kind, artifact?.view, artifact?.label, artifact?.placement, artifact?.name]
    .map((value) => clean(value).toLowerCase().replaceAll("_", "-"))
    .join(" ");
}

function placementMatches(artifact, placement) {
  const words = artifactWords(artifact);
  const wanted = clean(placement).toLowerCase();
  if (!wanted) return true;
  if (words.includes(wanted)) return true;
  return !words.includes("feed") && !words.includes("story");
}

function asArtifacts(value) {
  if (Array.isArray(value)) return value.filter((item) => item?.url);
  return value?.url ? [value] : [];
}

export function reviewArtifactPurpose(artifact) {
  const words = artifactWords(artifact);
  if (/(source-filled|source filled|fidelity|qa-render|qa render)/.test(words)) return "qa-source-filled";
  if (/(customer-default|customer default|reusable|neutral-final|neutral final)/.test(words)) return "customer-default";
  return "recorded";
}

export function selectReusableReviewArtifact(summary, placement) {
  return asArtifacts(summary?.previews)
    .filter((artifact) => placementMatches(artifact, placement))
    .find((artifact) => reviewArtifactPurpose(artifact) === "customer-default") || null;
}

export function selectReviewArtifact(summary, placement, view) {
  const review = summary && typeof summary === "object" ? summary : {};
  const wantedView = clean(view).toLowerCase();
  if (wantedView === "source") return review.source?.url ? review.source : null;
  const groups = wantedView === "template"
    ? asArtifacts(review.previews)
    : [...asArtifacts(review.diffs), ...asArtifacts(review.previews)];
  const viewWords = wantedView === "difference" ? ["difference", "diff", "heatmap"] : ["overlay"];
  const candidates = groups.filter((artifact) => placementMatches(artifact, placement));
  if (wantedView === "template") {
    const templates = candidates.filter((artifact) => !/(overlay|difference|diff|heatmap|meta)/.test(artifactWords(artifact)));
    return templates.find((artifact) => reviewArtifactPurpose(artifact) === "qa-source-filled") || templates[0] || null;
  }
  return candidates.find((artifact) => viewWords.some((word) => artifactWords(artifact).includes(word))) || null;
}

export function selectMetaPreview(summary, placement) {
  const candidates = [...asArtifacts(summary?.previews), ...asArtifacts(summary?.references)];
  return candidates.find((artifact) => placementMatches(artifact, placement) && artifactWords(artifact).includes("meta")) || null;
}

export function reviewOverallScore(summary) {
  const scores = summary?.scores && typeof summary.scores === "object" ? summary.scores : {};
  for (const key of ["overall", "likeness", "final", "score"]) {
    const value = Number(scores[key]);
    if (Number.isFinite(value)) return value;
  }
  const values = Object.entries(scores)
    .filter(([key, value]) => key !== "reviewers" && Number.isFinite(Number(value)))
    .map(([, value]) => Number(value));
  return values.length ? Math.min(...values) : null;
}

export function placementScore(summary, placement) {
  const scores = summary?.scores && typeof summary.scores === "object" ? summary.scores : {};
  const wanted = clean(placement).toLowerCase();
  for (const key of [`${wanted}_likeness`, `${wanted}_score`, wanted]) {
    const value = Number(scores[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function reviewModelProfile(run) {
  const fromSummary = run?.output?.review_summary?.model_profile;
  return fromSummary && typeof fromSummary === "object" ? fromSummary : (run?.model_profile || {});
}
