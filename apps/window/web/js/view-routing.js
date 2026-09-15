const AD_TEMPLATE_GENERATOR_PATH = "/ad-template-generator";
const LEGACY_AD_STUDIO_PATH = "/ad-studio";
const BLOG_STUDIO_PATH = "/blog-studio";
const AD_RADAR_PATH = "/ad-radar";
const AD_DB_PATH = "/ad-db";
const OPS_PATH = "/ops";
// The owner shell holds "/", so the vanilla hub has its own address. Unknown
// paths still resolve to the hub view, and this is the address they canonicalise
// to rather than the shell's front door.
const HUB_PATH = "/hub";
const BLOCKWISE_ORIGIN = "https://blockwise.sale";
const TEMPLATE_PATH = "/ad-studio/templates/";
const TEMPLATE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const OPERATE_PATHS = { "/live": "live", "/map": "map", "/control": "control" };
const STATIC_PATHS = { "/hub": "hub", "/tools": "tools", "/files": "files", "/connections": "connections", "/accounts": "accounts", "/trace": "trace", "/releases": "releases" };
const HOME_PATH = /^\/(project|entity)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/;
const ENTITY_IDS = new Set([
  "tool:connections", "tool:accounts", "tool:mail", "tool:widget-builder", "tool:campaigns", "tool:ad-templates",
  "tool:ad-template-generator", "agent:hermes", "service:umami", "service:activepieces", "service:frank-window",
]);

// Frank is the hub for every project the owner runs, so the shell is the front
// door for the root and for every project home. Blockwise additionally carries
// its built sections, which are nested under its project home so the existing
// project, rail and technical-view contracts stay intact. Each section is a
// fixed allowlisted identifier: a section is never an arbitrary user string,
// and the only other variable segment is an opaque customer identifier.
const OWNER_PROJECT_ID = "blockwise";
export const OWNER_SECTIONS = Object.freeze([
  "mail", "crm", "support", "campaigns", "ads", "revenue", "results", "notifications",
]);
export const OWNER_CUSTOMER_SEGMENT = "customer";
const OWNER_SECTION_IDS = new Set(OWNER_SECTIONS);

function validId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(String(value || ""));
}

/**
 * Does the owner shell answer this project's home address?
 *
 * The shell owns "/" and "/project/<id>" for every identifier the grammar
 * accepts, because it is the hub for every project rather than a workspace for
 * one of them. `?technical=1` is the one escape: it keeps the classic project
 * home, which shares the address, on the vanilla Window. The server's
 * `owner_shell.py` reads the same flag, so the two sides agree.
 */
export function isOwnerShellProject(projectId, search = "") {
  return validId(projectId) && new URLSearchParams(search).get("technical") !== "1";
}

function ownerRoute(segment) {
  if (segment === undefined) return { view: "project", projectId: OWNER_PROJECT_ID };
  if (OWNER_SECTION_IDS.has(segment)) {
    return { view: "project", projectId: OWNER_PROJECT_ID, ownerSection: segment };
  }
  return null;
}

export function ownerPathForSection(section) {
  if (!OWNER_SECTION_IDS.has(section)) return `/project/${OWNER_PROJECT_ID}`;
  return `/project/${OWNER_PROJECT_ID}/${section}`;
}

export function ownerPathForCustomer(customerId) {
  if (!validId(customerId)) return `/project/${OWNER_PROJECT_ID}`;
  return `/project/${OWNER_PROJECT_ID}/${OWNER_CUSTOMER_SEGMENT}/${encodeURIComponent(customerId)}`;
}

export function routeForPath(pathname) {
  // A caller may hand us a full relative URL. Parsing the path alone keeps
  // query parameters such as `?technical=1` from becoming part of an identifier,
  // which previously turned a valid home into an invalid one.
  const raw = String(pathname ?? "");
  const queryIndex = raw.search(/[?#]/);
  const pathOnly = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const path = pathOnly.replace(/\/+$/, "") || "/";
  if (path === AD_TEMPLATE_GENERATOR_PATH || path === LEGACY_AD_STUDIO_PATH) return { view: "ad-template-generator" };
  if (path === BLOG_STUDIO_PATH) return { view: "blog-studio" };
  if (path === AD_RADAR_PATH) return { view: "ad-radar" };
  if (path === AD_DB_PATH) return { view: "ad-db" };
  if (path === OPS_PATH) return { view: "ops" };
  if (OPERATE_PATHS[path]) return { view: OPERATE_PATHS[path] };
  if (STATIC_PATHS[path]) return { view: STATIC_PATHS[path] };
  const match = path.match(HOME_PATH);
  if (match?.[1] === "project" && validId(match[2]) && !match[3]) return { view: "project", projectId: decodeURIComponent(match[2]) };
  if (match?.[1] === "project" && validId(match[2]) && match[3]) {
    const projectId = decodeURIComponent(match[2]);
    const segment = decodeURIComponent(match[3]);
    if (projectId !== OWNER_PROJECT_ID) return { view: "hub", invalid: true, message: "That Frank home address is not valid." };
    const base = ownerRoute(segment);
    if (!base) {
      // Decode before validating: a percent-encoded identifier is only
      // acceptable when what it decodes to is itself a valid identifier, so
      // encoded separators such as %2F can never widen the route.
      let customerId = "";
      try {
        customerId = decodeURIComponent(match[4] ?? "");
      } catch {
        customerId = "";
      }
      if (segment === OWNER_CUSTOMER_SEGMENT && match[4] !== undefined && validId(customerId)) {
        return { view: "project", projectId, ownerCustomerId: customerId };
      }
      return { view: "hub", invalid: true, message: `No owner workspace section is registered for “${segment}”.` };
    }
    // A customer deep link is exactly two segments; a trailing segment is invalid
    // rather than silently ignored, so a mistyped shareable link fails loudly.
    if (match[4] !== undefined) return { view: "hub", invalid: true, message: "That Frank home address is not valid." };
    return base;
  }
  if (match?.[1] === "entity" && validId(match[2]) && validId(match[3]) && match[4] === undefined) {
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
  if (view === "ad-template-generator") return AD_TEMPLATE_GENERATOR_PATH;
  if (view === "ad-db") return AD_DB_PATH;
  if (view === "ops") return OPS_PATH;
  if (view === "blockwise-dashboard") return ownerPathForSection(detail.ownerSection);
  if (view === "blog-studio") return BLOG_STUDIO_PATH;
  if (view === "ad-radar") return AD_RADAR_PATH;
  if (view === "live" || view === "map" || view === "control") return `/${view}`;
  if (Object.values(STATIC_PATHS).includes(view)) return `/${view}`;
  if (view === "project" && detail.projectId === OWNER_PROJECT_ID && validId(detail.ownerCustomerId)) {
    return ownerPathForCustomer(detail.ownerCustomerId);
  }
  if (view === "project" && detail.projectId === OWNER_PROJECT_ID && detail.ownerSection !== undefined) {
    return ownerPathForSection(detail.ownerSection);
  }
  if (view === "project" && validId(detail.projectId)) return `/project/${encodeURIComponent(detail.projectId)}`;
  if (view === "entity-home" && validId(detail.entity?.kind) && validId(detail.entity?.id)) return `/entity/${encodeURIComponent(detail.entity.kind)}/${encodeURIComponent(detail.entity.id)}`;
  return HUB_PATH;
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
