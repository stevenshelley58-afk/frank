import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";

export interface SidebarSectionProps {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultOpen?: boolean | undefined;
  children: React.ReactNode;
}

const storageKey = "frankHub.sidebarSections";

export function SidebarSection({ id, title, icon: Icon, defaultOpen = true, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(() => readSectionState(id, defaultOpen));
  const contentId = useMemo(() => `sidebar-section-${id}`, [id]);

  useEffect(() => {
    writeSectionState(id, open);
  }, [id, open]);

  return (
    <section className="border-t border-sidebar-border py-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open ? "rotate-180" : "rotate-0")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={contentId} className="mt-2 grid gap-1">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function readSectionState(id: string, fallback: boolean): boolean {
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return fallback;
    }
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return typeof parsed[id] === "boolean" ? parsed[id] : fallback;
  } catch {
    return fallback;
  }
}

function writeSectionState(id: string, open: boolean): void {
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    const parsed = rawValue ? (JSON.parse(rawValue) as Record<string, unknown>) : {};
    window.localStorage.setItem(storageKey, JSON.stringify({ ...parsed, [id]: open }));
  } catch {
    // localStorage may be unavailable in private or constrained browser contexts.
  }
}
