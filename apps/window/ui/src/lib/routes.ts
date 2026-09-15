// Owner shell routes. The URL grammar is the vanilla Window's `view-routing.js`
// (the same allowlisted sections and opaque identifiers), so every deep link
// that existed before keeps working and the server's owner-route split
// (`owner_shell.py`) agrees with the browser about which paths belong here.
//
// Frank is the hub for every project, so the shell owns two address shapes: the
// hub at "/", and a project home at "/project/<id>". Blockwise additionally
// owns its built sections, which are nested under its project home. Everything
// under "/project/blockwise/..." keeps the URL it already had; only the root
// moved, because the root is now the hub rather than the Blockwise workspace.
import * as React from "react"
import { ownerPathForCustomer, ownerPathForSection, routeForPath } from "@legacy/view-routing.js"

export type SectionId =
  // The hub: every project Frank runs, and the Hermes chats.
  | "hub"
  // A project home for a project that has no built sections of its own yet.
  | "project"
  | "overview"
  | "ads"
  | "crm"
  | "support"
  | "mail"
  | "campaigns"
  | "revenue"
  | "results"
  | "notifications"
  | "customer"
  // Shell-only areas. They have no server route of their own: they live on the
  // root document as `/?area=<id>`, which is the address they have always had.
  | "customers"
  | "content"
  | "tools"
  | "settings"

export type ShellRoute = {
  section: SectionId
  /** The project the address names. Empty on the hub and on shell-only areas. */
  projectId: string
  customerId: string
  /** A native application path requested by a drill-down, validated by the host. */
  appPath: string
  invalid?: string
}

export const OWNER_PROJECT_ID = "blockwise"

const NATIVE_SECTIONS = new Set<SectionId>(["crm", "support", "mail", "campaigns"])
const SOURCE_SECTIONS = new Set<SectionId>(["revenue", "results", "notifications"])
const AREA_SECTIONS = new Set<SectionId>(["customers", "content", "tools", "settings"])

/** The Blockwise workspace home. Any identifier that is not a section resolves here. */
const OWNER_HOME = ownerPathForSection("")

export function isNativeSection(section: SectionId) {
  return NATIVE_SECTIONS.has(section)
}
export function isSourceSection(section: SectionId) {
  return SOURCE_SECTIONS.has(section)
}
export function isAreaSection(section: SectionId) {
  return AREA_SECTIONS.has(section)
}

export function routeFromLocation(pathname = location.pathname, search = location.search): ShellRoute {
  const parsed = routeForPath(pathname)
  const query = new URLSearchParams(search)
  const appPath = query.get("app_path") || ""
  const base = { projectId: "", customerId: "", appPath }
  if (parsed.view !== "project") {
    if (pathname.replace(/\/+$/, "") === "") {
      // The root is the hub. The shell-only areas keep the address they have
      // always had, which is the root plus `?area=`.
      const area = query.get("area") || ""
      if (AREA_SECTIONS.has(area as SectionId)) return { ...base, section: area as SectionId }
      return { ...base, section: "hub" }
    }
    return { ...base, section: "hub", invalid: parsed.message || "That Frank address is not an owner workspace route." }
  }
  const projectId = parsed.projectId || ""
  if (projectId !== OWNER_PROJECT_ID) return { ...base, section: "project", projectId }
  if (parsed.ownerCustomerId) return { ...base, section: "customer", projectId, customerId: parsed.ownerCustomerId }
  return { ...base, section: (parsed.ownerSection || "overview") as SectionId, projectId }
}

export function hrefFor(section: SectionId, options: { customerId?: string; projectId?: string } = {}): string {
  if (section === "hub") return "/"
  if (section === "project") return `/project/${encodeURIComponent(options.projectId || "")}`
  if (section === "overview") return OWNER_HOME
  if (AREA_SECTIONS.has(section)) return `/?area=${section}`
  if (section === "customer") return ownerPathForCustomer(options.customerId || "")
  return ownerPathForSection(section)
}

/** The classic project home for a project, which is where everything else lives. */
export function technicalHrefFor(projectId: string): string {
  return `/project/${encodeURIComponent(projectId)}?technical=1`
}

export type NavigateOptions = {
  customerId?: string
  projectId?: string
  appPath?: string
  replace?: boolean
}

/**
 * Route state bound to the browser history. `navigate` pushes a new entry;
 * Back and Forward re-read the location. A native drill-down path travels in
 * `app_path` so a refresh reopens the same native screen.
 */
export function useShellRoute() {
  const [route, setRoute] = React.useState<ShellRoute>(() => routeFromLocation())
  React.useEffect(() => {
    const onPop = () => setRoute(routeFromLocation())
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const navigate = React.useCallback((section: SectionId, options: NavigateOptions = {}) => {
    // An identifier the route grammar rejects has no address; land on the
    // overview rather than showing a customer pane the address bar disowns.
    if (section === "customer" && hrefFor("customer", { customerId: options.customerId }) === OWNER_HOME) section = "overview"
    const href = hrefFor(section, { customerId: options.customerId, projectId: options.projectId })
    const query = options.appPath ? `${href.includes("?") ? "&" : "?"}app_path=${encodeURIComponent(options.appPath)}` : ""
    const target = `${href}${query}`
    const current = `${location.pathname}${location.search}`
    if (target !== current) {
      if (options.replace) history.replaceState({ section }, "", target)
      else history.pushState({ section }, "", target)
    }
    setRoute({
      section,
      projectId: options.projectId || (section === "hub" || section === "project" ? "" : OWNER_PROJECT_ID),
      customerId: options.customerId || "",
      appPath: options.appPath || "",
    })
  }, [])
  return { route, navigate }
}
