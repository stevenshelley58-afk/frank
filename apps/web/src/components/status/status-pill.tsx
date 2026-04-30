import { useEffect, useState } from "react";
import { ChevronDown, Circle } from "lucide-react";
import type { SystemStatus } from "@frank/shared";
import { fetchSystemStatus, getOpsStatus, type OpsStatus } from "../../api.js";
import { cn } from "../../lib/utils.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; system: SystemStatus; ops: OpsStatus }
  | { status: "error"; message: string };

export interface StatusPillProps {
  onNavigateOps: () => void;
}

export function StatusPill({ onNavigateOps }: StatusPillProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchSystemStatus({ signal: controller.signal }), getOpsStatus({ signal: controller.signal })])
      .then(([system, ops]) => setState({ status: "ready", system, ops }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Status unavailable" });
        }
      });
    return () => controller.abort();
  }, []);

  const issueCount = state.status === "ready" ? countIssues(state.system, state.ops) : state.status === "error" ? 1 : 0;
  const label =
    state.status === "loading"
      ? "Checking systems"
      : issueCount === 0
        ? "All systems operational"
        : `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`;
  const degraded = issueCount > 0;

  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        degraded
          ? "border-warning/30 bg-warning/10 text-foreground hover:bg-warning/15"
          : "border-border bg-surface text-foreground hover:bg-accent"
      )}
      aria-label={`Open Ops Console: ${label}`}
      title="Open Ops Console"
      onClick={onNavigateOps}
    >
      <Circle
        className={cn("size-3", degraded ? "fill-warning text-warning" : "fill-muted-foreground text-muted-foreground")}
        aria-hidden="true"
      />
      <span>{label}</span>
      <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function countIssues(system: SystemStatus, ops: OpsStatus): number {
  const serviceIssues = Object.values(system.services).filter((service) => !service.ok).length;
  const opsIssue = ops.status === "ok" ? 0 : 1;
  return serviceIssues + opsIssue;
}
