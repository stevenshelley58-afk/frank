const AD_STUDIO_PATH = "/ad-studio";
const OPS_PATH = "/ops";
const BLOCKWISE_ORIGIN = "https://blockwise.sale";
const TEMPLATE_PATH = "/ad-studio/templates/";
const TEMPLATE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const OPERATE_PATHS = { "/live": "live", "/map": "map", "/control": "control" };
const STATIC_PATHS = { "/tools": "tools", "/files": "files", "/connections": "connections", "/accounts": "accounts", "/trace": "trace", "/releases": "releases" };
const HOME_PATH = /^\/(project|entity)\/([^/]+)(?:\/([^/]+))?\/?$/;
const ENTITY_IDS = new Set([
  "tool:connections", "tool:accounts", "tool:widget-builder", "tool:campaigns", "tool:ad-templates",
  "tool:ad-template-generator", "agent:hermes", "service:umami", "service:activepieces", "service:frank-window",
]);

function validId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value || ""));
}

export function routeForPath(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === AD_STUDIO_PATH) return { view: "ad-studio" };
  if (path === OPS_PATH) return { view: "ops" };
  if (OPERATE_PATHS[path]) return { view: OPERATE_PATHS[path] };
  if (STATIC_PATHS[path]) return { view: STATIC_PATHS[path] };
  const match = path.match(HOME_PATH);
  if (match?.[1] === "project" && validId(match[2]) && !match[3]) return { view: "project", projectId: decodeURIComponent(match[2]) };
  if (match?.[1] === "entity" && validId(match[2]) && validId(match[3])) {
    const kind = decodeURIComponent(match[2]);
    const id = decodeURIComponent(match[3]);
    if (ENTITY_IDS.has(`${kind}:${id}`)) return { view: "entity-home", entity: { kind, id } };
    return { view: "hub", invalid: true, message: `No registered ${kind} home exists for “${id}”.` };
  }
  if (path.startsWith("/project/") || path.startsWith("/entity/")) return { view: "hub", invalid: true, message: "That Frank home address is not valid." };
  return { view: "hub" };
}

export function viewForPath(pathname) {
  return routeForPath(pathname).view;
}

export function pathForView(view, detail = {}) {
  if (view === "ad-studio") return AD_STUDIO_PATH;
  if (view === "ops") return OPS_PATH;
  if (view === "live" || view === "map" || view === "control") return `/${view}`;
  if (Object.values(STATIC_PATHS).includes(view)) return `/${view}`;
  if (view === "project" && validId(detail.projectId)) return `/project/${encodeURIComponent(detail.projectId)}`;
  if (view === "entity-home" && validId(detail.entity?.kind) && validId(detail.entity?.id)) return `/entity/${encodeURIComponent(detail.entity.kind)}/${encodeURIComponent(detail.entity.id)}`;
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
