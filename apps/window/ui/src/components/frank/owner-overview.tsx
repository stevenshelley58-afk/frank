import * as React from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  LifeBuoy,
  Mail,
  Megaphone,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  FRANK_DOMAINS,
  LEADS_TREND,
  RESPONSE_TIME,
  SmoothAreaChart,
  SmoothLineChart,
  Sparkline,
} from "@/components/frank/smooth-charts"

/* ------------------------------------------------------------------ *
 * Status semantics.
 *
 * Frank's own PRODUCT.md requires that status never be conveyed by colour
 * alone, so every pill carries an icon AND a word. Colour is the third
 * signal, not the first.
 * ------------------------------------------------------------------ */
type StatusKind = "ready" | "degraded" | "unavailable" | "empty"

const STATUS: Record<
  StatusKind,
  { label: string; icon: React.ElementType; className: string }
> = {
  ready: {
    label: "Ready",
    icon: CheckCircle2,
    className: "border-transparent bg-emerald-50 text-emerald-800",
  },
  degraded: {
    label: "Degraded",
    icon: CircleAlert,
    className: "border-transparent bg-amber-50 text-amber-900",
  },
  unavailable: {
    label: "Unavailable",
    icon: CircleSlash,
    className: "border-transparent bg-red-50 text-red-800",
  },
  empty: {
    label: "Empty",
    icon: CircleSlash,
    className: "border-transparent bg-muted text-muted-foreground",
  },
}

function StatusPill({ kind }: { kind: StatusKind }) {
  const s = STATUS[kind]
  const Icon = s.icon
  return (
    <Badge variant="outline" className={s.className}>
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  )
}

/* ------------------------------------------------------------------ *
 * Metric card — tabular numerals so columns of numbers actually align.
 * ------------------------------------------------------------------ */
function MetricCard({
  label,
  value,
  unit,
  delta,
  data,
  dataKey,
  color,
}: {
  label: string
  value: string
  unit?: string
  delta?: number
  data?: Record<string, unknown>[]
  dataKey?: string
  color?: string
}) {
  const up = (delta ?? 0) >= 0
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="flex items-baseline gap-1.5 text-2xl tabular-nums">
          {value}
          {unit ? (
            <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          ) : null}
        </CardTitle>
        {delta !== undefined ? (
          <CardAction>
            <Badge
              variant="outline"
              className={
                up
                  ? "border-transparent bg-emerald-50 text-emerald-800"
                  : "border-transparent bg-red-50 text-red-800"
              }
            >
              {up ? (
                <ArrowUpRight className="size-3" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3" aria-hidden />
              )}
              {Math.abs(delta)}%
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {data && dataKey ? (
        <CardContent className="px-1">
          <Sparkline data={data} dataKey={dataKey} color={color} height={44} />
        </CardContent>
      ) : null}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Source card — the six domains. Each gets its own coloured left rule so
 * the grid is scannable instead of six identical grey boxes.
 * ------------------------------------------------------------------ */
type SourceCard = {
  name: string
  icon: React.ElementType
  status: StatusKind
  blurb: string
  count?: number
  countLabel?: string
  items?: { title: string; meta: string }[]
  reason?: string
  updated: string
  accent: string
}

const SOURCES: SourceCard[] = [
  {
    name: "Mail",
    icon: Mail,
    status: "degraded",
    blurb: "Inbound that still needs a reply.",
    count: 3,
    countLabel: "conversations still need a reply",
    items: [
      { title: "Riverside enquiry", meta: "Inbound 2 hours ago" },
      { title: "Invoice question", meta: "Inbound 5 hours ago" },
    ],
    updated: "as of Sep 14, 2026, 5:12 AM",
    accent: "border-l-[3px] border-l-blue-600",
  },
  {
    name: "CRM",
    icon: Search,
    status: "ready",
    blurb: "Leads and follow-ups that need an owner.",
    count: 4,
    countLabel: "leads are waiting on a follow-up",
    items: [
      { title: "Riverside, new enquiry", meta: "No owner assigned" },
      { title: "Hartley, call booked", meta: "Follow-up due today" },
    ],
    updated: "as of Sep 14, 2026, 5:12 AM",
    accent: "border-l-[3px] border-l-violet-600",
  },
  {
    name: "Support",
    icon: LifeBuoy,
    status: "empty",
    blurb: "Tickets waiting on a reply or an owner.",
    count: 0,
    updated: "as of Sep 14, 2026, 5:12 AM",
    accent: "border-l-[3px] border-l-teal-600",
  },
  {
    name: "Email flows",
    icon: Megaphone,
    status: "unavailable",
    blurb: "Sending flows that need attention.",
    reason:
      "Mautic did not answer the last check. The source is listed so you can see what is missing.",
    updated: "last success Sep 13, 2026, 11:40 PM",
    accent: "border-l-[3px] border-l-pink-600",
  },
  {
    name: "Revenue",
    icon: Wallet,
    status: "ready",
    blurb: "Payments and renewals that need a decision.",
    count: 2,
    countLabel: "renewals need a decision",
    items: [{ title: "Renewal due 21 Sep", meta: "Awaiting owner decision" }],
    updated: "as of Sep 14, 2026, 5:12 AM",
    accent: "border-l-[3px] border-l-emerald-600",
  },
  {
    name: "Results",
    icon: CalendarClock,
    status: "ready",
    blurb: "Lead and channel results against the plan.",
    updated: "as of Sep 14, 2026, 5:12 AM",
    accent: "border-l-[3px] border-l-amber-600",
  },
]

function SourceTile({ s }: { s: SourceCard }) {
  const Icon = s.icon
  return (
    <Card className={`gap-4 py-5 ${s.accent}`}>
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {s.name}
        </CardTitle>
        <CardDescription>{s.blurb}</CardDescription>
        <CardAction>
          <StatusPill kind={s.status} />
        </CardAction>
      </CardHeader>

      <CardContent className="px-5">
        {s.status === "unavailable" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{s.reason}</p>
            <Button size="sm" variant="outline" className="w-fit">
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        ) : s.count ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-baseline gap-1.5 text-sm">
              <span className="text-xl font-semibold tabular-nums">{s.count}</span>
              <span className="text-muted-foreground">{s.countLabel}</span>
            </p>
            <ul className="flex flex-col">
              {s.items?.map((it, i) => (
                <li key={it.title}>
                  {i > 0 ? <Separator /> : null}
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="truncate">{it.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{it.meta}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No open tickets.</p>
        )}
      </CardContent>

      <CardFooter className="px-5">
        <p className="text-xs text-muted-foreground">{s.updated}</p>
      </CardFooter>
    </Card>
  )
}

const ATTENTION: {
  n: number
  title: string
  meta: string
  src: string
  kind: StatusKind
}[] = [
  { n: 1, title: "Riverside enquiry", meta: "Inbound 2 hours ago", src: "Mail", kind: "degraded" },
  {
    n: 1,
    title: "Riverside, new enquiry",
    meta: "No owner assigned",
    src: "CRM",
    kind: "ready",
  },
  { n: 2, title: "Invoice question", meta: "Inbound 5 hours ago", src: "Mail", kind: "degraded" },
  {
    n: 2,
    title: "Renewal due 21 Sep",
    meta: "Awaiting owner decision",
    src: "Revenue",
    kind: "ready",
  },
]

export function OwnerOverview() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Overview</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Frank combines the connected sources report. Every item opens the record or the
            filtered list that owns it, and the native application stays authoritative.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />5 of 7
            sources connected
          </Badge>
          <Button variant="outline" size="sm">
            <RefreshCw className="size-3.5" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {/* Needs you — the attention list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            What needs you
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <ul className="flex flex-col">
            {ATTENTION.map((row, i) => (
              <li key={`${row.title}-${i}`}>
                {i > 0 ? <Separator /> : null}
                <button
                  type="button"
                  className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="w-5 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {row.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.meta}
                    </span>
                  </span>
                  <StatusPill kind={row.kind} />
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                    {row.src}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-4">
          <span className="text-xs text-muted-foreground">Email flows: unavailable</span>
          <span className="text-xs text-muted-foreground">Notifications: error</span>
        </CardFooter>
      </Card>

      {/* Metrics with smooth sparklines */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Leads this week"
          value="18"
          delta={12}
          data={LEADS_TREND}
          dataKey="crm"
          color="var(--chart-2)"
        />
        <MetricCard
          label="Conversations needing reply"
          value="3"
          delta={-25}
          data={LEADS_TREND}
          dataKey="mail"
          color="var(--chart-1)"
        />
        <MetricCard
          label="Open tickets"
          value="0"
          delta={0}
          data={LEADS_TREND}
          dataKey="support"
          color="var(--chart-3)"
        />
        <MetricCard
          label="Cost per lead"
          value="24"
          unit="GBP"
          delta={8}
          data={LEADS_TREND}
          dataKey="revenue"
          color="var(--chart-5)"
        />
      </div>

      <SmoothAreaChart
        title="Source activity"
        description="Items needing attention per source, last 14 days"
        data={LEADS_TREND}
        series={FRANK_DOMAINS}
        xKey="day"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Response time</CardTitle>
            <CardDescription>Hours to first reply and to resolution</CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-6">
            <SmoothLineChart
              data={RESPONSE_TIME}
              xKey="week"
              height={220}
              showAxis
              series={[
                { key: "first", label: "First reply", color: "var(--chart-1)" },
                { key: "resolve", label: "Resolution", color: "var(--chart-3)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Sources</CardTitle>
            <CardDescription>Connection state per native application</CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <ul className="flex flex-col">
              {SOURCES.map((s, i) => {
                const Icon = s.icon
                return (
                  <li key={s.name}>
                    {i > 0 ? <Separator /> : null}
                    <div className="flex items-center gap-3 py-2.5">
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                      <span className="flex-1 text-sm">{s.name}</span>
                      <StatusPill kind={s.status} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Sources</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SOURCES.map((s) => (
            <SourceTile key={s.name} s={s} />
          ))}
        </div>
      </div>
    </div>
  )
}
