// The declared owner sources, in the order the workspace lists them, and the
// one place that decides what "needs the owner" means. Overview and the hub
// both read this, so a count on a project card and the list under it cannot
// disagree, and a source that is not connected is never counted as zero.
import type { SourceItem, SourcePayload, SourcesResponse } from "@/lib/api"
import type { SectionId } from "@/lib/routes"

export const SOURCE_ORDER = ["mail", "crm", "support", "campaigns", "ads", "revenue", "results", "notifications"]

export const SOURCE_LABEL: Record<string, string> = {
  mail: "Mail",
  crm: "CRM",
  support: "Support",
  campaigns: "Email flows",
  ads: "Ads",
  revenue: "Revenue",
  results: "Results",
  notifications: "Notifications",
}

export const SOURCE_SECTION: Record<string, SectionId> = {
  mail: "mail",
  crm: "crm",
  support: "support",
  campaigns: "campaigns",
  ads: "ads",
  revenue: "revenue",
  results: "results",
  notifications: "notifications",
}

/** Statuses that mean the source answered, whatever it had to say. */
export const CONNECTED = new Set(["ready", "recorded", "verified", "attention", "empty", "cached", "stale"])

export const MAX_ATTENTION = 8

export const APP_ORDER = ["crm", "support", "mail", "campaigns"]

function allAttention(sources: Record<string, SourcePayload>): Array<SourceItem & { source: string }> {
  const rows: Array<SourceItem & { source: string }> = []
  for (const id of SOURCE_ORDER) {
    const payload = sources[id]
    if (!payload) continue
    for (const item of payload.items) {
      if (item.attention || payload.status === "attention") rows.push({ ...item, source: id })
    }
  }
  return rows
}

/** The items flagged as needing the owner, capped for the overview list. */
export function attentionItems(sources: Record<string, SourcePayload>) {
  return allAttention(sources).slice(0, MAX_ATTENTION)
}

/** How many sources answered, and how many items across them need the owner. */
export function sourceSummary(response: SourcesResponse | null) {
  const payloads = response?.sources || {}
  const ids = SOURCE_ORDER.filter((id) => payloads[id])
  return {
    ids,
    payloads,
    total: ids.length,
    connected: ids.filter((id) => CONNECTED.has(payloads[id].status)).length,
    attention: allAttention(payloads).length,
  }
}
