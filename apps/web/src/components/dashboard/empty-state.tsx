import type * as React from "react";
import { cn } from "../../lib/utils.js";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/35 px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-card text-primary shadow-sm [&_svg]:size-5">{icon}</div> : null}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
