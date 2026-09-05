const AD_STUDIO_PATH = "/ad-studio";
const AD_RADAR_PATH = "/ad-radar";
const BLOCKWISE_ORIGIN = "https://blockwise.sale";
const TEMPLATE_PATH = "/ad-studio/templates/";
const TEMPLATE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const OPERATE_PATHS = { "/live": "live", "/map": "map", "/control": "control" };

export function viewForPath(pathname) {
  if (pathname === AD_STUDIO_PATH || pathname === `${AD_STUDIO_PATH}/`) return "ad-studio";
  if (pathname === AD_RADAR_PATH || pathname === `${AD_RADAR_PATH}/`) return "ad-radar";
  return OPERATE_PATHS[pathname.replace(/\/$/, "")] || "hub";
}

export function pathForView(view) {
  if (view === "ad-studio") return AD_STUDIO_PATH;
  if (view === "ad-radar") return AD_RADAR_PATH;
  if (view === "live" || view === "map" || view === "control") return `/${view}`;
  return "/";
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
