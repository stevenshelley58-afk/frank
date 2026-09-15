// A read-model section with no native application to frame (Revenue, Results,
// Notifications) and the single-customer record. Both render one authorized
// payload in the same shape, so one renderer covers them.
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { customerUrl, formatObserved, SOURCES_URL, useEndpoint, type CustomerPayload, type SourcePayload, type SourcesResponse } from "@/lib/api"
import { ItemRow, MetricList, StatusBadge, Unavailable } from "@/components/sources/source-ui"
import { openTarget, type Navigate } from "@/lib/targets"

const TITLES: Record<string, { title: string; purpose: string }> = {
  revenue: { title: "Revenue", purpose: "Payments and renewals that need a decision." },
  results: { title: "Results", purpose: "What the business produced, from the sources that report it." },
  notifications: { title: "Notifications", purpose: "Owner notifications Frank published, and where each one came from." },
}

function PayloadView({ title, purpose, payload, navigate, refresh, loading, error }: { title: string; purpose: string; payload: SourcePayload | null; navigate: Navigate; refresh: () => void; loading: boolean; error: string | null }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{purpose}</p>
        </div>
        <div className="flex items-center gap-2">
          {payload ? <StatusBadge status={payload.status} /> : null}
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>
      {loading && !payload ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : !payload ? (
        <Unavailable title={`Frank could not read ${title.toLowerCase()}`} detail={error || "No payload was returned."} />
      ) : (
        <div className="space-y-6">
          {error ? <p className="text-sm text-amber-800 dark:text-amber-200">Showing the last good reading. {error}</p> : null}
          <p className="text-xs text-muted-foreground">Observed {formatObserved(payload.observed_at)}</p>
          {payload.metrics.length ? <MetricList metrics={payload.metrics} /> : null}
          {payload.summary || payload.detail ? <p className="max-w-prose text-sm text-muted-foreground">{payload.summary || payload.detail}</p> : null}
          {payload.items.length ? (
            <ul className="divide-y rounded-2xl border px-4">
              {payload.items.map((item) => (
                <ItemRow key={item.id} item={item} navigate={navigate} />
              ))}
            </ul>
          ) : payload.status === "unavailable" || payload.status === "error" ? (
            <Unavailable title="Not connected" detail={payload.detail || "No adapter is attached to this source in this release."} />
          ) : (
            <Unavailable title="Nothing to show" detail="The source is connected and reports no item." />
          )}
          {payload.dropped ? <p className="text-xs text-muted-foreground">{payload.dropped} further item(s) not shown.</p> : null}
          {payload.target && payload.target.kind !== "owner-section" ? (
            <Button variant="secondary" className="h-10" onClick={() => openTarget(payload.target, navigate)}>
              {payload.target.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function SourceSection({ section, navigate }: { section: "revenue" | "results" | "notifications"; navigate: Navigate }) {
  const sources = useEndpoint<SourcesResponse>(SOURCES_URL, { refreshMs: 60000 })
  const payload = sources.data?.sources[section] || null
  const meta = TITLES[section]
  return <PayloadView title={meta.title} purpose={meta.purpose} payload={payload} navigate={navigate} refresh={sources.refresh} loading={sources.state === "loading"} error={sources.error} />
}

export function CustomerSection({ customerId, navigate }: { customerId: string; navigate: Navigate }) {
  const customer = useEndpoint<CustomerPayload>(customerUrl(customerId))
  return (
    <PayloadView
      title="Customer"
      purpose={customer.data?.identity === "single_source_record" ? "One source record, shown as its application knows it. Frank does not merge records by email." : `Record ${customerId}`}
      payload={customer.data}
      navigate={navigate}
      refresh={customer.refresh}
      loading={customer.state === "loading"}
      error={customer.error}
    />
  )
}
