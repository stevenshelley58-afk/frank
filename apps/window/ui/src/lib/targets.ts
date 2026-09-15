// Typed drill-down targets and the status vocabulary shared by every source
// renderer. Kept outside the component files so fast refresh stays intact.
import { nativeRecordPath } from "@legacy/owner-app-host.js"
import type { SourceStatus, SourceTarget } from "@/lib/api"
import type { SectionId } from "@/lib/routes"

export type Navigate = (section: SectionId, options?: { customerId?: string; appPath?: string; replace?: boolean }) => void
const NATIVE_SECTION: Record<string, SectionId> = { mail: "mail", crm: "crm", support: "support", campaigns: "campaigns" }
const OWNER_SECTION = new Set<SectionId>(["overview", "ads", "crm", "support", "mail", "campaigns", "revenue", "results", "notifications"])

/** Follow a typed target from a source payload. Returns false when the target is not one the shell can open. */
export function openTarget(target: SourceTarget | undefined, navigate: Navigate): boolean {
  if (!target) return false
  if (target.kind === "native-list") {
    const section = NATIVE_SECTION[target.app]
    if (!section) return false
    navigate(section, { appPath: target.path })
    return true
  }
  if (target.kind === "native-record") {
    const section = NATIVE_SECTION[target.app]
    const path = nativeRecordPath(target.app, target.recordKind, target.recordId)
    if (!section || !path) return false
    navigate(section, { appPath: path })
    return true
  }
  if (target.kind === "owner-section") {
    const section = target.section as SectionId
    if (!OWNER_SECTION.has(section)) return false
    navigate(section)
    return true
  }
  if (target.kind === "owner-record") {
    navigate("customer", { customerId: target.customerId })
    return true
  }
  return false
}

export function statusWord(status: SourceStatus | string): string {
  switch (status) {
    case "ready":
    case "recorded":
    case "verified":
      return "Ready"
    case "attention":
      return "Needs attention"
    case "empty":
      return "Nothing waiting"
    case "cached":
    case "stale":
      return "Cached"
    case "error":
      return "Error"
    default:
      return "Not connected"
  }
}

