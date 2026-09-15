import * as React from "react"
import {
  Bell,
  LayoutDashboard,
  Megaphone,
  Mail,
  Users,
  FileText,
  BarChart3,
  Settings,
  Search,
  Menu,
  Moon,
  Sun,
  ArrowRight,
  Check,
  Clock,
  AlertCircle,
  ChevronRight,
  Briefcase,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"
import { AdsWorkspace } from "@/components/owner/AdsWorkspace"
import { AppsWorkspace } from "@/components/owner/AppsWorkspace"

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "ads", label: "Ads", icon: Megaphone },
  { id: "content", label: "Content", icon: FileText },
  { id: "crm", label: "CRM", icon: Users },
  { id: "mail", label: "Mail", icon: Mail },
  { id: "email", label: "Email flows", icon: ArrowRight },
  { id: "customers", label: "Customers", icon: Briefcase },
  { id: "reports", label: "Reports", icon: BarChart3 },
]
type Work = {
  id: string
  title: string
  reason: string
  app: string
  sub: string
  kind: string
  age: string
  seen: boolean
  done: boolean
  snoozed: boolean
}
const initialWork: Work[] = [
  {
    id: "ticket-101",
    title: "A customer needs help connecting Meta",
    reason: "Support ticket awaiting your reply",
    app: "crm",
    sub: "support",
    kind: "Urgent",
    age: "35 min ago",
    seen: false,
    done: false,
    snoozed: false,
  },
  {
    id: "ads-101",
    title: "Review the September lead campaign",
    reason: "Three example ads are ready for your review",
    app: "ads",
    sub: "queue",
    kind: "Today",
    age: "1 hour ago",
    seen: false,
    done: false,
    snoozed: false,
  },
  {
    id: "lead-101",
    title: "Follow up with Example Agency",
    reason: "Requested a walkthrough of Blockwise",
    app: "crm",
    sub: "leads",
    kind: "Today",
    age: "2 hours ago",
    seen: false,
    done: false,
    snoozed: false,
  },
  {
    id: "mail-101",
    title: "Reply to the onboarding question",
    reason: "A customer has replied to your email",
    app: "mail",
    sub: "inbox",
    kind: "Today",
    age: "2 hours ago",
    seen: false,
    done: false,
    snoozed: false,
  },
  {
    id: "content-101",
    title: "Review: Turn local expertise into your next lead",
    reason: "Draft and source checks ready to review",
    app: "content",
    sub: "blogs",
    kind: "Today",
    age: "3 hours ago",
    seen: false,
    done: false,
    snoozed: false,
  },
  {
    id: "task-101",
    title: "Prepare tomorrow’s customer call",
    reason: "Follow-up task due tomorrow",
    app: "crm",
    sub: "tasks",
    kind: "Later",
    age: "Tomorrow",
    seen: false,
    done: false,
    snoozed: false,
  },
]
function getRoute() {
  const q = new URLSearchParams(location.search)
  return { section: q.get("section") || "overview", sub: q.get("view") || "" }
}
function Mark() {
  return (
    <svg viewBox="0 0 88 87" className="size-7" aria-hidden="true">
      <path fill="currentColor" d="M8 10.5 16 8h66l-8.5 14.5H27V85H8V10.5Z" />
      <path fill="#E53C1F" d="M39 41h29l-9 16H30l9-16Z" />
    </svg>
  )
}
export default function App() {
  const [route, setRoute] = React.useState(getRoute)
  const [mobile, setMobile] = React.useState(false)
  const [alerts, setAlerts] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState("all")
  const [detail, setDetail] = React.useState<Work | null>(null)
  const [work, setWork] = React.useState<Work[]>(() => {
    try {
      const d = JSON.parse(
        sessionStorage.getItem("frank.ui-review.actions.v1") || "null"
      )
      return Array.isArray(d) && d.length === initialWork.length
        ? d
        : initialWork
    } catch {
      return initialWork
    }
  })
  const { theme, setTheme } = useTheme()
  React.useEffect(() => {
    sessionStorage.setItem("frank.ui-review.actions.v1", JSON.stringify(work))
  }, [work])
  React.useEffect(() => {
    const cb = () => setRoute(getRoute())
    const kb = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener("popstate", cb)
    window.addEventListener("keydown", kb)
    return () => {
      window.removeEventListener("popstate", cb)
      window.removeEventListener("keydown", kb)
    }
  }, [])
  function navigate(section: string, sub = "") {
    const q = new URLSearchParams()
    q.set("section", section)
    if (sub) q.set("view", sub)
    history.pushState({}, "", `${location.pathname}?${q}`)
    setRoute({ section, sub })
    setMobile(false)
    setSearchOpen(false)
    setQuery("")
    document.querySelector("main")?.scrollTo({ top: 0 })
  }
  function change(id: string, patch: Partial<Work>) {
    setWork((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setDetail((d) => (d?.id === id ? { ...d, ...patch } : d))
  }
  const pending = work.filter((w) => !w.done && !w.snoozed)
  const count = (app: string) => pending.filter((w) => w.app === app).length
  const label =
    [
      ...NAV,
      { id: "settings", label: "Settings" },
      { id: "tools", label: "Tools" },
    ].find((n) => n.id === route.section)?.label || "Overview"
  const badge = (n: number) =>
    n > 0 ? (
      <Badge
        className="min-w-5 justify-center rounded-full bg-foreground px-1.5 text-[11px] text-background"
        aria-label={`${n} example actions`}
      >
        {n}
      </Badge>
    ) : null
  const navigation = (
    <>
      <div className="flex h-20 items-center gap-3 px-6">
        <div className="relative">
          <Mark />
          {pending.length > 0 && (
            <span
              className="absolute -top-2 -right-2 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
              aria-label={`${pending.length} example actions`}
            >
              {pending.length}
            </span>
          )}
        </div>
        <div>
          <div className="text-lg font-semibold tracking-tight">Frank</div>
          <div className="text-xs text-muted-foreground">
            Blockwise workspace
          </div>
        </div>
      </div>
      <nav aria-label="Workspace" className="flex-1 space-y-1 px-3">
        {NAV.map((n) => (
          <Button
            key={n.id}
            variant={route.section === n.id ? "secondary" : "ghost"}
            className={`h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm ${route.section === n.id ? "font-semibold" : "font-normal text-muted-foreground"}`}
            onClick={() => navigate(n.id)}
            aria-current={route.section === n.id ? "page" : undefined}
          >
            <n.icon className="size-4" />
            <span className="flex-1 text-left">{n.label}</span>
            {badge(count(n.id))}
          </Button>
        ))}
      </nav>
      <div className="space-y-1 border-t p-3">
        <Button
          variant="ghost"
          className="h-11 w-full justify-start gap-3 text-muted-foreground"
          onClick={() => navigate("tools")}
        >
          <Wrench className="size-4" />
          Tools
        </Button>
        <Button
          variant="ghost"
          className="h-11 w-full justify-start gap-3 text-muted-foreground"
          onClick={() => navigate("settings")}
        >
          <Settings className="size-4" />
          Settings
        </Button>
        <div className="px-3 pt-3 text-xs text-muted-foreground">
          Owner workspace · UI review
        </div>
      </div>
    </>
  )
  function openWork(w: Work) {
    change(w.id, { seen: true })
    setDetail(w)
  }
  return (
    <TooltipProvider>
      <a
        href="#main"
        className="sr-only fixed z-50 bg-background p-4 focus:not-sr-only"
      >
        Skip to content
      </a>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
          {navigation}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-7">
            <Button
              variant="ghost"
              size="icon"
              className="size-11 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Blockwise
            </span>
            <ChevronRight className="hidden size-3 text-muted-foreground sm:block" />
            <span className="text-sm font-medium">{label}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                className="size-11 p-0 md:w-32 md:gap-2"
                aria-label="Search workspace"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4" />
                <span className="hidden text-muted-foreground md:inline">
                  Search
                </span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative size-11"
                    aria-label={`Open alerts, ${pending.length} example actions`}
                    onClick={() => setAlerts(true)}
                  >
                    <Bell className="size-5" />
                    {pending.length > 0 && (
                      <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">
                        {pending.length}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Needs your attention</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Toggle theme"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </Button>
            </div>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/35 px-5 py-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="bg-background">
              UI preview
            </Badge>
            <span>
              Sample data. No services connected. Nothing sends or spends.
            </span>
          </div>
          <main
            id="main"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto pb-24 outline-none lg:pb-8"
          >
            <div
              className={
                "mx-auto py-7 md:py-9 " +
                (["crm", "mail", "email"].includes(route.section)
                  ? "max-w-none px-3 md:px-4"
                  : "max-w-[1360px] px-4 md:px-8")
              }
            >
              {route.section === "overview" ? (
                <>
                  <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight">
                        Your work, in one place.
                      </h1>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {pending.length} things need your attention. Start with
                        what matters.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="h-11 rounded-xl"
                      onClick={() => setAlerts(true)}
                    >
                      View all alerts {badge(pending.length)}
                    </Button>
                  </div>
                  <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
                    <section className="min-w-0">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">
                          Needs attention
                        </h2>
                        <Tabs value={filter} onValueChange={setFilter}>
                          <TabsList className="h-11">
                            <TabsTrigger value="all" className="min-h-9">
                              All
                            </TabsTrigger>
                            <TabsTrigger value="Urgent" className="min-h-9">
                              Urgent
                            </TabsTrigger>
                            <TabsTrigger value="Today" className="min-h-9">
                              Today
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                      </div>
                      <div className="overflow-hidden rounded-2xl border">
                        {pending
                          .filter((w) => filter === "all" || w.kind === filter)
                          .map((w) => (
                            <div
                              key={w.id}
                              className="flex flex-wrap items-center gap-3 border-b p-5 last:border-b-0 sm:flex-nowrap"
                            >
                              <div
                                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${w.kind === "Urgent" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted text-muted-foreground"}`}
                              >
                                {w.kind === "Urgent" ? (
                                  <AlertCircle className="size-4" />
                                ) : (
                                  <Clock className="size-4" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <Button
                                  variant="link"
                                  className="h-auto p-0 text-left text-sm leading-6 font-medium whitespace-normal"
                                  onClick={() => openWork(w)}
                                >
                                  {w.title}
                                </Button>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                  {w.reason}
                                </p>
                                <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
                                  <span>
                                    {NAV.find((n) => n.id === w.app)?.label}
                                  </span>
                                  <span>·</span>
                                  <span>{w.age}</span>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                className="ml-[52px] h-11 shrink-0 rounded-xl sm:ml-0"
                                onClick={() => openWork(w)}
                              >
                                Review
                              </Button>
                            </div>
                          ))}
                        {pending.filter(
                          (w) => filter === "all" || w.kind === filter
                        ).length === 0 && (
                          <div className="px-6 py-12 text-center">
                            <Check className="mx-auto mb-3 size-6 text-muted-foreground" />
                            <h3 className="font-medium">
                              Nothing needs your attention here
                            </h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                              Completed examples stay in your alert history.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                    <aside>
                      <h2 className="mb-4 text-lg font-semibold">Workspace</h2>
                      <div className="rounded-2xl border px-5">
                        {[
                          {
                            title: "Meta campaigns",
                            note: "Manage ads and review drafts",
                            app: "ads",
                          },
                          {
                            title: "CRM & support",
                            note: "One home for customer work",
                            app: "crm",
                          },
                          {
                            title: "Content studio",
                            note: "Blogs, templates and video",
                            app: "content",
                          },
                          {
                            title: "Customer operations",
                            note: "Accounts, billing and access",
                            app: "customers",
                          },
                        ].map((x) => (
                          <Button
                            key={x.app}
                            variant="ghost"
                            className="h-auto w-full justify-between rounded-none border-b px-0 py-5 text-left whitespace-normal last:border-b-0"
                            onClick={() => navigate(x.app)}
                          >
                            <span>
                              <span className="block text-sm font-medium">
                                {x.title}
                              </span>
                              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                {x.note}
                              </span>
                            </span>
                            <ChevronRight className="size-4 shrink-0" />
                          </Button>
                        ))}
                      </div>
                      <div className="mt-6 rounded-2xl bg-muted/50 p-5">
                        <h3 className="text-sm font-medium">
                          Made for your daily work
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Reports and service details stay one click away. Your
                          next action stays here.
                        </p>
                        <Button
                          variant="link"
                          className="mt-2 h-11 px-0"
                          onClick={() => navigate("reports")}
                        >
                          Open reports <ArrowRight className="ml-2 size-4" />
                        </Button>
                      </div>
                    </aside>
                  </div>
                </>
              ) : route.section === "ads" ? (
                <AdsWorkspace subsection={route.sub} onNavigate={navigate} />
              ) : (
                <AppsWorkspace
                  key={route.section}
                  section={route.section}
                  subsection={route.sub}
                  onNavigate={navigate}
                  onExampleReviewed={(id) => {
                    if (id === "blog-101")
                      change("content-101", { done: true, seen: true })
                  }}
                />
              )}
            </div>
          </main>
          <nav
            aria-label="Mobile shortcuts"
            className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-background px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] lg:hidden"
          >
            {[
              { label: "Home", icon: LayoutDashboard, id: "overview" },
              { label: "Ads", icon: Megaphone, id: "ads" },
              { label: "Alerts", icon: Bell, id: "alerts" },
              { label: "More", icon: Menu, id: "more" },
            ].map((n) => (
              <Button
                key={n.id}
                variant="ghost"
                className={`relative h-14 min-w-16 flex-col gap-1 text-xs ${route.section === n.id ? "bg-muted" : ""}`}
                onClick={() =>
                  n.id === "alerts"
                    ? setAlerts(true)
                    : n.id === "more"
                      ? setMobile(true)
                      : navigate(n.id)
                }
              >
                <n.icon className="size-5" />
                {n.label}
                {n.id === "alerts" && pending.length > 0 && (
                  <span className="absolute top-1 right-3 size-2 rounded-full bg-red-600" />
                )}
              </Button>
            ))}
          </nav>
        </div>
      </div>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Choose an app in Blockwise</SheetDescription>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>
      <Sheet open={alerts} onOpenChange={setAlerts}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              Needs your attention {badge(pending.length)}
            </SheetTitle>
            <SheetDescription>
              Preview alerts. Reading an alert does not complete the work.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {work.map((w) => (
              <div key={w.id} className="border-b py-5">
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-2 size-1.5 shrink-0 rounded-full ${!w.seen && !w.done ? "bg-blue-600" : "bg-transparent"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{w.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {w.reason}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {w.done ? "Completed" : w.snoozed ? "Snoozed" : w.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {w.age}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="h-11"
                        onClick={() => {
                          setAlerts(false)
                          openWork(w)
                        }}
                      >
                        Open
                      </Button>
                      {!w.seen && (
                        <Button
                          variant="ghost"
                          className="h-11"
                          onClick={() => change(w.id, { seen: true })}
                        >
                          Mark seen
                        </Button>
                      )}
                      {!w.done && (
                        <Button
                          variant="ghost"
                          className="h-11"
                          onClick={() => change(w.id, { snoozed: !w.snoozed })}
                        >
                          {w.snoozed ? "Restore" : "Snooze example"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              className="mt-4 h-11"
              onClick={() => setWork(initialWork)}
            >
              Reset sample alerts
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{detail?.title}</SheetTitle>
            <SheetDescription>{detail?.reason}</SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="space-y-6 p-4">
              <div className="flex gap-2">
                <Badge variant="outline">{detail.kind}</Badge>
                <Badge variant="secondary">Example record</Badge>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                This is the action handoff. The finished workspace will open the
                exact record in its owning app. This preview lets you review the
                navigation and completion feedback without changing real work.
              </p>
              <dl className="grid grid-cols-[100px_1fr] gap-3 text-sm">
                <dt className="text-muted-foreground">Owner app</dt>
                <dd>{NAV.find((n) => n.id === detail.app)?.label}</dd>
                <dt className="text-muted-foreground">Section</dt>
                <dd className="capitalize">{detail.sub || "Inbox"}</dd>
                <dt className="text-muted-foreground">Example ID</dt>
                <dd>{detail.id}</dd>
              </dl>
              <Button
                className="h-11 w-full rounded-xl"
                onClick={() => {
                  navigate(detail.app, detail.sub)
                  setDetail(null)
                }}
              >
                Open {NAV.find((n) => n.id === detail.app)?.label}{" "}
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl"
                onClick={() => {
                  change(detail.id, { done: !detail.done, seen: true })
                  setDetail(null)
                }}
              >
                {detail.done ? "Reopen example" : "Complete example"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Preview only. No reply, approval or change is sent.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Find your workspace</DialogTitle>
            <DialogDescription>
              Search apps and example work. Ctrl K opens this menu.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search apps"
            placeholder="Search apps or work…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11"
          />
          <div className="max-h-80 overflow-auto">
            {NAV.filter((n) =>
              n.label.toLowerCase().includes(query.toLowerCase())
            ).map((n) => (
              <Button
                variant="ghost"
                key={n.id}
                className="h-12 w-full justify-start gap-3"
                onClick={() => navigate(n.id)}
              >
                <n.icon className="size-4" />
                {n.label}
              </Button>
            ))}
            {work
              .filter(
                (w) =>
                  query && w.title.toLowerCase().includes(query.toLowerCase())
              )
              .map((w) => (
                <Button
                  key={w.id}
                  variant="ghost"
                  className="h-auto min-h-12 w-full justify-start text-left whitespace-normal"
                  onClick={() => {
                    setSearchOpen(false)
                    openWork(w)
                  }}
                >
                  {w.title}
                </Button>
              ))}
            {query &&
              !NAV.some((n) =>
                n.label.toLowerCase().includes(query.toLowerCase())
              ) &&
              !work.some((w) =>
                w.title.toLowerCase().includes(query.toLowerCase())
              ) && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No matching apps or work.
                </p>
              )}
          </div>
        </DialogContent>
      </Dialog>
      <div aria-live="polite" className="sr-only">
        {pending.length} example actions need attention.
      </div>
    </TooltipProvider>
  )
}
