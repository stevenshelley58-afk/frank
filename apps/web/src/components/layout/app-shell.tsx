import { useEffect, useState } from "react";
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CheckCircle2,
  ChevronsUpDown,
  Menu,
  Settings as SettingsIcon
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import { titleize } from "../../lib/format.js";
import { listTasks, type Task } from "../../api.js";
import { StatusPill } from "../status/status-pill.js";
import { SidebarSection } from "./sidebar-section.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/index.js";

export interface AppShellPage {
  id: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  placement?: "primary" | "settings" | "hidden" | undefined;
}

export interface AppShellProps {
  pages: AppShellPage[];
  activePageId: string;
  onNavigate: (pageId: string) => void;
  children: React.ReactNode;
}

type TaskLoadState =
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "error"; message: string };

export function AppShell({ pages, activePageId, onNavigate, children }: AppShellProps) {
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0]!;
  const primaryPages = pages.filter((page) => (page.placement ?? "primary") === "primary");
  const settingsPage = pages.find((page) => page.placement === "settings");
  const [tasksState, setTasksState] = useState<TaskLoadState>({ status: "loading" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listTasks({ limit: 5 }, { signal: controller.signal })
      .then((tasks) => setTasksState({ status: "ready", tasks }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTasksState({ status: "error", message: error instanceof Error ? error.message : "Recent tasks unavailable." });
        }
      });
    return () => controller.abort();
  }, []);

  function navigateTo(pageId: string) {
    setMobileNavOpen(false);
    onNavigate(pageId);
  }

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full border border-border bg-surface text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-foreground">Frank Hub</p>
          <p className="truncate text-xs text-muted-foreground">{activePage.title}</p>
        </div>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className="size-5" aria-hidden="true" />
        </button>
      </header>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="!left-0 !top-0 !h-[100dvh] !w-[min(22rem,calc(100vw-2rem))] !max-w-none !translate-x-0 !translate-y-0 !rounded-none border-y-0 border-l-0 p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Navigation</DialogTitle>
            <DialogDescription>Primary navigation, recent tasks, and settings.</DialogDescription>
          </DialogHeader>
          <SidebarContent
            activePage={activePage}
            primaryPages={primaryPages}
            settingsPage={settingsPage}
            tasksState={tasksState}
            sectionIdPrefix="mobile"
            className="h-[100dvh] overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5"
            onNavigate={navigateTo}
          />
        </DialogContent>
      </Dialog>

      <div className="grid min-h-[calc(100dvh-4rem)] lg:min-h-screen lg:grid-cols-[var(--frank-sidebar-width)_minmax(0,1fr)]">
        <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
          <SidebarContent
            activePage={activePage}
            primaryPages={primaryPages}
            settingsPage={settingsPage}
            tasksState={tasksState}
            sectionIdPrefix="desktop"
            className="h-full min-h-screen px-4 py-5"
            onNavigate={navigateTo}
          />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-[var(--frank-topbar-height)] flex-col items-start justify-center gap-3 border-b border-border bg-background/95 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-muted-foreground">{activePage.id === "home" ? "Workspace" : "Frank Hub"}</p>
              <h1 className="truncate text-base font-semibold leading-6 text-foreground">{activePage.title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StatusPill onNavigateOps={() => onNavigate("ops-console")} />
              <button
                type="button"
                className="hidden size-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:flex"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="size-5" aria-hidden="true" />
              </button>
            </div>
          </header>

          <main id="main-content" className="min-w-0 flex-1 px-3 py-4 sm:px-6 lg:px-8" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  activePage,
  primaryPages,
  settingsPage,
  tasksState,
  sectionIdPrefix,
  onNavigate,
  className
}: {
  activePage: AppShellPage;
  primaryPages: AppShellPage[];
  settingsPage: AppShellPage | undefined;
  tasksState: TaskLoadState;
  sectionIdPrefix: string;
  onNavigate: (pageId: string) => void;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div className="flex min-h-14 items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold leading-7 text-foreground">Frank Hub</p>
        </div>
      </div>

      <nav className="mt-8 grid gap-1" aria-label="Primary navigation">
        {primaryPages.map((page) => (
          <SidebarNavButton key={page.id} page={page} active={page.id === activePage.id} onClick={() => onNavigate(page.id)} />
        ))}
      </nav>

      <div className="mt-7">
        <SidebarSection id={`${sectionIdPrefix}-recent-tasks`} title="Recent Tasks" icon={CheckCircle2} defaultOpen={false}>
          {tasksState.status === "loading" ? <SidebarMutedRow>Loading tasks</SidebarMutedRow> : null}
          {tasksState.status === "error" ? <SidebarMutedRow>{tasksState.message}</SidebarMutedRow> : null}
          {tasksState.status === "ready" && tasksState.tasks.length === 0 ? <SidebarMutedRow>No recent tasks</SidebarMutedRow> : null}
          {tasksState.status === "ready"
            ? tasksState.tasks.slice(0, 5).map((task) => (
                <SidebarContextRow
                  key={task.id}
                  title={task.title}
                  subtitle={titleize(task.state)}
                  onClick={() => onNavigate("tasks")}
                />
              ))
            : null}
          <SidebarActionRow title="Show more" onClick={() => onNavigate("tasks")} />
        </SidebarSection>
      </div>

      <div className="mt-auto grid gap-3 border-t border-sidebar-border pt-5">
        {settingsPage ? (
          <SidebarNavButton page={settingsPage} active={settingsPage.id === activePage.id} onClick={() => onNavigate(settingsPage.id)} />
        ) : null}
        <button
          type="button"
          className="flex min-h-14 items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onNavigate("settings")}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">Frank Hub</span>
            <span className="block truncate text-xs text-muted-foreground">Workspace</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SidebarNavButton({ page, active, onClick }: { page: AppShellPage; active: boolean; onClick: () => void }) {
  const Icon = page.icon;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="truncate">{page.label}</span>
    </button>
  );
}

function SidebarContextRow({
  title,
  subtitle,
  onClick
}: {
  title: string;
  subtitle?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="grid min-h-10 w-full gap-0.5 rounded-md px-3 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="truncate text-sm font-medium text-foreground">{title}</span>
      {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </button>
  );
}

function SidebarActionRow({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="min-h-9 rounded-md px-3 text-left text-xs font-semibold text-accent-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      {title}
    </button>
  );
}

function SidebarMutedRow({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md px-3 py-2 text-xs leading-5 text-muted-foreground">{children}</p>;
}
