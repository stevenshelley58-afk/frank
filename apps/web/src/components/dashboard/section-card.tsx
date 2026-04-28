import type * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export interface SectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({ title, description, icon, action, children, className, contentClassName }: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <div className="mt-0.5 text-primary [&_svg]:size-5">{icon}</div> : null}
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
