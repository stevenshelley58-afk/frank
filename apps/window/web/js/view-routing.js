const AD_STUDIO_PATH = "/ad-studio";
const BLOCKWISE_ORIGIN = "https://blockwise.sale";
const TEMPLATE_PATH = "/ad-studio/templates/";
const TEMPLATE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export function viewForPath(pathname) {
  return pathname === AD_STUDIO_PATH || pathname === `${AD_STUDIO_PATH}/` ? "ad-studio" : "hub";
}

export function pathForView(view) {
  return view === "ad-studio" ? AD_STUDIO_PATH : "/";
}

export function blockwiseTemplateUrl(value) {
  if (!value || typeof value !== "object") return "";
  const declaredId = String(value.template_id || "").trim();
  const candidateUrl = String(value.template_url || value.url || "").trim();
  let urlId = "";
  if (candidateUrl) {
    try {
      const parsed = new URL(candidateUrl);
      if (parsed.origin !== BLOCKWISE_ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.pathname.startsWith(TEMPLATE_PATH)) return "";
      urlId = decodeURIComponent(parsed.pathname.slice(TEMPLATE_PATH.length));
      if (urlId.includes("/") || !TEMPLATE_ID.test(urlId)) return "";
    } catch {
      return "";
    }
  }
  if (declaredId && !TEMPLATE_ID.test(declaredId)) return "";
  if (declaredId && urlId && declaredId !== urlId) return "";
  const templateId = declaredId || urlId;
  if (!templateId) return "";
  return `${BLOCKWISE_ORIGIN}${TEMPLATE_PATH}${encodeURIComponent(templateId)}`;
}
