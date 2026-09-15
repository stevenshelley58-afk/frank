// Shell-only areas.
//
// Customers lists the real people the connected sources know about and opens
// each one in the application that owns the record. Content, Tools and
// Settings group the destinations that still render in the classic Frank
// window; each of those is a full navigation, labelled as such, until the view
// is converted into this shell.
import * as React from "react"
import { ArrowUpRight, ExternalLink, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"
import { SOURCES_URL, useEndpoint, type SourceItem, type SourcesResponse } from "@/lib/api"
import { ItemRow, StatusBadge, Unavailable } from "@/components/sources/source-ui"
import { CONTENT_LINKS, TOOL_LINKS, type LegacyLink } from "@/lib/legacy-links"
import type { Navigate } from "@/lib/targets"

export function LinkList({ links, note }: { links: LegacyLink[]; note?: string }) {
  return (
    <div>
      <ul className="divide-y rounded-2xl border">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{link.label}</div>
                <div className="text-sm text-muted-foreground">{link.detail}</div>
              </div>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}

function AreaFrame({ title, purpose, children }: { title: string; purpose: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{purpose}</p>
      </div>
      {children}
    </div>
  )
}

const CLASSIC_NOTE = "These open in the classic Frank window until each one is rebuilt here."

// On a wide screen the secondary menu already lists these destinations, so
// the pane only repeats them where there is no secondary menu.
export function ContentArea() {
  return (
    <AreaFrame title="Content" purpose="Blogs, templates, research and assets.">
      <p className="hidden text-sm text-muted-foreground lg:block">{CLASSIC_NOTE} Pick one from the menu.</p>
      <div className="lg:hidden">
        <LinkList links={CONTENT_LINKS} note={CLASSIC_NOTE} />
      </div>
    </AreaFrame>
  )
}

export function ToolsArea() {
  return (
    <AreaFrame title="Tools" purpose="Chats, files, connections and the technical surfaces.">
      <p className="hidden text-sm text-muted-foreground lg:block">{CLASSIC_NOTE} Pick one from the menu.</p>
      <div className="lg:hidden">
        <LinkList links={TOOL_LINKS} note={CLASSIC_NOTE} />
      </div>
    </AreaFrame>
  )
}

export function SettingsArea() {
  const { theme, setTheme } = useTheme()
  return (
    <AreaFrame title="Settings" purpose="How Frank looks on this device.">
      <div className="rounded-2xl border p-4">
        <div className="text-sm font-medium">Appearance</div>
        <p className="mt-1 text-sm text-muted-foreground">Stored on this device only.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["light", "dark", "system"] as const).map((value) => (
            <Button key={value} variant={theme === value ? "secondary" : "outline"} className="h-10 gap-2 capitalize" onClick={() => setTheme(value)} aria-pressed={theme === value}>
              {value === "dark" ? <Moon className="size-4" aria-hidden="true" /> : value === "light" ? <Sun className="size-4" aria-hidden="true" /> : null}
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-6">
        <LinkList links={[{ href: "/accounts", label: "Accounts", detail: "Account records the connections use." }, { href: "/connections", label: "Connections", detail: "Provider connections and their status." }]} note={CLASSIC_NOTE} />
      </div>
    </AreaFrame>
  )
}

const PEOPLE_SOURCES = ["crm", "support"] as const

export function CustomersArea({ navigate }: { navigate: Navigate }) {
  const sources = useEndpoint<SourcesResponse>(SOURCES_URL, { refreshMs: 60000 })
  const groups = PEOPLE_SOURCES.map((id) => ({ id, payload: sources.data?.sources[id] || null }))
  const total = groups.reduce((n, g) => n + (g.payload?.items.length || 0), 0)
  return (
    <AreaFrame title="Customers" purpose="People the connected sources know about. Each record opens in the application that owns it; Frank does not keep a second copy.">
      {sources.state === "loading" && !sources.data ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ id, payload }) => (
            <section key={id} aria-labelledby={`people-${id}`}>
              <div className="mb-3 flex items-center gap-3">
                <h2 id={`people-${id}`} className="text-lg font-semibold">
                  {id === "crm" ? "Leads" : "Support tickets"}
                </h2>
                {payload ? <StatusBadge status={payload.status} /> : null}
              </div>
              {payload && payload.items.length ? (
                <ul className="divide-y rounded-2xl border px-4">
                  {payload.items.map((item: SourceItem) => (
                    <ItemRow key={item.id} item={item} navigate={navigate} />
                  ))}
                </ul>
              ) : (
                <Unavailable title={payload ? (payload.status === "unavailable" ? "Not connected" : "Nothing recent") : "Not read"} detail={payload?.summary || payload?.detail || sources.error || ""}>
                  <Button variant="secondary" className="h-10 gap-1" onClick={() => navigate(id)}>
                    Open {id === "crm" ? "CRM" : "Support"}
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </Unavailable>
              )}
            </section>
          ))}
          {total === 0 && sources.state === "ready" ? <p className="text-xs text-muted-foreground">Only the recent window each source reports is listed here. The full record set lives in the application.</p> : null}
        </div>
      )}
    </AreaFrame>
  )
}
