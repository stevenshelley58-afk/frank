import * as React from "react"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Filter,
  MoreHorizontal,
  Search,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Props = {
  subsection: string
  onNavigate: (section: string, subsection?: string) => void
}
type Level = "campaign" | "adset" | "ad"
type RecordRow = {
  id: string
  parent?: string
  level: Level
  name: string
  status: "Delivering" | "Paused" | "Draft"
  spend: number
  results: number
  cpl: number
  trend: number
}

const navigation = [
  ["overview", "Overview"],
  ["campaigns", "Campaigns"],
  ["creative", "Creative intelligence"],
  ["blogs", "Blogs & destinations"],
  ["tracking", "Tracking"],
  ["queue", "Publishing queue"],
] as const

const records: RecordRow[] = [
  {
    id: "cmp_aud_104",
    level: "campaign",
    name: "Seller guide leads",
    status: "Delivering",
    spend: 2860,
    results: 176,
    cpl: 16.25,
    trend: 11,
  },
  {
    id: "cmp_aud_112",
    level: "campaign",
    name: "Home appraisal enquiries",
    status: "Delivering",
    spend: 1940,
    results: 101,
    cpl: 19.21,
    trend: 4,
  },
  {
    id: "cmp_aud_118",
    level: "campaign",
    name: "Suburb report downloads",
    status: "Paused",
    spend: 1224,
    results: 49,
    cpl: 24.98,
    trend: -8,
  },
  {
    id: "set_104_local",
    parent: "cmp_aud_104",
    level: "adset",
    name: "Local homeowners · 35–64",
    status: "Delivering",
    spend: 1730,
    results: 111,
    cpl: 15.59,
    trend: 9,
  },
  {
    id: "set_104_broad",
    parent: "cmp_aud_104",
    level: "adset",
    name: "Broad homeowners",
    status: "Delivering",
    spend: 1130,
    results: 65,
    cpl: 17.38,
    trend: 3,
  },
  {
    id: "set_112_warm",
    parent: "cmp_aud_112",
    level: "adset",
    name: "Website visitors · 90 days",
    status: "Delivering",
    spend: 1940,
    results: 101,
    cpl: 19.21,
    trend: 4,
  },
  {
    id: "ad_104_guide",
    parent: "set_104_local",
    level: "ad",
    name: "Know your selling options",
    status: "Delivering",
    spend: 1020,
    results: 72,
    cpl: 14.17,
    trend: 14,
  },
  {
    id: "ad_104_plan",
    parent: "set_104_local",
    level: "ad",
    name: "Your simple seller plan",
    status: "Delivering",
    spend: 710,
    results: 39,
    cpl: 18.21,
    trend: -2,
  },
  {
    id: "ad_112_value",
    parent: "set_112_warm",
    level: "ad",
    name: "What could your home be worth?",
    status: "Delivering",
    spend: 1940,
    results: 101,
    cpl: 19.21,
    trend: 4,
  },
]

const performance = [
  { date: "19 Aug", spend: 190, qualified: 3 },
  { date: "23 Aug", spend: 248, qualified: 4 },
  { date: "27 Aug", spend: 220, qualified: 3 },
  { date: "31 Aug", spend: 310, qualified: 6 },
  { date: "4 Sep", spend: 286, qualified: 5 },
  { date: "8 Sep", spend: 352, qualified: 7 },
  { date: "12 Sep", spend: 331, qualified: 6 },
  { date: "15 Sep", spend: 388, qualified: 8 },
]

const creativeItems = [
  {
    id: "crt_204",
    adId: "ad_104_guide",
    title: "Know your selling options",
    hook: "A calm, practical guide",
    state: "Comparable",
    cpl: 14.17,
    results: 72,
    palette: "bg-sky-100 dark:bg-sky-950",
  },
  {
    id: "crt_219",
    adId: "ad_104_plan",
    title: "Your simple seller plan",
    hook: "Three steps to feel prepared",
    state: "Comparable",
    cpl: 18.21,
    results: 39,
    palette: "bg-amber-100 dark:bg-amber-950",
  },
  {
    id: "crt_227",
    adId: "ad_118_report",
    title: "Suburb report",
    hook: "Local numbers, clearly explained",
    state: "Below evidence floor",
    cpl: 24.98,
    results: 12,
    palette: "bg-emerald-100 dark:bg-emerald-950",
  },
]

const queueRows = [
  {
    id: "batch_031",
    tab: "review",
    name: "Seller guide · September refresh",
    state: "Needs review",
    detail: "Three ads have staged copy and destination changes.",
  },
  {
    id: "batch_032",
    tab: "draft",
    name: "Appraisal follow-up test",
    state: "Draft",
    detail: "Local preview draft. It has not been sent to a provider.",
  },
  {
    id: "batch_029",
    tab: "uncertain",
    name: "Suburb report · audience update",
    state: "Uncertain",
    detail:
      "The prior write has no confirmed provider outcome. Inspect before any retry.",
  },
  {
    id: "batch_026",
    tab: "history",
    name: "Seller guide · August refresh",
    state: "Recorded",
    detail:
      "Sample history only. This preview does not verify provider delivery.",
  },
] as const

const chartConfig = {
  spend: { label: "Meta spend (AUD)", color: "var(--chart-1)" },
  qualified: { label: "CRM-qualified leads", color: "var(--chart-2)" },
} satisfies ChartConfig

function money(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value)
}

function Status({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "neutral" | "good" | "warn" | "bad"
}) {
  const tones = {
    neutral: "",
    good: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-300 text-amber-700 dark:text-amber-300",
    bad: "border-red-300 text-red-700 dark:text-red-300",
  }
  return (
    <Badge
      variant="outline"
      className={`rounded-full font-normal ${tones[tone]}`}
    >
      {children}
    </Badge>
  )
}

function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="border-b pb-4 last:border-0 sm:border-r sm:border-b-0 sm:pr-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

export function AdsWorkspace({ subsection, onNavigate }: Props) {
  const active = navigation.some(([id]) => id === subsection)
    ? subsection
    : "overview"
  const [selected, setSelected] = React.useState<string[]>([])
  const [detail, setDetail] = React.useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const go = (id: string) => onNavigate("ads", id)

  return (
    <div className="min-h-full bg-background text-[14px] text-foreground">
      <div className="mx-auto max-w-[1360px] space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Owner workspace for lead-generation campaigns, creative evidence,
              destinations and publishing state.
            </p>
          </div>
          <Button
            className="min-h-11"
            disabled={!selected.length}
            onClick={() => setReviewOpen(true)}
          >
            Review {selected.length ? `${selected.length} selected` : "changes"}
          </Button>
        </div>

        <Tabs value={active} onValueChange={go} className="min-w-0">
          <TabsList
            variant="line"
            className="h-auto w-full justify-start overflow-x-auto border-b pb-1"
          >
            {navigation.map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="min-h-11 shrink-0 px-3"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {active === "overview" && <Overview go={go} openDetail={setDetail} />}
        {active === "campaigns" && (
          <Campaigns
            selected={selected}
            setSelected={setSelected}
            openDetail={setDetail}
          />
        )}
        {active === "creative" && <Creative openDetail={setDetail} />}
        {active === "blogs" && <Blogs openDetail={setDetail} />}
        {active === "tracking" && <Tracking />}
        {active === "queue" && <Queue openDetail={setDetail} />}

        <RecordSheet id={detail} close={() => setDetail(null)} />
        <ReviewSheet
          ids={selected}
          open={reviewOpen}
          close={() => setReviewOpen(false)}
        />
      </div>
    </div>
  )
}

function Overview({
  go,
  openDetail,
}: {
  go: (id: string) => void
  openDetail: (id: string) => void
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Meta spend"
          value={money(6024)}
          note="Sample Meta observation · 28 days"
        />
        <Metric
          label="Meta leads"
          value="326"
          note="Provider-attributed lead events"
        />
        <Metric
          label="Website form leads"
          value="184"
          note="Separate website observation"
        />
        <Metric
          label="CRM-qualified leads"
          value="42"
          note="Separate CRM observation"
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,.6fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Spend and qualified demand</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sample daily observations. Different systems are not combined into
              one conversion claim.
            </p>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={chartConfig}
              className="h-64 w-full"
              aria-label="Daily Meta spend in Australian dollars"
            >
              <AreaChart
                data={performance}
                accessibilityLayer
                margin={{ left: 6, right: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => `$${v}`}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="spend"
                  stroke="var(--color-spend)"
                  fill="var(--color-spend)"
                  fillOpacity={0.14}
                />
              </AreaChart>
            </ChartContainer>
            <div className="mt-3 overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Meta spend</TableHead>
                    <TableHead className="text-right">CRM qualified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performance.slice(-3).map((point) => (
                    <TableRow key={point.date}>
                      <TableCell>{point.date}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(point.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {point.qualified}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Needs a decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              className="h-auto min-h-14 w-full justify-between px-3 py-3 text-left whitespace-normal"
              onClick={() => go("tracking")}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                Tracking draft needs validation
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-14 w-full justify-between px-3 py-3 text-left whitespace-normal"
              onClick={() => openDetail("batch_029")}
            >
              <span className="flex items-center gap-2">
                <Clock3 className="size-4 shrink-0 text-amber-600" />
                Uncertain provider outcome
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-14 w-full justify-between px-3 py-3 text-left whitespace-normal"
              onClick={() => openDetail("crt_227")}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                Creative below evidence floor
              </span>
              <ArrowRight className="size-4 shrink-0" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Campaigns({
  selected,
  setSelected,
  openDetail,
}: {
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  openDetail: (id: string) => void
}) {
  const [level, setLevel] = React.useState<Level>("campaign")
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const shown = records.filter(
    (row) =>
      row.level === level &&
      row.name.toLowerCase().includes(query.toLowerCase()) &&
      (status === "all" || row.status.toLowerCase() === status)
  )
  React.useEffect(() => setSelected([]), [level, setSelected])
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    )
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Campaign records</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select records explicitly before reviewing a proposed sample change.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={level} onValueChange={(value) => setLevel(value as Level)}>
          <TabsList className="h-11">
            <TabsTrigger value="campaign" className="min-h-10 px-3">
              Campaigns
            </TabsTrigger>
            <TabsTrigger value="adset" className="min-h-10 px-3">
              Ad sets
            </TabsTrigger>
            <TabsTrigger value="ad" className="min-h-10 px-3">
              Ads
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 pl-9"
            placeholder={`Search ${level === "adset" ? "ad sets" : `${level}s`}`}
            aria-label={`Search ${level} records`}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="min-h-11 w-40"
            aria-label="Filter by status"
          >
            <Filter className="size-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="delivering">Delivering</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!shown.length ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No sample records match these filters.
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Meta leads</TableHead>
                  <TableHead className="text-right">Cost per lead</TableHead>
                  <TableHead className="text-right">28-day change</TableHead>
                  <TableHead className="w-14">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={
                      selected.includes(row.id) ? "selected" : undefined
                    }
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.id}
                        {row.parent ? ` · Parent ${row.parent}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Status
                        tone={row.status === "Delivering" ? "good" : "neutral"}
                      >
                        {row.status}
                      </Status>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(row.spend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.results}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(row.cpl)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${row.trend < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}
                    >
                      {row.trend > 0 ? "+" : ""}
                      {row.trend}%
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        onClick={() => openDetail(row.id)}
                        aria-label={`Open ${row.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {shown.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selected.includes(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.id}
                      </p>
                    </div>
                    <Status
                      tone={row.status === "Delivering" ? "good" : "neutral"}
                    >
                      {row.status}
                    </Status>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Spend</p>
                      <p className="tabular-nums">{money(row.spend)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Meta leads
                      </p>
                      <p className="tabular-nums">{row.results}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CPL</p>
                      <p className="tabular-nums">{money(row.cpl)}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => openDetail(row.id)}
                  >
                    Open record
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Creative({ openDetail }: { openDetail: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Creative intelligence</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sample artwork and record-level evidence. Small samples stay below the
          evidence floor.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {creativeItems.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <div
              className={`flex aspect-[4/3] flex-col justify-between p-5 ${item.palette}`}
            >
              <div className="h-1 w-12 rounded-full bg-foreground" />
              <div>
                <p className="max-w-[16ch] text-2xl font-semibold tracking-tight">
                  {item.title}
                </p>
                <p className="mt-2 text-sm opacity-70">{item.hook}</p>
              </div>
              <span className="text-xs font-medium">
                BLOCKWISE · SAMPLE ARTWORK
              </span>
            </div>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {item.id} · {item.adId}
                </span>
                <Status tone={item.state === "Comparable" ? "good" : "warn"}>
                  {item.state}
                </Status>
              </div>
              <div className="flex justify-between text-sm">
                <span>{item.results} Meta leads</span>
                <span className="tabular-nums">{money(item.cpl)} CPL</span>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => openDetail(item.id)}
              >
                View provenance
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Blogs({ openDetail }: { openDetail: (id: string) => void }) {
  const destinations = [
    {
      id: "dst_041",
      title: "A practical guide to selling your home",
      sessions: 1820,
      forms: 73,
      qualified: 18,
    },
    {
      id: "dst_052",
      title: "What to prepare before requesting an appraisal",
      sessions: 1244,
      forms: 46,
      qualified: 11,
    },
    {
      id: "dst_067",
      title: "Your local market report",
      sessions: 890,
      forms: 28,
      qualified: 6,
    },
  ]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Blogs & destinations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Website and CRM observations stay separate from Meta results.
        </p>
      </div>
      <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
        <Metric
          label="Website sessions"
          value="3,954"
          note="Sample analytics observation"
        />
        <Metric
          label="Website form leads"
          value="147"
          note="Sample website observation"
        />
        <Metric
          label="CRM-qualified leads"
          value="35"
          note="Sample CRM observation"
        />
      </div>
      <div className="space-y-2">
        {destinations.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.id}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm sm:text-right">
                <span>
                  <b className="block tabular-nums">{item.sessions}</b>
                  <small className="text-muted-foreground">sessions</small>
                </span>
                <span>
                  <b className="block tabular-nums">{item.forms}</b>
                  <small className="text-muted-foreground">forms</small>
                </span>
                <span>
                  <b className="block tabular-nums">{item.qualified}</b>
                  <small className="text-muted-foreground">qualified</small>
                </span>
              </div>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => openDetail(item.id)}
              >
                Open detail
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function validateTracking(value: string) {
  const problems: string[] = []
  if (!value.trim()) problems.push("Enter a destination URL.")
  let parsed: URL | null = null
  try {
    parsed = new URL(value)
  } catch {
    if (value.trim()) problems.push("Use a complete https URL.")
  }
  if (parsed && parsed.protocol !== "https:")
    problems.push("Use https for the destination.")
  const query = parsed?.searchParams
  if (query && !query.get("utm_campaign"))
    problems.push("Add utm_campaign with an immutable campaign ID.")
  if (query && !query.get("utm_content"))
    problems.push("Add utm_content with an immutable ad ID.")
  const campaignId = query?.get("utm_campaign")
  const adId = query?.get("utm_content")
  if (campaignId && !/^cmp_[a-z0-9_]+$/.test(campaignId))
    problems.push("utm_campaign must use an immutable cmp_ ID, not a name.")
  if (adId && !/^ad_[a-z0-9_]+$/.test(adId))
    problems.push("utm_content must use an immutable ad_ ID, not a name.")
  return problems
}

function Tracking() {
  const storageKey = "frank.ads-preview.tracking-draft.v1"
  const initial =
    "https://blockwise.sale/guides/seller?utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_aud_104&utm_content=ad_104_guide"
  const [value, setValue] = React.useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? initial
    } catch {
      return initial
    }
  })
  const [saved, setSaved] = React.useState(false)
  const problems = validateTracking(value)
  const save = () => {
    try {
      sessionStorage.setItem(storageKey, value)
      setSaved(true)
    } catch {
      setSaved(false)
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Tracking</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Names can change. The campaign and ad IDs in the URL must remain
          stable.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Paid social destination</CardTitle>
          <p className="text-sm text-muted-foreground">
            Session-only preview draft. No provider or backend request is made.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tracking-url">Destination URL</Label>
            <Input
              id="tracking-url"
              className="min-h-11"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setSaved(false)
              }}
              aria-invalid={problems.length > 0}
            />
          </div>
          <div
            className={`rounded-lg border p-3 text-sm ${problems.length ? "border-red-300 text-red-700 dark:text-red-300" : "border-emerald-300 text-emerald-700 dark:text-emerald-300"}`}
          >
            {problems.length ? (
              <>
                <p className="font-medium">Fix before saving</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-2">
                <CheckCircle2 className="size-4" />
                Valid https URL with stable sample campaign and ad IDs.
              </p>
            )}
          </div>
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p>
              <b className="text-foreground">Editable names:</b> Seller guide
              leads · Know your selling options
            </p>
            <p className="mt-1">
              <b className="text-foreground">Immutable sample IDs:</b>{" "}
              cmp_aud_104 · ad_104_guide
            </p>
          </div>
          <Button
            className="min-h-11"
            disabled={problems.length > 0}
            onClick={save}
          >
            Save for this session
          </Button>
          {saved && (
            <span className="ml-3 text-sm text-emerald-700 dark:text-emerald-300">
              Saved in this tab session.
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Queue({ openDetail }: { openDetail: (id: string) => void }) {
  const [tab, setTab] = React.useState("review")
  const shown = queueRows.filter((row) => row.tab === tab)
  const counts = Object.fromEntries(
    ["draft", "review", "uncertain", "history"].map((key) => [
      key,
      queueRows.filter((row) => row.tab === key).length,
    ])
  )
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Publishing queue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preview states only. Nothing here confirms or performs a provider
          write.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="draft" className="min-h-11 px-3">
            Draft {counts.draft}
          </TabsTrigger>
          <TabsTrigger value="review" className="min-h-11 px-3">
            Needs review {counts.review}
          </TabsTrigger>
          <TabsTrigger value="uncertain" className="min-h-11 px-3">
            Uncertain {counts.uncertain}
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-11 px-3">
            History {counts.history}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="space-y-3">
        {shown.map((row) => (
          <Card key={row.id}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{row.name}</p>
                  <Status
                    tone={
                      row.state === "Uncertain"
                        ? "bad"
                        : row.state === "Needs review"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {row.state}
                  </Status>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {row.detail}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => openDetail(row.id)}
              >
                {row.tab === "uncertain"
                  ? "Inspect uncertainty"
                  : "Open detail"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function RecordSheet({ id, close }: { id: string | null; close: () => void }) {
  const record = records.find((row) => row.id === id)
  const creative = creativeItems.find((row) => row.id === id)
  const queue = queueRows.find((row) => row.id === id)
  const destination = id?.startsWith("dst_") ? id : null
  const title =
    record?.name ??
    creative?.title ??
    queue?.name ??
    (destination ? "Destination detail" : "Record detail")
  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{id} · sample UX preview record</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {record && (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
                <span>
                  <small className="block text-muted-foreground">Level</small>
                  {record.level}
                </span>
                <span>
                  <small className="block text-muted-foreground">Status</small>
                  {record.status}
                </span>
                <span>
                  <small className="block text-muted-foreground">
                    Meta spend
                  </small>
                  {money(record.spend)}
                </span>
                <span>
                  <small className="block text-muted-foreground">
                    Meta leads
                  </small>
                  {record.results}
                </span>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={close}
              >
                Close record
              </Button>
            </>
          )}
          {creative && (
            <>
              <div
                className={`aspect-[4/3] rounded-xl p-5 ${creative.palette}`}
              >
                <p className="max-w-[16ch] text-2xl font-semibold">
                  {creative.title}
                </p>
                <p className="mt-2">{creative.hook}</p>
              </div>
              <div className="rounded-xl border p-4 text-sm">
                <p>
                  <b>Creative ID:</b> {creative.id}
                </p>
                <p className="mt-2">
                  <b>Ad ID:</b> {creative.adId}
                </p>
                <p className="mt-2">
                  <b>Evidence:</b> {creative.results} sample Meta leads at{" "}
                  {money(creative.cpl)} CPL.
                </p>
              </div>
            </>
          )}
          {queue && (
            <>
              <div className="rounded-xl border p-4 text-sm">
                <Status tone={queue.state === "Uncertain" ? "bad" : "warn"}>
                  {queue.state}
                </Status>
                <p className="mt-3">{queue.detail}</p>
                {queue.state === "Uncertain" && (
                  <p className="mt-3 font-medium">
                    Do not retry from this preview. Verify provider history and
                    the idempotency record first.
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={close}
              >
                Close detail
              </Button>
            </>
          )}
          {destination && (
            <>
              <div className="rounded-xl border p-4 text-sm">
                <p>
                  <b>Destination ID:</b> {destination}
                </p>
                <p className="mt-2">
                  Website sessions, forms and CRM qualification are separate
                  sample observations.
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={close}
              >
                Close detail
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ReviewSheet({
  ids,
  open,
  close,
}: {
  ids: string[]
  open: boolean
  close: () => void
}) {
  const selected = records.filter((row) => ids.includes(row.id))
  return (
    <Sheet open={open} onOpenChange={(value) => !value && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review sample changes</SheetTitle>
          <SheetDescription>
            Explicit selection only. This preview cannot submit changes to Meta
            or any backend.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {selected.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="text-base">{row.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{row.id}</p>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="font-medium">Before</p>
                  <p className="mt-2">Status: {row.status}</p>
                  <p>
                    Daily sample budget: {money(Math.round(row.spend / 28))}
                  </p>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">Proposed after</p>
                  <p className="mt-2">Status: {row.status}</p>
                  <p>
                    Daily sample budget: {money(Math.round(row.spend / 28) + 5)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
          {!selected.length && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No records selected.
            </p>
          )}
          <Button variant="outline" className="min-h-11 w-full" onClick={close}>
            Close review
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
