import * as React from "react"
import {
  Activity,
  BarChart3,
  Database,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Megaphone,
  Moon,
  Palette,
  Search,
  Settings,
  Sun,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { ComponentGallery } from "@/components/frank/component-gallery"
import { OwnerOverview } from "@/components/frank/owner-overview"

/* Frank's mark: black glyph plus the one red slash. Unchanged. */
function FrankMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 88 87" fill="none" className={className} aria-hidden>
      <path fill="currentColor" d="M8 10.5 16 8h66l-8.5 14.5H27V85H8V10.5Z" />
      <path fill="#E53C1F" d="M39 41h29l-9 16H30l9-16Z" />
    </svg>
  )
}

const SOURCE_NAV = [
  { name: "Mail", icon: Mail, badge: "3" },
  { name: "CRM", icon: Search, badge: "4" },
  { name: "Support", icon: LifeBuoy },
  { name: "Campaigns", icon: Megaphone },
  { name: "Revenue", icon: Wallet },
  { name: "Results", icon: BarChart3 },
]

const APP_NAV = [
  { name: "Ad Radar", icon: Activity },
  { name: "Ad database", icon: Database },
  { name: "Blog Studio", icon: FileText },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [systemDark, setSystemDark] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && systemDark)
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

export function App() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild>
                  <a href="#" className="flex items-center gap-2">
                    <FrankMark className="size-6 shrink-0" />
                    <span className="font-heading text-base font-semibold tracking-tight">
                      Frank
                    </span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive tooltip="Overview">
                      <LayoutDashboard />
                      <span>Overview</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Design system">
                      <Palette />
                      <span>Design system</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Sources</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {SOURCE_NAV.map((s) => (
                    <SidebarMenuItem key={s.name}>
                      <SidebarMenuButton tooltip={s.name}>
                        <s.icon />
                        <span>{s.name}</span>
                      </SidebarMenuButton>
                      {s.badge ? <SidebarMenuBadge>{s.badge}</SidebarMenuBadge> : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Applications</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {APP_NAV.map((s) => (
                    <SidebarMenuItem key={s.name}>
                      <SidebarMenuButton tooltip={s.name}>
                        <s.icon />
                        <span>{s.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-1 h-5" />
            <span className="text-sm font-medium">Blockwise</span>
            <Badge variant="outline" className="ml-1 gap-1.5">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />5 of 7
              connected
            </Badge>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 p-6">
            <Tabs defaultValue="overview">
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Owner overview</TabsTrigger>
                <TabsTrigger value="system">Design system</TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <OwnerOverview />
              </TabsContent>
              <TabsContent value="system">
                <ComponentGallery />
              </TabsContent>
            </Tabs>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export default App
