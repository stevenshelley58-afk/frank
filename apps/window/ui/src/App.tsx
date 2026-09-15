// Frank's front door: the hub, and one shell for every project.
//
// Layout follows the approved two-menu pattern. The narrow icon rail is the
// project switcher: Frank itself, then every project the owner runs, with Tools
// and Settings at the foot. The secondary menu lists the current project's
// sections when it has more than one. The content pane renders the section.
// Native applications (CRM, Support, Mail, Email flows) render inside the
// content pane through the shared panel host; read models render from
// authorized Frank endpoints; destinations not yet rebuilt here open the
// classic window.
import * as React from "react"
import { LayoutDashboard, Menu, Moon, Settings, Sun, Wrench, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { AdsIsland } from "@/components/ads/AdsIsland"
import { ContentArea, CustomersArea, SettingsArea, ToolsArea } from "@/components/areas/Areas"
import { Hub } from "@/components/hub/Hub"
import { ProjectHome } from "@/components/hub/ProjectHome"
import { NativeHost } from "@/components/native/NativeHost"
import { Overview } from "@/components/overview/Overview"
import { CustomerSection, SourceSection } from "@/components/sources/SourceSection"
import { PROJECTS_URL, useEndpoint, type ProjectsResponse } from "@/lib/api"
import { hrefFor, isNativeSection, useShellRoute, type NavigateOptions, type SectionId } from "@/lib/routes"

type MenuLink = { id: string; label: string; section?: SectionId; href?: string }
type MenuGroup = { id: string; label: string; section?: SectionId; items?: MenuLink[] }

// The current project's sections. Blockwise is the only project with any built
// yet, so this is the secondary menu whenever a Blockwise address is open. A
// group with children is one area with more than one section inside it.
const BLOCKWISE_MENU: MenuGroup[] = [
  { id: "overview", label: "Overview", section: "overview" },
  { id: "ads", label: "Ads", section: "ads" },
  { id: "content", label: "Content", section: "content" },
  {
    id: "crm",
    label: "CRM",
    items: [
      { id: "crm", label: "Leads", section: "crm" },
      { id: "support", label: "Support", section: "support" },
    ],
  },
  { id: "mail", label: "Mail", section: "mail" },
  { id: "campaigns", label: "Email flows", section: "campaigns" },
  { id: "customers", label: "Customers", section: "customers" },
  {
    id: "reports",
    label: "Reports",
    items: [
      { id: "results", label: "Results", section: "results" },
      { id: "revenue", label: "Revenue", section: "revenue" },
      { id: "notifications", label: "Notifications", section: "notifications" },
    ],
  },
]

// Shell-level areas, at the foot of the rail. They belong to Frank rather than
// to any project, and they keep the address they have always had.
const FOOTER_ITEMS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: Settings },
]

const SECTION_LABEL: Record<SectionId, string> = {
  hub: "Frank",
  project: "Project",
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

const SETUP_WORD: Record<string, string> = { ready: "Ready", starting: "Starting", attention: "Needs attention" }
const SETUP_DOT: Record<string, string> = {
  ready: "bg-emerald-500",
  starting: "bg-amber-500",
  attention: "bg-red-500",
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
  const projects = useEndpoint<ProjectsResponse>(PROJECTS_URL, { refreshMs: 120000 })
  const projectList = projects.data?.projects || []
  const currentProject = projectList.find((item) => item.id === route.projectId) || null
  const native = isNativeSection(route.section)
  const fills = native || route.section === "ads"
  const isBlockwise = route.section !== "hub" && route.section !== "project"

  const go = React.useCallback(
    (section: SectionId, options?: NavigateOptions) => {
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
    if (route.section === "hub") document.title = "Frank"
    else if (route.section === "project") document.title = `${currentProject?.name || route.projectId} · Frank`
    else document.title = `${SECTION_LABEL[route.section]} · Frank`
  }, [route.section, route.projectId, currentProject])

  const projectButton = (id: string, name: string, state: string, compact: boolean) => {
    const current = id === route.projectId
    const href = id === "blockwise" ? hrefFor("overview") : hrefFor("project", { projectId: id })
    const word = SETUP_WORD[state] || "Unknown"
    return (
      <Button
        key={id}
        asChild
        variant={current ? "secondary" : "ghost"}
        className={
          compact
            ? `flex h-16 w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[10.5px] leading-[1.1] whitespace-normal ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
            : `h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
        }
      >
        <a
          href={href}
          onClick={(event) => shellClick(event, () => go(id === "blockwise" ? "overview" : "project", id === "blockwise" ? undefined : { projectId: id }))}
          aria-current={current ? "page" : undefined}
          aria-label={`${name}, ${word}`}
        >
          <span className={`size-2.5 shrink-0 rounded-full ${SETUP_DOT[state] || "bg-muted-foreground/40"}`} aria-hidden="true" />
          <span className={compact ? "line-clamp-2 max-w-full text-center" : "flex-1 text-left"}>
            {name}
            {compact ? null : <span className="ml-2 text-xs text-muted-foreground">{word}</span>}
          </span>
        </a>
      </Button>
    )
  }

  const footerButton = (item: { id: SectionId; label: string; icon: LucideIcon }, compact: boolean) => {
    const current = item.id === route.section
    const Icon = item.icon
    return (
      <Button
        key={item.id}
        asChild
        variant={current ? "secondary" : "ghost"}
        className={
          compact
            ? `flex h-16 w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-[10.5px] leading-[1.1] whitespace-normal ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
            : `h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm ${current ? "font-semibold" : "font-normal text-muted-foreground"}`
        }
      >
        <a href={hrefFor(item.id)} onClick={(event) => shellClick(event, () => go(item.id))} aria-current={current ? "page" : undefined} aria-label={compact ? item.label : undefined}>
          <Icon className="size-5" aria-hidden="true" />
          <span className={compact ? "line-clamp-2 max-w-full text-center" : "flex-1 text-left"}>{item.label}</span>
        </a>
      </Button>
    )
  }

  const subLink = (item: MenuLink, className: string) => {
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

  const sectionMenu = (linkClass: string, childClass: string, headingClass: string) => (
    <nav aria-label="Blockwise sections" className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className={headingClass}>Blockwise</div>
      {BLOCKWISE_MENU.map((group) => (
        <React.Fragment key={group.id}>
          {group.section ? (
            subLink({ id: group.id, label: group.label, section: group.section }, linkClass)
          ) : (
            <div className={`${headingClass} pt-3`}>{group.label}</div>
          )}
          {group.items?.map((item) => subLink(item, childClass))}
        </React.Fragment>
      ))}
    </nav>
  )

  const secondary = isBlockwise
    ? sectionMenu(
        "flex h-11 w-full items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
        "ml-3 flex h-11 items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
        "px-3 pt-2 pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase",
      )
    : null

  let content: React.ReactNode = null
  if (route.section === "hub") content = <Hub navigate={go} projects={projects} />
  else if (route.section === "project") content = <ProjectHome projectId={route.projectId} navigate={go} projects={projects} />
  else if (route.section === "overview") content = <Overview navigate={go} />
  else if (route.section === "ads") content = <AdsIsland />
  else if (route.section === "customers") content = <CustomersArea navigate={go} />
  else if (route.section === "customer") content = <CustomerSection customerId={route.customerId} navigate={go} />
  else if (route.section === "content") content = <ContentArea />
  else if (route.section === "tools") content = <ToolsArea />
  else if (route.section === "settings") content = <SettingsArea />
  else if (route.section === "results" || route.section === "revenue" || route.section === "notifications") content = <SourceSection section={route.section} navigate={go} />

  const crumbParent = route.section === "hub" ? "Frank" : route.section === "project" ? currentProject?.name || route.projectId : "Blockwise"
  const crumbLeaf = route.section === "hub" ? "" : SECTION_LABEL[route.section]

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only fixed z-50 bg-background p-4 focus:not-sr-only">
        Skip to content
      </a>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <aside className="hidden w-[84px] shrink-0 flex-col items-center border-r bg-sidebar px-2 py-3 lg:flex" aria-label="Projects">
          <button type="button" className="mb-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => go("hub")} aria-label="Frank home">
            <Mark />
          </button>
          <nav className="flex w-full flex-1 flex-col gap-1 overflow-y-auto">
            {projectList.map((project) => projectButton(project.id, project.name || project.id, project.setup_state, true))}
          </nav>
          <nav className="flex w-full flex-col gap-1 border-t pt-2" aria-label="Tools and settings">
            {FOOTER_ITEMS.map((item) => footerButton(item, true))}
          </nav>
        </aside>
        {secondary ? <aside className="hidden w-56 shrink-0 border-r bg-sidebar/60 lg:block">{secondary}</aside> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-6">
            <Button variant="ghost" size="icon" className="size-11 lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">{crumbParent}</span>
            {crumbLeaf ? (
              <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
                /
              </span>
            ) : null}
            {crumbLeaf ? <span className="truncate text-sm font-medium">{crumbLeaf}</span> : null}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-11" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
              </Button>
            </div>
          </header>
          {route.invalid ? (
            <div className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground" role="status">
              {route.invalid} Showing the hub.
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
            <SheetDescription>Every project, and the tools that belong to Frank itself.</SheetDescription>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3" aria-label="Projects">
            <Button
              asChild
              variant={route.section === "hub" ? "secondary" : "ghost"}
              className={`h-11 w-full justify-start gap-3 rounded-xl px-3 text-sm ${route.section === "hub" ? "font-semibold" : "font-normal text-muted-foreground"}`}
            >
              <a href={hrefFor("hub")} onClick={(event) => shellClick(event, () => go("hub"))} aria-current={route.section === "hub" ? "page" : undefined}>
                <LayoutDashboard className="size-5" aria-hidden="true" />
                <span className="flex-1 text-left">Frank</span>
              </a>
            </Button>
            {projectList.map((project) => projectButton(project.id, project.name || project.id, project.setup_state, false))}
          </nav>
          {isBlockwise
            ? sectionMenu(
                "flex h-11 w-full items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
                "ml-3 flex h-11 items-center rounded-xl px-3 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
                "px-3 pt-2 pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase",
              )
            : null}
          <nav className="flex flex-col gap-1 border-t p-3" aria-label="Tools and settings">
            {FOOTER_ITEMS.map((item) => footerButton(item, false))}
          </nav>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
