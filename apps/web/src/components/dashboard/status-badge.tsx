import type * as React from "react";
import { Badge, type BadgeProps } from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export type StatusTone = "healthy" | "degraded" | "offline" | "checking" | "protected" | "neutral" | "planned";

const variantByTone: Record<StatusTone, BadgeProps["variant"]> = {
  healthy: "success",
  degraded: "warning",
  offline: "destructive",
  checking: "neutral",
  protected: "outline",
  neutral: "secondary",
  planned: "neutral"
};

const labelByTone: Record<StatusTone, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  checking: "Checking",
  protected: "Protected",
  neutral: "Ready",
  planned: "Planned"
};

export interface StatusBadgeProps {
  tone: StatusTone;
  children?: React.ReactNode;
  className?: string;
}

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={variantByTone[tone]} className={cn("capitalize", className)}>
      {children ?? labelByTone[tone]}
    </Badge>
  );
}
