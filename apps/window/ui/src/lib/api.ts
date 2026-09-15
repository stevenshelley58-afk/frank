// Authorized Frank read endpoints the shell renders from. Every payload here is
// a dated observation from a declared source (`owner_sources.py`,
// `owner_app_readiness.py`, `owner_customers.py`, `server.py`'s project and
// chat registries). The shell never invents a number: a source that is not
// connected renders its own unavailable state.
import * as React from "react"

export type SourceStatus = "ready" | "recorded" | "verified" | "empty" | "attention" | "error" | "unavailable" | "cached" | "stale"

export type SourceTarget =
  | { kind: "native-list"; app: string; path: string; label: string }
  | { kind: "native-record"; app: string; recordKind: string; recordId: string; label: string }
  | { kind: "owner-section"; section: string; label: string }
  | { kind: "owner-record"; customerId: string; label: string }

export type SourceItem = {
  id: string
  label: string
  detail: string
  attention: boolean
  count: number | null
  target: SourceTarget
  recordTarget?: SourceTarget
}

export type SourceMetric = { label: string; value: number | string | null; unit: string }

export type SourcePayload = {
  source: string
  status: SourceStatus
  summary: string
  detail?: string
  metrics: SourceMetric[]
  items: SourceItem[]
  dropped: number
  observed_at: number | null
  generated_at: number | null
  target: SourceTarget
}

export type SourcesResponse = {
  schema: string
  generated_at: number
  sources: Record<string, SourcePayload>
}

export type AppReadiness = {
  app: string
  label: string
  origin: string
  path: string
  ready: boolean
  frameable: boolean
  status: number | null
  reason: string
  ready_reason?: string
  detail: string
  certificate: string
  checked_at: number
}

export type ReadinessResponse = {
  schema: string
  checked_at: number
  apps: Record<string, AppReadiness>
}

export type CustomerPayload = SourcePayload & {
  identity?: string
  unavailable_sources?: string[]
}

/** One project from the Window's project registry (`GET /api/projects`). */
export type ProjectSummary = {
  id: string
  name: string
  blurb: string
  setup_state: string
  live: string
  capabilities: string[]
  default_widgets: string[]
  workspace: string
  memory_scope: string
  hermes_profile: string
}

export type ProjectsResponse = {
  schema: string
  projects: ProjectSummary[]
  archived_projects: ProjectSummary[]
}

/** One Hermes conversation, as the classic window lists it. */
export type ChatSession = {
  id: string
  title: string
  preview: string
  model: string
  source: string
  message_count: number
  created_at: number
  updated_at: number
}

export type ChatSessionsResponse = {
  sessions: ChatSession[]
  profile: string
}

export type Loaded<T> =
  | { state: "loading"; data: null; error: null; at: number | null }
  | { state: "ready"; data: T; error: null; at: number }
  | { state: "error"; data: T | null; error: string; at: number | null }

/** A loaded endpoint plus its manual refresh, so a parent can own one fetch. */
export type Endpoint<T> = Loaded<T> & { refresh: () => void }

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal })
  const type = response.headers.get("content-type") || ""
  if (!type.includes("application/json")) {
    // The owner gate answers an expired session with an HTML redirect target,
    // never JSON, so a non-JSON body means "sign in again", not "no data".
    throw new Error(response.status === 200 ? "Frank returned a page instead of data. Your owner session may have expired; reload to sign in again." : `Frank answered ${response.status}.`)
  }
  const body = (await response.json()) as T & { error?: string; detail?: string }
  if (!response.ok) throw new Error(body.error || body.detail || `Frank answered ${response.status}.`)
  return body
}

/**
 * Load one authorized endpoint and keep it fresh. Errors keep the last good
 * payload visible and dated rather than blanking the section.
 */
export function useEndpoint<T>(url: string | null, { refreshMs = 0 }: { refreshMs?: number } = {}): Endpoint<T> {
  const [value, setValue] = React.useState<Loaded<T>>({ state: "loading", data: null, error: null, at: null })
  const [tick, setTick] = React.useState(0)
  const refresh = React.useCallback(() => setTick((n) => n + 1), [])
  React.useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let cancelled = false
    readJson<T>(url, controller.signal)
      .then((data) => {
        if (!cancelled) setValue({ state: "ready", data, error: null, at: Date.now() })
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setValue((previous) => ({ state: "error", data: previous.data, error: error instanceof Error ? error.message : String(error), at: previous.at }))
      })
    const timer = refreshMs > 0 ? window.setInterval(refresh, refreshMs) : 0
    return () => {
      cancelled = true
      controller.abort()
      if (timer) window.clearInterval(timer)
    }
  }, [url, tick, refreshMs, refresh])
  return { ...value, refresh }
}

export const SOURCES_URL = "/api/owner/workspace/sources"
export const READINESS_URL = "/api/owner/workspace/readiness"
export const PROJECTS_URL = "/api/projects"
export const CHAT_SESSIONS_URL = "/api/chat/sessions"
export function customerUrl(customerId: string) {
  return `/api/owner/workspace/customers/${encodeURIComponent(customerId)}`
}

export function formatObserved(epochSeconds: number | null | undefined) {
  if (!epochSeconds) return "not observed yet"
  const date = new Date(epochSeconds * 1000)
  if (Number.isNaN(date.getTime())) return "not observed yet"
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })
}

/** A compact "when" for a list row: minutes, hours, days, or a date. */
export function formatSince(epochSeconds: number | null | undefined) {
  if (!epochSeconds) return ""
  const date = new Date(epochSeconds * 1000)
  if (Number.isNaN(date.getTime())) return ""
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}
