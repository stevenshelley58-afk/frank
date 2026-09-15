// Frank's front door: the owner workspace shell.
//
// Layout follows the approved two-menu pattern: a narrow icon rail names the
// areas, a secondary menu lists the sections inside the current area when it
// has more than one, and the content pane renders the section. Native
// applications (CRM, Support, Mail, Email flows) render inside the content
// pane through the shared panel host; read models render from authorized
// Frank endpoints; destinations not yet rebuilt here open the classic window.
import * as React from "react"
import { BarChart3, Briefcase, FileText, LayoutDashboard, Mail, Megaphone, Menu, Moon, Send, Settings, Sun, Users, Wrench, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { AdsIsland } from "@/components/ads/AdsIsland"
import { ContentArea, CustomersArea, SettingsArea, ToolsArea } from "@/components/areas/Areas"
import { CONTENT_LINKS, TOOL_LINKS, type LegacyLink } from "@/lib/legacy-links"
import { NativeHost } from "@/components/native/NativeHost"
import { Overview } from "@/components/overview/Overview"
import { CustomerSection, SourceSection } from "@/components/sources/SourceSection"
import { hrefFor, isNativeSection, useShellRoute, type SectionId } from "@/lib/routes"

type AreaId = "overview" | "ads" | "content" | "crm" | "mail" | "campaigns" | "customers" | "reports" | "tools" | "settings"

type SubItem = { id: string; label: string; section?: SectionId; href?: string }

type Area = {
  id: AreaId
  label: string
  icon: LucideIcon
  section: SectionId
  items?: SubItem[]
}

const AREAS: Area[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, section: "overview" },
  { id: "ads", label: "Ads", icon: Megaphone, section: "ads" },
  { id: "content", label: "Content", icon: FileText, section: "content", items: CONTENT_LINKS.map(linkItem) },
  {
    id: "crm",
    label: "CRM",
    icon: Users,
    section: "crm",
    items: [
      { id: "crm", label: "Leads", section: "crm" },
      { id: "support", label: "Support", section: "support" },
    ],
  },
  { id: "mail", label: "Mail", icon: Mail, section: "mail" },
  { id: "campaigns", label: "Email flows", icon: Send, section: "campaigns" },
  { id: "customers", label: "Customers", icon: Briefcase, section: "customers" },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    section: "results",
    items: [
      { id: "results", label: "Results", section: "results" },
      { id: "revenue", label: "Revenue", section: "revenue" },
      { id: "notifications", label: "Notifications", section: "notifications" },
    ],
  },
]
const FOOTER_AREAS: Area[] = [
  { id: "tools", label: "Tools", icon: Wrench, section: "tools", items: TOOL_LINKS.map(linkItem) },
  { id: "settings", label: "Settings", icon: Settings, section: "settings" },
]

function linkItem(link: LegacyLink): SubItem {
  return { id: link.href, label: link.label, href: link.href }
}

const SECTION_AREA: Record<SectionId, AreaId> = {
  overview: "overview",
  ads: "ads",
  content: "content",
  crm: "crm",
  support: "crm",
  mail: "mail",
  campaigns: "campaigns",
  customers: "customers",
  customer: "customers",
  results: "reports",
  revenue: "reports",
  notifications: "reports",
  tools: "tools",
  settings: "settings",
}

const SECTION_LABEL: Record<SectionId, string> = {
  overview: "Overview",
  ads: "Ads",
  content: "Content",
  crm: "Leads",
  support: "Support",
  mail: "Mail",
  campaigns: "Email flows",
  customers: "Customers",
  customer: "Customer",
  results: "Results",
  revenue: "Revenue",
  notifications: "Notifications",
  tools: "Tools",
  settings: "Settings",
}

/** A plain left click navigates in the shell; modified clicks keep the browser's own behaviour. */
function shellClick(event: React.MouseEvent<HTMLAnchorElement>, open: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  open()
}

function Mark() {
  return (
    <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background" aria-hidden="true">
      <span className="text-base font-bold leading-none">F</span>
    </span>
  )
}

export default function App() {
  const { route, navigate } = useShellRoute()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const { theme, setTheme } = useTheme()
  const areaId = SECTION_AREA[route.section]
  const area = [...AREAS, ...FOOTER_AREAS].find((a) => a.id === areaId) || AREAS[0]
  const native = isNativeSection(route.section)
  const fills = native || route.section === "ads"

  const go = React.useCallback(
    (section: SectionId, options?: { customerId?: string; appPath?: string; replace?: boolean }) => {
      navigate(section, options)
      setMobileOpen(false)
      document.getElementById("main")?.scrollTo({ top: 0 })
    },
    [navigate],
  )

  // The panel host may settle on a different application than the route asked
  // for (a protected panel kept open). Follow what is actually on screen.
  const onActiveChange = React.useCallback(
    (active: string | null) => {
      if (active && isNativeSection(active as SectionId) && active !== route.section) navigate(active as SectionId, { replace: true })
    },
    [navigate, route.section],
  )

  React.useEffect(() => {
    document.title = route.section === "overview" ? "Frank" : `${SECTION_LABEL[route.section]} · Frank`
  }, [route.section])

  const railButton = (a: Area, compact: boolean) => {
    const current = a.id === areaId
    const Icon = a.icon
    return (
      <Button
        key={a.id}
        asChild
        variant={current ? "secondary" : "ghost"}
        className={
          compact
            ? `flex h-16 w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[10.5px] leading-[1.1] whitespace-normal ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
            : `h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
        }
      >
        <a href={hrefFor(a.section)} onClick={(event) => shellClick(event, () => go(a.section))} aria-current={current ? "page" : undefined} aria-label={compact ? a.label : undefined}>
          <Icon className="size-5" aria-hidden="true" />
          <span className={compact ? "line-clamp-2 max-w-full text-center" : "flex-1 text-left"}>{a.label}</span>
        </a>
      </Button>
    )
  }

  const subLink = (item: SubItem, className: string) => {
    if (item.href) {
      return (
        <a key={item.id} href={item.href} className={`${className} text-muted-foreground`}>
          {item.label}
        </a>
      )
    }
    const section = item.section
    if (!section) return null
    const current = section === route.section
    return (
      <Button key={item.id} asChild variant={current ? "secondary" : "ghost"} className={`${className} justify-start ${current ? "font-semibold" : "font-normal text-muted-foreground"}`}>
        <a href={hrefFor(section)} onClick={(event) => shellClick(event, () => go(section))} aria-current={current ? "page" : undefined}>
          {item.label}
        </a>
      </Button>
    )
  }

  const subItems = area.items || []
  const secondary = subItems.length > 0 && (
    <nav aria-label={`${area.label} sections`} className="flex h-full flex-col gap-1 p-3">
      <div className="px-3 pt-2 pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{area.label}</div>
      {subItems.map((item) => subLink(item, "flex h-11 w-full items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60"))}
    </nav>
  )

  let content: React.ReactNode = null
  if (route.section === "overview") content = <Overview navigate={go} />
  else if (route.section === "ads") content = <AdsIsland />
  else if (route.section === "customers") content = <CustomersArea navigate={go} />
  else if (route.section === "customer") content = <CustomerSection customerId={route.customerId} navigate={go} />
  else if (route.section === "content") content = <ContentArea />
  else if (route.section === "tools") content = <ToolsArea />
  else if (route.section === "settings") content = <SettingsArea />
  else if (route.section === "results" || route.section === "revenue" || route.section === "notifications") content = <SourceSection section={route.section} navigate={go} />

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only fixed z-50 bg-background p-4 focus:not-sr-only">
        Skip to content
      </a>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside className="hidden w-[84px] shrink-0 flex-col items-center border-r bg-sidebar px-2 py-3 lg:flex" aria-label="Areas">
          <button type="button" className="mb-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => go("overview")} aria-label="Frank overview">
            <Mark />
          </button>
          <nav className="flex w-full flex-1 flex-col gap-1">{AREAS.map((a) => railButton(a, true))}</nav>
          <nav className="flex w-full flex-col gap-1 border-t pt-2" aria-label="Tools and settings">
            {FOOTER_AREAS.map((a) => railButton(a, true))}
          </nav>
        </aside>
        {secondary ? <aside className="hidden w-56 shrink-0 border-r bg-sidebar/60 lg:block">{secondary}</aside> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-6">
            <Button variant="ghost" size="icon" className="size-11 lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">Blockwise</span>
            <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
              /
            </span>
            <span className="truncate text-sm font-medium">{SECTION_LABEL[route.section]}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-11" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
              </Button>
            </div>
          </header>
          {route.invalid ? (
            <div className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground" role="status">
              {route.invalid} Showing the overview.
            </div>
          ) : null}
          <main id="main" tabIndex={-1} className={`flex min-h-0 min-w-0 flex-1 flex-col outline-none ${fills ? "overflow-hidden" : "overflow-y-auto"}`}>
            <NativeHost section={route.section} appPath={route.appPath} visible={native} onActiveChange={onActiveChange} onAnnounce={setAnnouncement} />
            {content}
          </main>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[300px] overflow-y-auto p-0">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle className="flex items-center gap-3">
              <Mark />
              Frank
            </SheetTitle>
            <SheetDescription>Blockwise workspace</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3" aria-label="Areas">
            {AREAS.map((a) => (
              <React.Fragment key={a.id}>
                {railButton(a, false)}
                {a.items && a.id === areaId
                  ? a.items.map((item) => subLink(item, "ml-9 flex h-11 items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60"))
                  : null}
              </React.Fragment>
            ))}
          </nav>
          <nav className="flex flex-col gap-1 border-t p-3" aria-label="Tools and settings">
            {FOOTER_AREAS.map((a) => railButton(a, false))}
          </nav>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
