import * as React from "react"
import {
  FileText,
  Film,
  Layers,
  Image as ImageIcon,
  Users,
  Mail,
  ArrowRight,
  LockKeyhole,
  CircleAlert,
  LoaderCircle,
  Bell,
  Check,
  Search,
  CalendarDays,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { SmoothLineChart } from "@/components/frank/smooth-charts"

type Props = {
  section: string
  subsection: string
  onNavigate: (section: string, subsection?: string) => void
  onExampleReviewed: (id: string) => void
}
type Item = {
  id: string
  title: string
  type: string
  status: string
  note: string
  version: string
}
const initial: Item[] = [
  {
    id: "blog-101",
    title: "Turn local expertise into your next lead",
    type: "blogs",
    status: "Needs review",
    note: "Guide · 1,240 words · source checks complete",
    version: "v3",
  },
  {
    id: "blog-102",
    title: "A useful follow-up after someone downloads a guide",
    type: "blogs",
    status: "Draft",
    note: "Article · 860 words · evidence still needed",
    version: "v1",
  },
  {
    id: "template-101",
    title: "Local knowledge, useful answers",
    type: "templates",
    status: "Needs review",
    note: "Lead-generation pack · Feed + Story · 5 variations",
    version: "v2",
  },
  {
    id: "template-102",
    title: "Start a conversation with your next prospect",
    type: "templates",
    status: "Reviewed",
    note: "Lead-generation pack · Feed + Story · 3 variations",
    version: "v4",
  },
  {
    id: "video-101",
    title: "How Blockwise helps agents follow up",
    type: "video",
    status: "Needs review",
    note: "Explainer brief · 30 seconds · captions included",
    version: "v2",
  },
  {
    id: "video-102",
    title: "One useful idea for your next campaign",
    type: "video",
    status: "Draft",
    note: "Reel brief · 15 seconds · storyboard pending",
    version: "v1",
  },
  {
    id: "asset-101",
    title: "Lead guide cover and social variations",
    type: "assets",
    status: "Reviewed",
    note: "Artwork collection · 6 files · usage details recorded",
    version: "v3",
  },
  {
    id: "asset-102",
    title: "Blockwise brand assets",
    type: "assets",
    status: "Reviewed",
    note: "Logo, colours and type references",
    version: "v1",
  },
]
const business = [
  {
    name: "Example Agency",
    id: "customer-101",
    state: "Trial",
    note: "Setup in progress · follow-up due today",
  },
  {
    name: "Sample Property Team",
    id: "customer-102",
    state: "Paid",
    note: "Account review · next renewal in 12 days",
  },
  {
    name: "Demo Realty",
    id: "customer-103",
    state: "Needs attention",
    note: "Billing state needs a check",
  },
]
function Heading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mb-7">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
function Subnav({
  value,
  items,
  onChange,
}: {
  value: string
  items: string[][]
  onChange: (x: string) => void
}) {
  return (
    <div className="mb-6 max-w-full overflow-x-auto pb-1">
      <Tabs value={value} onValueChange={onChange}>
        <TabsList className="h-12 w-max bg-muted/60">
          {items.map(([id, label]) => (
            <TabsTrigger key={id} value={id} className="h-11 shrink-0 px-4">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
function Empty({
  title,
  description,
  icon: Icon = FileText,
}: {
  title: string
  description: string
  icon?: typeof FileText
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center">
      <Icon className="mb-4 size-8 text-muted-foreground" />
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
export function AppsWorkspace({
  section,
  subsection,
  onNavigate,
  onExampleReviewed,
}: Props) {
  const [items, setItems] = React.useState<Item[]>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("frank.ui-review.content.v1") || "null"
      )
      return Array.isArray(saved) && saved.length === initial.length
        ? saved
        : initial
    } catch {
      return initial
    }
  })
  React.useEffect(() => {
    sessionStorage.setItem("frank.ui-review.content.v1", JSON.stringify(items))
  }, [items])
  const [q, setQ] = React.useState("")
  const [detail, setDetail] = React.useState<Item | null>(null)
  const [customer, setCustomer] = React.useState<
    (typeof business)[number] | null
  >(null)
  const [customerTab, setCustomerTab] = React.useState("account")
  const [nativeState, setNativeState] = React.useState("ready")
  const [notice, setNotice] = React.useState("")
  const [settings, setSettings] = React.useState(() => {
    const defaults = {
      desktop: true,
      mobile: true,
      badges: true,
      private: true,
    }
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("frank.ui-review.settings.v1") || "null"
      )
      return saved &&
        Object.keys(defaults).every((key) => typeof saved[key] === "boolean")
        ? {
            desktop: saved.desktop as boolean,
            mobile: saved.mobile as boolean,
            badges: saved.badges as boolean,
            private: saved.private as boolean,
          }
        : defaults
    } catch {
      return defaults
    }
  })
  React.useEffect(() => {
    sessionStorage.setItem(
      "frank.ui-review.settings.v1",
      JSON.stringify(settings)
    )
  }, [settings])
  const [alertPreview, setAlertPreview] = React.useState(false)
  const [period, setPeriod] = React.useState("7")
  const [metric, setMetric] = React.useState("leads")
  const contentTabs = [
    ["blogs", "Blogs"],
    ["templates", "Templates"],
    ["video", "Video"],
    ["assets", "Assets"],
  ]
  const current = contentTabs.some((t) => t[0] === subsection)
    ? subsection
    : "blogs"
  const native = ["crm", "mail", "email"].includes(section)
  const nativeName =
    section === "crm" ? "Frappe" : section === "mail" ? "Roundcube" : "Mautic"
  const nativeTabs =
    section === "crm"
      ? [
          ["leads", "Leads"],
          ["deals", "Deals"],
          ["contacts", "Contacts"],
          ["tasks", "Tasks"],
          ["support", "Support"],
        ]
      : section === "mail"
        ? [
            ["inbox", "Inbox"],
            ["drafts", "Drafts"],
          ]
        : [
            ["campaigns", "Campaigns"],
            ["emails", "Emails"],
            ["templates", "Templates"],
          ]
  const nativeTab = nativeTabs.some((t) => t[0] === subsection)
    ? subsection
    : nativeTabs[0][0]
  const content = items.filter(
    (i) =>
      i.type === current &&
      `${i.title} ${i.status}`.toLowerCase().includes(q.toLowerCase())
  )
  const series = Array.from({ length: period === "7" ? 7 : 14 }, (_, i) => ({
    day: `${i + 1} Sep`,
    leads: [4, 7, 6, 10, 8, 12, 11, 13, 9, 12, 14, 10, 16, 15][i],
    spend: [
      120, 132, 125, 148, 141, 156, 153, 162, 146, 164, 175, 154, 180, 178,
    ][i],
  }))
  function updateSetting(key: keyof typeof settings) {
    setSettings((s) => ({ ...s, [key]: !s[key] }))
    setNotice("Preview preference changed. Device settings are untouched.")
  }
  const detailSheet = (
    <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{detail?.title}</SheetTitle>
          <SheetDescription>{detail?.note}</SheetDescription>
        </SheetHeader>
        {detail && (
          <div className="space-y-6 p-4">
            <div className="flex gap-2">
              <Badge variant="outline">{detail.status}</Badge>
              <Badge variant="secondary">{detail.version}</Badge>
            </div>
            <div className="rounded-2xl bg-muted/50 p-6">
              <h3 className="text-xl font-semibold">{detail.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Sample{" "}
                {detail.type === "blogs" ? "article excerpt" : "creative brief"}
                : give real-estate agents a useful reason to begin a
                conversation, capture an interested prospect’s details, and
                follow up with relevant help.
              </p>
            </div>
            <section>
              <h3 className="mb-3 font-medium">Review checklist</h3>
              {[
                "Audience and lead goal are clear",
                "Claims have supporting evidence",
                "Next action matches the offer",
                "Feed, Story or document output checked",
              ].map((text, i) => (
                <div
                  key={text}
                  className="flex items-center gap-2 border-b py-3 text-sm"
                >
                  {detail.status === "Draft" && i === 1 ? (
                    <CircleAlert className="size-4 shrink-0 text-amber-600" />
                  ) : (
                    <Check className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {text}
                  {detail.status === "Draft" && i === 1 && (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </div>
              ))}
            </section>
            <dl className="grid grid-cols-[100px_1fr] gap-3 text-sm">
              <dt className="text-muted-foreground">Example ID</dt>
              <dd>{detail.id}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{detail.version}</dd>
              <dt className="text-muted-foreground">Execution</dt>
              <dd>Existing Hermes tool retained</dd>
            </dl>
            <Button
              className="h-11 w-full"
              disabled={detail.status === "Reviewed"}
              onClick={() => {
                setItems((rows) =>
                  rows.map((i) =>
                    i.id === detail.id ? { ...i, status: "Reviewed" } : i
                  )
                )
                setDetail({ ...detail, status: "Reviewed" })
                onExampleReviewed(detail.id)
                setNotice("Example marked reviewed. No content was published.")
              }}
            >
              {detail.status === "Reviewed"
                ? "Example reviewed"
                : "Mark example reviewed"}
            </Button>
            <p className="text-xs text-muted-foreground">
              This tests review feedback only. No render, export or publication
              happens.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
  return (
    <div className="min-w-0">
      {section === "content" ? (
        <>
          <Heading
            title="Content"
            description="Create, check and organise the material behind your campaigns."
          />
          <Subnav
            value={current}
            items={contentTabs}
            onChange={(x) => onNavigate("content", x)}
          />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {contentTabs.find((t) => t[0] === current)?.[1]}
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search content"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search content or status"
                className="h-11 pl-9"
              />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border">
            {content.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center gap-4 border-b p-5 last:border-b-0 sm:flex-nowrap"
              >
                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
                  {current === "video" ? (
                    <Film className="size-6 text-muted-foreground" />
                  ) : current === "assets" ? (
                    <ImageIcon className="size-6 text-muted-foreground" />
                  ) : current === "templates" ? (
                    <Layers className="size-6 text-muted-foreground" />
                  ) : (
                    <FileText className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Button
                    variant="link"
                    className="h-auto p-0 text-left leading-6 whitespace-normal"
                    onClick={() => setDetail(i)}
                  >
                    {i.title}
                  </Button>
                  <p className="mt-1 text-sm text-muted-foreground">{i.note}</p>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="outline">{i.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {i.version}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="h-11 w-full sm:w-auto"
                  onClick={() => setDetail(i)}
                >
                  Review
                </Button>
              </div>
            ))}
            {!content.length && (
              <p className="p-10 text-center text-sm text-muted-foreground">
                No content matches your search.
              </p>
            )}
          </div>
          {detailSheet}
        </>
      ) : native ? (
        <>
          <Heading
            title={
              section === "crm"
                ? "CRM"
                : section === "mail"
                  ? "Mail"
                  : "Email flows"
            }
            description={
              section === "crm"
                ? "Leads, customer work and support. One place in your menu."
                : section === "mail"
                  ? "Your existing mailbox, with drafts and replies kept in their native home."
                  : "Campaigns and email journeys stay in Mautic."
            }
          />
          <Subnav
            value={nativeTab}
            items={nativeTabs}
            onChange={(x) => onNavigate(section, x)}
          />
          <div className="overflow-hidden rounded-2xl border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <Badge variant="secondary">Native app</Badge>
                <span className="text-sm font-medium">
                  {nativeName}
                  {section === "crm" && nativeTab === "support"
                    ? " Helpdesk"
                    : section === "crm"
                      ? " CRM"
                      : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="native-state"
                  className="text-xs text-muted-foreground"
                >
                  Preview state
                </Label>
                <Select value={nativeState} onValueChange={setNativeState}>
                  <SelectTrigger id="native-state" className="h-11 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ["ready", "Ready layout"],
                      ["connecting", "Loading"],
                      ["signin", "Session expired"],
                      ["error", "Unavailable"],
                    ].map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex min-h-[430px] flex-col items-center justify-center p-6 text-center md:min-h-[560px]">
              {nativeState === "ready" ? (
                <>
                  <div className="mb-5 rounded-2xl bg-muted p-5">
                    {section === "mail" ? (
                      <Mail className="size-9 text-muted-foreground" />
                    ) : (
                      <Users className="size-9 text-muted-foreground" />
                    )}
                  </div>
                  <h2 className="text-xl font-semibold">
                    The native {nativeName} workspace stays here
                  </h2>
                  <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                    This is the full-width hosting area for{" "}
                    {nativeTabs
                      .find((t) => t[0] === nativeTab)?.[1]
                      .toLowerCase()}
                    . Its existing screens, permissions and saved work are
                    retained.
                  </p>
                  <Badge variant="outline" className="mt-5">
                    Not loaded in this UI-only preview
                  </Badge>
                </>
              ) : nativeState === "connecting" ? (
                <>
                  <LoaderCircle className="mb-4 size-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  <h2 className="text-lg font-medium">
                    Opening your workspace
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Simulated loading state. No sign-in or connection is
                    running.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-5 h-11"
                    onClick={() => setNativeState("ready")}
                  >
                    Finish loading example
                  </Button>
                </>
              ) : nativeState === "signin" ? (
                <>
                  <LockKeyhole className="mb-4 size-8 text-muted-foreground" />
                  <h2 className="text-lg font-medium">
                    Your session needs renewing
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    The real flow will sign in securely and return here. Unsaved
                    native work must be protected before leaving.
                  </p>
                  <Button
                    className="mt-5 h-11"
                    onClick={() => {
                      setNativeState("ready")
                      setNotice(
                        "Session-return preview only. No authentication was performed."
                      )
                    }}
                  >
                    Preview return after sign-in
                  </Button>
                </>
              ) : (
                <>
                  <CircleAlert className="mb-4 size-8 text-muted-foreground" />
                  <h2 className="text-lg font-medium">
                    This workspace is unavailable
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Frank stays usable while this app recovers.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-5 h-11"
                    onClick={() => setNativeState("connecting")}
                  >
                    Retry example
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      ) : section === "customers" ? (
        <>
          <Heading
            title="Customers"
            description="Account context and follow-up, without duplicating the CRM."
          />
          <div className="mb-5">
            <Input
              className="h-11 max-w-sm"
              placeholder="Search example customers"
              aria-label="Search customers"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="overflow-hidden rounded-2xl border">
            {business
              .filter((b) => b.name.toLowerCase().includes(q.toLowerCase()))
              .map((b) => (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center gap-4 border-b p-5 last:border-b-0"
                >
                  <div className="flex-1">
                    <p className="font-medium">{b.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {b.note}
                    </p>
                  </div>
                  <Badge variant="outline">{b.state}</Badge>
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      setCustomer(b)
                      setCustomerTab("account")
                    }}
                  >
                    View account
                  </Button>
                </div>
              ))}
            {!business.some((b) =>
              b.name.toLowerCase().includes(q.toLowerCase())
            ) && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No matching customers.
              </p>
            )}
          </div>
          <Sheet
            open={!!customer}
            onOpenChange={(o) => !o && setCustomer(null)}
          >
            <SheetContent className="w-full overflow-auto sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>{customer?.name}</SheetTitle>
                <SheetDescription>
                  Example account context. Native systems stay authoritative.
                </SheetDescription>
              </SheetHeader>
              <div className="p-4">
                <Subnav
                  value={customerTab}
                  items={[
                    ["account", "Account"],
                    ["billing", "Billing"],
                    ["consent", "Consent"],
                    ["booking", "Booking"],
                  ]}
                  onChange={setCustomerTab}
                />
                {customerTab === "booking" ? (
                  <Empty
                    title="Scheduling readiness"
                    description="No calendar is invented here. Availability and booking records will come from the existing scheduling service."
                    icon={CalendarDays}
                  />
                ) : (
                  <div className="space-y-4 rounded-xl border p-5">
                    <Badge variant="outline">Sample record</Badge>
                    <h3 className="font-medium capitalize">{customerTab}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {customerTab === "billing"
                        ? "Payment and renewal state belongs to Stripe. Trial and access state belongs to Blockwise; they must not be merged into one status."
                        : customerTab === "consent"
                          ? "Show the specific permission, its source and when it was recorded. A CRM lead is not automatic permission for marketing."
                          : "One customer identity with links to its CRM work, support and account history."}
                    </p>
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => {
                        setCustomer(null)
                        onNavigate("crm", "leads")
                      }}
                    >
                      Open CRM context
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </>
      ) : section === "reports" ? (
        <>
          <Heading
            title="Reports"
            description="Keep spending, lead outcomes and revenue clearly separate."
          />
          <div className="mb-6 flex flex-wrap gap-3">
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger aria-label="Report metric" className="h-11 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leads">CRM-observed leads</SelectItem>
                <SelectItem value="spend">Meta spend (AUD)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger aria-label="Report period" className="h-11 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-2xl border p-4 md:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {metric === "leads" ? "CRM-observed leads" : "Meta spend"}
              </h2>
              <span className="text-xs text-muted-foreground">
                Example period · {period} days · Australia/Perth
              </span>
            </div>
            <SmoothLineChart
              data={series}
              xKey="day"
              height={280}
              showAxis
              series={[
                {
                  key: metric,
                  label: metric === "leads" ? "Leads" : "Spend (AUD)",
                  color: "var(--chart-1)",
                },
              ]}
            />
            <details className="mt-4">
              <summary className="cursor-pointer py-3 text-sm">
                View example chart values
              </summary>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {series.map((s) => (
                  <React.Fragment key={s.day}>
                    <span>{s.day}</span>
                    <span className="text-right tabular-nums">
                      {metric === "leads" ? s.leads : `A$${s.spend}`}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </details>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Empty
              title="Revenue view retained"
              description="Cash collected, recurring revenue and subscription status remain separate. No billing totals are invented in this preview."
            />
            <Empty
              title="Evidence, not blended totals"
              description="Meta attribution, website events and CRM outcomes can be compared, but cannot be added together as if they were unique leads."
            />
          </div>
        </>
      ) : section === "settings" ? (
        <>
          <Heading
            title="Settings"
            description="Workspace preferences and how Frank gets your attention."
          />
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="rounded-2xl border p-5">
              <h2 className="mb-3 text-lg font-semibold">Alert preferences</h2>
              {(
                [
                  [
                    "desktop",
                    "Desktop alerts",
                    "Preview the desktop delivery preference.",
                  ],
                  [
                    "mobile",
                    "Mobile alerts",
                    "Preview notifications when you are away.",
                  ],
                  [
                    "badges",
                    "App and menu badges",
                    "Outstanding work remains visible until resolved.",
                  ],
                  [
                    "private",
                    "Private lock-screen text",
                    "Hide customer names and message content.",
                  ],
                ] as const
              ).map(([key, title, description]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 border-b py-5 last:border-0"
                >
                  <div>
                    <Label htmlFor={`setting-${key}`}>{title}</Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <div className="flex min-h-11 min-w-11 items-center justify-center">
                    <Switch
                      id={`setting-${key}`}
                      checked={settings[key]}
                      onCheckedChange={() => updateSetting(key)}
                    />
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                className="mt-5 h-11"
                onClick={() => setAlertPreview(true)}
              >
                Preview notification appearance
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                No browser permissions are requested. Preferences last only in
                this review session.
              </p>
            </section>
            <aside className="space-y-4">
              <Empty
                icon={Bell}
                title="Frank’s icon signals work"
                description="App badges, sidebar counts and the alert inbox share one action model. Device behavior will be tested after the UI is approved."
              />
              <Button
                variant="outline"
                className="h-11 w-full"
                onClick={() => onNavigate("tools", "connections")}
              >
                Review connection layout
              </Button>
            </aside>
          </div>
          <Dialog open={alertPreview} onOpenChange={setAlertPreview}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Notification appearance</DialogTitle>
                <DialogDescription>
                  Visual example only. This is not a desktop or phone
                  notification.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-4 rounded-2xl border p-5">
                <Bell className="size-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Frank · CRM</p>
                  <p className="mt-1 font-medium">
                    A support ticket needs your reply
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Open the ticket to review it.
                  </p>
                </div>
              </div>
              <Button
                className="h-11"
                onClick={() => {
                  setAlertPreview(false)
                  onNavigate("crm", "support")
                }}
              >
                Preview opening Support
              </Button>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          <Heading
            title={section === "research" ? "Research & assets" : "Tools"}
            description="Specialist tools stay available without crowding your daily workspace."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {[
              [
                "Ad Radar",
                "Dated observations, market filters and evidence reports.",
              ],
              [
                "Ad database",
                "Creative assets, source evidence and searchable records.",
              ],
              [
                "Files & assets",
                "Project files and reusable approved material.",
              ],
              [
                "Connections & accounts",
                "Provider and account configuration with explicit readiness.",
              ],
              [
                "Hermes work",
                "Execution history, tool results and pending approvals.",
              ],
              [
                "Live, map & control",
                "Technical projections and guarded operations.",
              ],
              [
                "Trace & releases",
                "Diagnostic evidence, revisions and recovery.",
              ],
              [
                "Project settings",
                "Workspace metadata without changing account authority.",
              ],
            ].map(([title, note]) => (
              <Button
                key={title}
                variant="outline"
                className="h-auto min-h-28 justify-between gap-3 rounded-2xl p-5 text-left whitespace-normal"
                onClick={() =>
                  setDetail({
                    id: title.toLowerCase().replaceAll(" ", "-"),
                    title,
                    type: "tool",
                    status: "Existing tool retained",
                    note,
                    version: "Native / specialist",
                  })
                }
              >
                <div>
                  <span className="block text-base font-medium">{title}</span>
                  <span className="mt-2 block text-sm leading-6 font-normal text-muted-foreground">
                    {note}
                  </span>
                </div>
                <ArrowRight className="size-4 shrink-0" />
              </Button>
            ))}
          </div>
          <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{detail?.title}</SheetTitle>
                <SheetDescription>{detail?.note}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 p-4">
                <Badge variant="outline">Conversion inventory</Badge>
                <p className="text-sm leading-6 text-muted-foreground">
                  The existing specialist workflow is retained. Its controls and
                  state handling will use the same shadcn system where Frank
                  owns them. This review shows its home in navigation, not a
                  finished replacement.
                </p>
                <p className="text-sm text-muted-foreground">
                  No collector, provider connection, release or execution is
                  started here.
                </p>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setDetail(null)}
                >
                  Back to tools
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      {notice && (
        <div
          role="status"
          className="mt-5 rounded-xl border bg-muted/50 p-4 text-sm"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
