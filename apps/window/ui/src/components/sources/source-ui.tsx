// Shared rendering for read-model sources: status badges, item and metric
// rows and the unavailable state. Status is never colour alone: each badge
// carries an icon and a word.
import * as React from "react"
import { AlertCircle, ArrowUpRight, CheckCircle2, CircleAlert, CircleSlash, Clock3 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { SourceItem, SourceMetric, SourceStatus } from "@/lib/api"
import { openTarget, statusWord, type Navigate } from "@/lib/targets"

export function StatusBadge({ status, className = "" }: { status: SourceStatus | string; className?: string }) {
  const word = statusWord(status)
  const tone =
    word === "Ready"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : word === "Needs attention"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : word === "Error"
          ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
          : "bg-muted text-muted-foreground"
  const Icon = word === "Ready" ? CheckCircle2 : word === "Needs attention" ? CircleAlert : word === "Error" ? AlertCircle : word === "Cached" ? Clock3 : CircleSlash
  return (
    <Badge variant="outline" className={`gap-1 border-transparent font-medium ${tone} ${className}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {word}
    </Badge>
  )
}

export function MetricList({ metrics }: { metrics: SourceMetric[] }) {
  if (!metrics.length) return null
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-24">
          <dt className="text-xs text-muted-foreground">{metric.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums tracking-tight">
            {metric.value === null || metric.value === undefined || metric.value === "" ? <span className="text-muted-foreground">Unknown</span> : metric.value}
            {metric.unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.unit}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ItemRow({ item, navigate, onOpen }: { item: SourceItem; navigate: Navigate; onOpen?: () => void }) {
  const target = item.recordTarget || item.target
  const canOpen = Boolean(target)
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={`mt-2 size-2 shrink-0 rounded-full ${item.attention ? "bg-amber-500" : "bg-muted-foreground/40"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-medium">{item.label}</span>
          {item.count !== null && item.count !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span> : null}
        </div>
        {item.detail ? <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p> : null}
      </div>
      {canOpen ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 gap-1 text-muted-foreground lg:h-9"
          onClick={() => {
            if (openTarget(target, navigate)) onOpen?.()
          }}
        >
          {target?.label && target.label.length < 24 ? target.label : "Open"}
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  )
}

export function Unavailable({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CircleSlash className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </div>
      {detail ? <p className="mt-2 max-w-prose text-sm text-muted-foreground">{detail}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}
