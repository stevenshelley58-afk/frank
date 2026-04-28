import type * as React from "react";
import { cn } from "../../lib/utils.js";

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
  description?: React.ReactNode;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  className?: string;
}

export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <dl className={cn("grid gap-1", className)}>
      {items.map((item, index) => (
        <div key={index} className="flex min-h-11 items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
          <dt className="text-sm font-semibold text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-right text-sm leading-6 text-foreground">
            <div className="[overflow-wrap:anywhere] font-medium">{item.value}</div>
            {item.description ? <div className="text-muted-foreground">{item.description}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
