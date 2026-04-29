import { Bot, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import {
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button } from "../components/ui/index.js";
import { getHermesStatus, runHermesInstallCheck, type HermesStatusResponse } from "../api.js";
import { titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: HermesStatusResponse; installHints: string[] }
  | { status: "error"; message: string };

export function HermesPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadStatus = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getHermesStatus({ signal: controller.signal })
      .then((data) => setState({ status: "ready", data, installHints: [] }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  const runCheck = async () => {
    if (state.status !== "ready") {
      return;
    }
    const result = await runHermesInstallCheck();
    setState({
      status: "ready",
      data: {
        runner: {
          ...state.data.runner,
          status: statusFromHealth(result.status)
        },
        status: result.status
      },
      installHints: result.setupHints
    });
  };

  useEffect(() => {
    const controller = loadStatus();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <LoadingBlock rows={5} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadStatus()} />;
  }

  const { runner, status } = state.data;
  const config = runner.configSummary;
  const badgeTone = status.enabled ? (status.health === "ok" ? "healthy" : "degraded") : "neutral";

  return (
    <div className="grid gap-5">
      <SectionCard
        title="Hermes Runner"
        description="Private operator runtime status. Frank API and workers call Hermes; the browser does not."
        icon={<Bot aria-hidden="true" />}
        action={
          <div className="flex gap-2">
            <StatusBadge tone={badgeTone}>{titleize(runner.status)}</StatusBadge>
            <Button type="button" variant="outline" size="sm" onClick={() => loadStatus()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      >
        <KeyValueList
          items={[
            { label: "Enabled", value: status.enabled ? "Yes" : "No" },
            { label: "Configured", value: status.configured ? "Yes" : "No" },
            { label: "Reachable", value: status.reachable ? "Yes" : "No" },
            { label: "Health", value: titleize(status.health) },
            { label: "Message", value: status.message ?? "No issues reported" },
            { label: "Models", value: status.models.length > 0 ? status.models.join(", ") : "None reported" }
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Private Runtime Configuration"
        description="Read-only summary. Secrets and provider keys are configured manually outside the dashboard."
        icon={<ShieldCheck aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void runCheck()}>
            <TerminalSquare aria-hidden="true" />
            Install Check
          </Button>
        }
      >
        <KeyValueList
          items={[
            { label: "API base URL", value: textValue(config.apiBaseUrl) },
            { label: "API key", value: config.apiKeyConfigured ? "Configured" : "Not configured" },
            { label: "Workspace root", value: textValue(config.workspaceRoot) },
            { label: "Artifact root", value: textValue(config.artifactRoot) },
            { label: "Run timeout", value: `${textValue(config.timeoutSeconds)} seconds` },
            { label: "Stall timeout", value: `${textValue(config.stallTimeoutSeconds)} seconds` },
            { label: "Event poll", value: `${textValue(config.eventsPollMs)} ms` }
          ]}
        />
      </SectionCard>

      {state.installHints.length > 0 ? (
        <SectionCard title="Setup Hints" icon={<TerminalSquare aria-hidden="true" />}>
          <div className="grid gap-2">
            {state.installHints.map((hint) => (
              <div key={hint} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {hint}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : (
        <EmptyState title="No install check has been run" description="Run the check to verify the private gateway path from Frank API to Hermes." />
      )}
    </div>
  );
}

function statusFromHealth(status: HermesStatusResponse["status"]): HermesStatusResponse["runner"]["status"] {
  if (!status.enabled) {
    return "disabled";
  }
  if (!status.configured) {
    return "not_configured";
  }
  return status.health === "ok" ? "available" : "unavailable";
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "Unavailable";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Hermes status.";
}
