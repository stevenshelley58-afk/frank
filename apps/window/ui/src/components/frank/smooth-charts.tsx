import * as React from "react"
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

/**
 * Frank smooth charts.
 *
 * `type="natural"` is what produces the smooth (monotone-cubic) curve — without
 * it Recharts draws straight segments between points. Shading is a vertical
 * gradient from 35% to 0% alpha rather than a flat fill, so overlapping series
 * stay readable.
 */

export type Series = {
  key: string
  label: string
  /** A CSS colour, or a shadcn token reference like "var(--chart-2)". */
  color: string
}

/** Frank's six owner-workspace domains, in the order the overview shows them. */
export const FRANK_DOMAINS: Series[] = [
  { key: "mail", label: "Mail", color: "var(--chart-1)" },
  { key: "crm", label: "CRM", color: "var(--chart-2)" },
  { key: "support", label: "Support", color: "var(--chart-3)" },
  { key: "campaigns", label: "Campaigns", color: "var(--chart-4)" },
  { key: "revenue", label: "Revenue", color: "var(--chart-5)" },
]

export const LEADS_TREND = [
  { day: "Sep 01", mail: 42, crm: 18, support: 12, campaigns: 9, revenue: 4 },
  { day: "Sep 03", mail: 55, crm: 22, support: 15, campaigns: 14, revenue: 6 },
  { day: "Sep 05", mail: 48, crm: 26, support: 11, campaigns: 18, revenue: 5 },
  { day: "Sep 07", mail: 61, crm: 31, support: 19, campaigns: 16, revenue: 9 },
  { day: "Sep 09", mail: 74, crm: 28, support: 22, campaigns: 21, revenue: 11 },
  { day: "Sep 11", mail: 69, crm: 35, support: 18, campaigns: 25, revenue: 13 },
  { day: "Sep 13", mail: 88, crm: 41, support: 24, campaigns: 23, revenue: 16 },
  { day: "Sep 15", mail: 96, crm: 45, support: 27, campaigns: 29, revenue: 18 },
]

export const RESPONSE_TIME = [
  { week: "W34", first: 4.2, resolve: 18.4 },
  { week: "W35", first: 3.8, resolve: 16.9 },
  { week: "W36", first: 3.1, resolve: 15.2 },
  { week: "W37", first: 3.4, resolve: 14.1 },
  { week: "W38", first: 2.6, resolve: 12.8 },
  { week: "W39", first: 2.2, resolve: 11.4 },
  { week: "W40", first: 1.9, resolve: 10.2 },
]

function buildConfig(series: Series[]): ChartConfig {
  return series.reduce<ChartConfig>((acc, s) => {
    acc[s.key] = { label: s.label, color: s.color }
    return acc
  }, {})
}

/* ------------------------------------------------------------------ *
 * Smooth multi-series area chart — the owner overview trend.
 * ------------------------------------------------------------------ */
export function SmoothAreaChart({
  data,
  series,
  xKey,
  title,
  description,
  className,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey: string
  title?: string
  description?: string
  className?: string
}) {
  const config = React.useMemo(() => buildConfig(series), [series])

  const chart = (
    <ChartContainer config={config} className={className ?? "h-[260px] w-full"}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.35} />
              <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="natural"
            fill={`url(#fill-${s.key})`}
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )

  if (!title) return chart

  return (
    <Card className="py-0">
      <CardHeader className="pt-6">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="px-2 pb-6">{chart}</CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Smooth single-series line chart — compact, for metric cards.
 * ------------------------------------------------------------------ */
export function SmoothLineChart({
  data,
  series,
  xKey,
  height = 120,
  showAxis = false,
  className,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  xKey: string
  height?: number
  showAxis?: boolean
  className?: string
}) {
  const config = React.useMemo(() => buildConfig(series), [series])

  return (
    <ChartContainer config={config} className={className ?? "w-full"} style={{ height }}>
      <LineChart data={data} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        {showAxis ? (
          <>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={6} />
          </>
        ) : null}
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="natural"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Sparkline — no axes, no tooltip chrome. For inside metric cards.
 * ------------------------------------------------------------------ */
export function Sparkline({
  data,
  dataKey,
  color = "var(--chart-1)",
  height = 40,
}: {
  data: Record<string, unknown>[]
  dataKey: string
  color?: string
  height?: number
}) {
  const config: ChartConfig = { [dataKey]: { label: dataKey, color } }
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          dataKey={dataKey}
          type="natural"
          fill={`url(#spark-${dataKey})`}
          stroke={color}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
