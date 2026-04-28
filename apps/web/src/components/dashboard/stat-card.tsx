import type * as React from "react";
import { Card } from "../ui/index.js";
import { StatusBadge, type StatusTone } from "./status-badge.js";
import { cn } from "../../lib/utils.js";

type StatTone = "good" | "warn" | "bad" | "neutral";

const iconToneClass: Record<StatTone, string> = {
  good: "text-success bg-success/10",
  warn: "text-warning bg-warning/10",
  bad: "text-destructive bg-destructive/10",
  neutral: "text-primary bg-accent"
};

export interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  status?: StatusTone;
  tone?: StatTone;
  className?: string;
}

export function StatCard({ icon, label, value, description, status, tone = "neutral", className }: StatCardProps) {
  return (
    <Card className={cn("min-h-32 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", iconToneClass[tone])}>{icon}</div>
        {status ? <StatusBadge tone={status} /> : null}
      </div>
      <div className="mt-4 min-w-0">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <div className="mt-1 overflow-hidden text-ellipsis text-xl font-semibold leading-7 text-foreground">{value}</div>
        {description ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div> : null}
      </div>
    </Card>
  );
}
