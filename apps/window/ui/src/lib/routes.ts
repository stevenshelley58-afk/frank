// Owner shell routes. The URL grammar is the vanilla Window's `view-routing.js`
// (the same allowlisted sections and opaque customer segment), so every deep
// link that existed before keeps working and the server's owner-route split
// (`owner_shell.py`) agrees with the browser about which paths belong here.
import * as React from "react"
import { ownerPathForCustomer, ownerPathForSection, routeForPath } from "@legacy/view-routing.js"

export type SectionId =
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
  // root document as `/?area=<id>` and link out to the destinations they group.
  | "customers"
  | "content"
  | "tools"
  | "settings"

export type ShellRoute = {
  section: SectionId
  customerId: string
  /** A native application path requested by a drill-down, validated by the host. */
  appPath: string
  invalid?: string
}

const NATIVE_SECTIONS = new Set<SectionId>(["crm", "support", "mail", "campaigns"])
const SOURCE_SECTIONS = new Set<SectionId>(["revenue", "results", "notifications"])
const AREA_SECTIONS = new Set<SectionId>(["customers", "content", "tools", "settings"])

export function isNativeSection(section: SectionId) {
  return NATIVE_SECTIONS.has(section)
}
export function isSourceSection(section: SectionId) {
  return SOURCE_SECTIONS.has(section)
}

export function routeFromLocation(pathname = location.pathname, search = location.search): ShellRoute {
  const parsed = routeForPath(pathname)
  const query = new URLSearchParams(search)
  const appPath = query.get("app_path") || ""
  if (parsed.view !== "project" || parsed.projectId !== "blockwise") {
    if (pathname.replace(/\/+$/, "") === "") {
      const area = query.get("area") || ""
      if (AREA_SECTIONS.has(area as SectionId)) return { section: area as SectionId, customerId: "", appPath: "" }
      return { section: "overview", customerId: "", appPath }
    }
    return { section: "overview", customerId: "", appPath, invalid: parsed.message || "That Frank address is not an owner workspace route." }
  }
  if (parsed.ownerCustomerId) return { section: "customer", customerId: parsed.ownerCustomerId, appPath }
  const section = (parsed.ownerSection || "overview") as SectionId
  return { section, customerId: "", appPath }
}

export function hrefFor(section: SectionId, customerId = ""): string {
  if (section === "overview") return "/"
  if (AREA_SECTIONS.has(section)) return `/?area=${section}`
  if (section === "customer") return ownerPathForCustomer(customerId)
  return ownerPathForSection(section)
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
  const navigate = React.useCallback((section: SectionId, options: { customerId?: string; appPath?: string; replace?: boolean } = {}) => {
    // An identifier the route grammar rejects has no address; land on the
    // overview rather than showing a customer pane the address bar disowns.
    if (section === "customer" && hrefFor("customer", options.customerId || "") === ownerPathForSection("")) section = "overview"
    const href = hrefFor(section, options.customerId || "")
    const query = options.appPath ? `${href.includes("?") ? "&" : "?"}app_path=${encodeURIComponent(options.appPath)}` : ""
    const target = `${href}${query}`
    const current = `${location.pathname}${location.search}`
    if (target !== current) {
      if (options.replace) history.replaceState({ section }, "", target)
      else history.pushState({ section }, "", target)
    }
    setRoute({ section, customerId: options.customerId || "", appPath: options.appPath || "" })
  }, [])
  return { route, navigate }
}
