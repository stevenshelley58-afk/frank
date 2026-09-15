// The combined overview: what needs the owner now, one card per declared
// source, and the state of each native application. Everything on this
// screen is read from `/api/owner/workspace/sources` and
// `/api/owner/workspace/readiness`; a source that is not connected says so.
import * as React from "react"
import { ArrowUpRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatObserved, READINESS_URL, SOURCES_URL, useEndpoint, type ReadinessResponse, type SourceItem, type SourcePayload, type SourcesResponse } from "@/lib/api"
import type { SectionId } from "@/lib/routes"
import { ItemRow, MetricList, StatusBadge, Unavailable } from "@/components/sources/source-ui"
import { openTarget, statusWord, type Navigate } from "@/lib/targets"

const SOURCE_ORDER = ["mail", "crm", "support", "campaigns", "ads", "revenue", "results", "notifications"]
const SOURCE_LABEL: Record<string, string> = {
  mail: "Mail",
  crm: "CRM",
  support: "Support",
  campaigns: "Email flows",
  ads: "Ads",
  revenue: "Revenue",
  results: "Results",
  notifications: "Notifications",
}
const SOURCE_SECTION: Record<string, SectionId> = {
  mail: "mail",
  crm: "crm",
  support: "support",
  campaigns: "campaigns",
  ads: "ads",
  revenue: "revenue",
  results: "results",
  notifications: "notifications",
}
const CONNECTED = new Set(["ready", "recorded", "verified", "attention", "empty", "cached", "stale"])
const APP_ORDER = ["crm", "support", "mail", "campaigns"]
const MAX_ATTENTION = 8

function hostOf(origin: string) {
  try {
    return new URL(origin).host
  } catch {
    return origin || "unknown host"
  }
}

function attentionItems(sources: Record<string, SourcePayload>): Array<SourceItem & { source: string }> {
  const rows: Array<SourceItem & { source: string }> = []
  for (const id of SOURCE_ORDER) {
    const payload = sources[id]
    if (!payload) continue
    for (const item of payload.items) {
      if (item.attention || payload.status === "attention") rows.push({ ...item, source: id })
    }
  }
  return rows.slice(0, MAX_ATTENTION)
}

export function Overview({ navigate }: { navigate: Navigate }) {
  const sources = useEndpoint<SourcesResponse>(SOURCES_URL, { refreshMs: 60000 })
  const readiness = useEndpoint<ReadinessResponse>(READINESS_URL, { refreshMs: 120000 })
  const payloads = React.useMemo(() => sources.data?.sources || {}, [sources.data])
  const ids = SOURCE_ORDER.filter((id) => payloads[id])
  const connected = ids.filter((id) => CONNECTED.has(payloads[id].status)).length
  const attention = React.useMemo(() => attentionItems(payloads), [payloads])
  const checked = sources.at ? new Date(sources.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Blockwise</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {sources.state === "loading" && !sources.data
              ? "Checking your sources."
              : `${connected} of ${ids.length} sources connected${checked ? ` · checked ${checked}` : ""}`}
            {sources.error ? ` · ${sources.error}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl"
          onClick={() => {
            sources.refresh()
            readiness.refresh()
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0" aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="mb-3 text-lg font-semibold">
            Needs attention
          </h2>
          {sources.state === "loading" && !sources.data ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : attention.length ? (
            <ul className="divide-y rounded-2xl border px-4">
              {attention.map((item) => (
                <ItemRow key={`${item.source}:${item.id}`} item={item} navigate={navigate} />
              ))}
            </ul>
          ) : (
            <Unavailable title="Nothing is waiting on you" detail="Every connected source reports no item that needs an owner right now. Sources that are not connected are listed below." />
          )}

          <h2 className="mt-10 mb-3 text-lg font-semibold">Sources</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {ids.length === 0 && sources.state !== "loading" ? (
              <Unavailable title="Frank could not read its sources" detail={sources.error || "No source payload was returned."} />
            ) : null}
            {ids.map((id) => {
              const payload = payloads[id]
              const section = SOURCE_SECTION[id]
              return (
                <Card key={id} className="rounded-2xl">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle className="text-base">{SOURCE_LABEL[id] || id}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">Observed {formatObserved(payload.observed_at)}</p>
                    </div>
                    <StatusBadge status={payload.status} />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {payload.metrics.length ? <MetricList metrics={payload.metrics} /> : null}
                    <p className="text-sm text-muted-foreground">
                      {payload.summary || payload.detail || (statusWord(payload.status) === "Not connected" ? "No adapter is attached to this source yet." : "")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {section ? (
                        <Button variant="secondary" size="sm" className="h-11 gap-1 lg:h-9" onClick={() => navigate(section)}>
                          Open {SOURCE_LABEL[id]}
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {payload.target && payload.target.kind !== "owner-section" ? (
                        <Button variant="ghost" size="sm" className="h-11 text-muted-foreground lg:h-9" onClick={() => openTarget(payload.target, navigate)}>
                          {payload.target.label}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <aside className="min-w-0" aria-labelledby="apps-heading">
          <h2 id="apps-heading" className="mb-3 text-lg font-semibold">
            Applications
          </h2>
          <ul className="divide-y rounded-2xl border">
            {APP_ORDER.map((id) => {
              const app = readiness.data?.apps?.[id]
              const section = SOURCE_SECTION[id]
              const word = !app ? (readiness.state === "loading" ? "Checking" : "Unknown") : app.ready ? "Reachable" : app.reason === "owner_session_required" ? "Sign-in checked in the panel" : "Unavailable"
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{app?.label || SOURCE_LABEL[id]}</div>
                    <div className="truncate text-xs text-muted-foreground">{app ? `${hostOf(app.origin)} · ${word}` : word}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-11 gap-1 lg:h-9" onClick={() => navigate(section)}>
                    Open
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Each application keeps its own screens, permissions and saved work inside Frank. A panel shows its own state while it checks your session.
          </p>
        </aside>
      </div>
    </div>
  )
}
