import { GitBranch, Play, RefreshCw, RotateCcw, Rocket, XCircle } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  cancelSelfUpgrade,
  createSelfUpgrade,
  listSelfUpgrades,
  rollbackSelfUpgrade,
  type SelfUpgradeRun
} from "../api.js";
import {
  DataTable,
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button, Textarea } from "../components/ui/index.js";
import { formatDateTime, metadataPreview, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; runs: SelfUpgradeRun[] }
  | { status: "error"; message: string };

export function SelfUpgradesPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [goal, setGoal] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    listSelfUpgrades({ signal: controller.signal })
      .then((runs) => setState({ status: "ready", runs }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, []);

  async function submitSelfUpgrade(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed) {
      return;
    }
    setMessage(null);
    const result = await createSelfUpgrade({
      goal: trimmed,
      autoDeploy: true,
      metadata: {
        source: "self_upgrades_page"
      }
    });
    setGoal("");
    setMessage(`Queued ${result.selfUpgradeRun.branch}`);
    load();
  }

  async function cancelRun(run: SelfUpgradeRun) {
    setMessage(null);
    const result = await cancelSelfUpgrade(run.id, "Cancelled from the Self-Upgrades page.");
    setMessage(`Cancelled ${result.selfUpgradeRun.branch}`);
    load();
  }

  async function rollbackRun(run: SelfUpgradeRun) {
    setMessage(null);
    const result = await rollbackSelfUpgrade(run.id, "Rollback requested from the Self-Upgrades page.");
    setMessage(`Queued rollback task ${result.task.id}`);
    load();
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={7} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  const latest = state.runs[0] ?? null;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Create Self-Upgrade"
        description="Queue a lab-mode Frank self-upgrade. Passing validation auto-deploys on the VPS."
        icon={<Rocket aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        <form className="grid gap-3" onSubmit={submitSelfUpgrade}>
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Describe the change Frank should make to itself"
            rows={4}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">
              <Play aria-hidden="true" />
              Queue self-upgrade
            </Button>
            {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
          </div>
        </form>
      </SectionCard>

      {latest ? (
        <SectionCard
          title="Latest Run"
          description="Current self-upgrade state."
          icon={<GitBranch aria-hidden="true" />}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void cancelRun(latest)} disabled={isTerminalStatus(latest.status)}>
                <XCircle aria-hidden="true" />
                Cancel
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void rollbackRun(latest)}>
                <RotateCcw aria-hidden="true" />
                Rollback
              </Button>
            </div>
          }
        >
          <KeyValueList
            items={[
              { label: "Goal", value: latest.goal },
              { label: "Status", value: <StatusBadge tone={runTone(latest.status)}>{titleize(latest.status)}</StatusBadge> },
              { label: "Branch", value: latest.branch },
              { label: "Workspace", value: latest.workspacePath },
              { label: "Task", value: latest.taskId ?? "Not linked" },
              { label: "Runner", value: latest.runnerSessionId ?? "Not linked" },
              { label: "Backups", value: latest.backupIds.length > 0 ? latest.backupIds.join(", ") : "Not recorded" },
              { label: "Validation", value: previewRecord(latest.validationResults) },
              { label: "Deploy", value: previewRecord(latest.deployResult) },
              { label: "Rollback", value: previewRecord(latest.rollbackTarget) },
              { label: "Metadata", value: previewRecord(latest.metadata) },
              { label: "Created", value: formatDateTime(latest.createdAt) }
            ]}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Run History" description="Self-upgrades are durable records tied to tasks and runner sessions." icon={<Rocket aria-hidden="true" />}>
        <DataTable
          data={state.runs}
          getRowId={(run) => run.id}
          emptyState={<EmptyState icon={<Rocket aria-hidden="true" />} title="No self-upgrades" description="Queue the first self-upgrade above." />}
          columns={[
            { id: "goal", header: "Goal", cell: (run) => <span className="font-semibold text-foreground">{run.goal}</span> },
            { id: "status", header: "Status", cell: (run) => <StatusBadge tone={runTone(run.status)}>{titleize(run.status)}</StatusBadge> },
            { id: "branch", header: "Branch", cell: (run) => <span className="text-muted-foreground">{run.branch}</span> },
            { id: "limits", header: "Limits", cell: (run) => <span className="text-muted-foreground">{metadataPreview(run.limits, 1)[0]?.value ?? "Default"}</span> },
            { id: "created", header: "Created", cell: (run) => <span className="text-muted-foreground">{formatDateTime(run.createdAt)}</span> }
          ]}
        />
      </SectionCard>
    </section>
  );
}

function runTone(status: SelfUpgradeRun["status"]) {
  if (status === "completed") return "healthy";
  if (status === "failed" || status === "rolled_back") return "offline";
  if (status === "running" || status === "deploying") return "checking";
  return "planned";
}

function isTerminalStatus(status: SelfUpgradeRun["status"]) {
  return ["completed", "failed", "cancelled", "rolled_back"].includes(status);
}

function previewRecord(record: Record<string, unknown>) {
  const preview = metadataPreview(record, 2);
  return preview.length > 0 ? preview.map((item) => `${item.label}: ${item.value}`).join(", ") : "Not recorded";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load self-upgrades.";
}
