import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export interface AppShellPage {
  id: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface AppShellProps {
  pages: AppShellPage[];
  activePageId: string;
  onNavigate: (pageId: string) => void;
  children: React.ReactNode;
}

export function AppShell({ pages, activePageId, onNavigate, children }: AppShellProps) {
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0]!;

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[var(--frank-sidebar-width)_minmax(0,1fr)]">
        <aside className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="flex min-h-[var(--frank-topbar-height)] items-center gap-3 border-b border-sidebar-border px-4 lg:px-5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                FH
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5">Frank Hub</p>
                <p className="truncate text-xs leading-5 text-muted-foreground">Control plane</p>
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:grid lg:overflow-visible lg:px-3" aria-label="Primary navigation">
              {pages.map((page) => {
                const Icon = page.icon;
                const isActive = page.id === activePage.id;

                return (
                  <button
                    key={page.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onNavigate(page.id)}
                    className={cn(
                      "inline-flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring lg:w-full",
                      isActive
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{page.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-[var(--frank-topbar-height)] flex-col justify-center gap-3 border-b border-border bg-background/95 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Frank Hub</p>
              <h1 className="mt-1 text-2xl font-semibold leading-8 text-foreground">{activePage.title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{activePage.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="gap-1.5">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Cloudflare Access
              </Badge>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto grid w-full max-w-[var(--frank-content-max)] gap-5">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
