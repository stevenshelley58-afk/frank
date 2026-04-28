import type * as React from "react";
import { StatusBadge, type StatusTone } from "./status-badge.js";
import { cn } from "../../lib/utils.js";

export interface HealthCheckRowProps {
  label: string;
  status: StatusTone;
  detail?: React.ReactNode;
  latencyMs?: number | undefined;
  icon?: React.ReactNode;
  className?: string;
}

export function HealthCheckRow({ label, status, detail, latencyMs, icon, className }: HealthCheckRowProps) {
  return (
    <div className={cn("grid min-h-14 grid-cols-[1fr_auto] items-center gap-4 border-b border-border py-3 last:border-b-0", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary [&_svg]:size-4">{icon}</div> : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {detail ? <p className="mt-0.5 overflow-hidden text-ellipsis text-sm leading-5 text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {typeof latencyMs === "number" ? <span className="text-xs font-semibold text-muted-foreground">{latencyMs}ms</span> : null}
        <StatusBadge tone={status} />
      </div>
    </div>
  );
}
