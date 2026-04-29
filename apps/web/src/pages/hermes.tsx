import { Archive, Bot, Database, Power, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DataTable,
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge,
  type StatusTone
} from "../components/dashboard/index.js";
import { Alert, AlertDescription, AlertTitle, Button } from "../components/ui/index.js";
import {
  createFilesBackup,
  createPostgresBackup,
  getBackupStatus,
  getHermesStatus,
  listBackups,
  runBackupPreflight,
  runHermesInstallCheck,
  runHermesKillSwitch,
  type BackupRun,
  type HermesStatusResponse
} from "../api.js";
import { formatBytes, formatDateTime, titleize } from "../lib/format.js";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

interface BackupView {
  backups: BackupRun[];
  backupRoot: string;
}

export function HermesPage() {
  const [state, setState] = useState<LoadState<HermesStatusResponse>>({ status: "loading" });
  const [installHints, setInstallHints] = useState<string[]>([]);
  const [backupsState, setBackupsState] = useState<LoadState<BackupView>>({ status: "loading" });
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadStatus = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getHermesStatus({ signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  const loadBackups = () => {
    const controller = new AbortController();
    setBackupsState({ status: "loading" });
    Promise.all([getBackupStatus({ signal: controller.signal }), listBackups({ limit: 25 }, { signal: controller.signal })])
      .then(([status, backups]) =>
        setBackupsState({
          status: "ready",
          data: {
            backupRoot: status.backupRoot,
            backups
          }
        })
      )
      .catch((error) => {
        if (!controller.signal.aborted) {
          setBackupsState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  const runCheck = async () => {
    if (state.status !== "ready") {
      return;
    }
    setBusyAction("install-check");
    setOperationMessage(null);
    try {
      const result = await runHermesInstallCheck();
      setState({
        status: "ready",
        data: {
          runner: {
            ...state.data.runner,
            status: statusFromHealth(result.status)
          },
          status: result.status
        }
      });
      setInstallHints(result.setupHints);
      setOperationMessage(result.ok ? "Hermes install check completed." : "Hermes install check found setup work.");
    } catch (error) {
      setOperationMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runBackupAction = async (action: "preflight" | "postgres" | "files") => {
    setBusyAction(action);
    setOperationMessage(null);
    try {
      const result =
        action === "preflight"
          ? await runBackupPreflight()
          : action === "postgres"
            ? await createPostgresBackup()
            : await createFilesBackup();
      setOperationMessage(`${titleize(action)} backup recorded as ${result.backup.status}.`);
      loadBackups();
    } catch (error) {
      setOperationMessage(errorMessage(error));
      loadBackups();
    } finally {
      setBusyAction(null);
    }
  };

  const runKillSwitch = async () => {
    if (!window.confirm("Stop all active Hermes runs without stopping Frank Hub?")) {
      return;
    }
    setBusyAction("kill-switch");
    setOperationMessage(null);
    try {
      const result = await runHermesKillSwitch("Kill switch requested from Hermes Runner dashboard.");
      setOperationMessage(
        `Kill switch ${result.outcome}; affected ${result.affectedSessions.length} active Hermes session(s).`
      );
      loadBackups();
      loadStatus();
    } catch (error) {
      setOperationMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    const statusController = loadStatus();
    const backupController = loadBackups();
    return () => {
      statusController.abort();
      backupController.abort();
    };
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
          <div className="flex flex-wrap justify-end gap-2">
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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]">
        <SectionCard
          title="Private Runtime Configuration"
          description="Read-only summary. Secrets and provider keys are configured manually outside the dashboard."
          icon={<ShieldCheck aria-hidden="true" />}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runCheck()}
              disabled={busyAction === "install-check"}
            >
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

        <SectionCard title="Kill Switch" description="Stops active Hermes runs only. Frank Hub, Postgres, and Redis stay up." icon={<Power aria-hidden="true" />}>
          <div className="grid gap-3">
            <Button
              type="button"
              variant="destructive"
              onClick={() => void runKillSwitch()}
              disabled={busyAction === "kill-switch"}
            >
              <Power aria-hidden="true" />
              Kill Hermes Runs
            </Button>
            <p className="text-sm leading-6 text-muted-foreground">
              The kill switch writes runner events, task events, and audit history. It does not delete artifacts or backups.
            </p>
          </div>
        </SectionCard>
      </section>

      {operationMessage ? (
        <Alert variant={operationMessage.toLowerCase().includes("failed") ? "destructive" : "default"}>
          <AlertTitle>Runner operation</AlertTitle>
          <AlertDescription>{operationMessage}</AlertDescription>
        </Alert>
      ) : null}

      {installHints.length > 0 ? (
        <SectionCard title="Setup Hints" icon={<TerminalSquare aria-hidden="true" />}>
          <div className="grid gap-2">
            {installHints.map((hint) => (
              <div key={hint} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {hint}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Backup Status"
        description="Recoverability controls for high-trust operator mode. Backups are stored outside the repo."
        icon={<Archive aria-hidden="true" />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runBackupAction("preflight")}
              disabled={busyAction !== null}
            >
              <ShieldCheck aria-hidden="true" />
              Preflight
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runBackupAction("postgres")}
              disabled={busyAction !== null}
            >
              <Database aria-hidden="true" />
              Postgres
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runBackupAction("files")}
              disabled={busyAction !== null}
            >
              <Archive aria-hidden="true" />
              Files
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => loadBackups()} disabled={backupsState.status === "loading"}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      >
        {backupsState.status === "loading" ? <LoadingBlock rows={4} /> : null}
        {backupsState.status === "error" ? <ResourceError message={backupsState.message} onRetry={() => loadBackups()} /> : null}
        {backupsState.status === "ready" ? (
          <div className="grid gap-4">
            <KeyValueList items={[{ label: "Backup root", value: backupsState.data.backupRoot }]} />
            <DataTable
              data={backupsState.data.backups}
              getRowId={(backup) => backup.id}
              emptyState={
                <EmptyState
                  icon={<Archive aria-hidden="true" />}
                  title="No backup runs"
                  description="Run a preflight or backup to record recoverability status."
                />
              }
              columns={[
                {
                  id: "type",
                  header: "Type",
                  cell: (backup) => (
                    <div className="grid gap-1">
                      <span className="font-semibold text-foreground">{titleize(backup.backupType)}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(backup.createdAt)}</span>
                    </div>
                  )
                },
                {
                  id: "status",
                  header: "Status",
                  cell: (backup) => <StatusBadge tone={backupTone(backup.status)}>{titleize(backup.status)}</StatusBadge>
                },
                {
                  id: "size",
                  header: "Size",
                  cell: (backup) => <span className="text-muted-foreground">{formatBytes(backup.sizeBytes)}</span>
                },
                {
                  id: "ref",
                  header: "Git",
                  cell: (backup) => (
                    <span className="text-muted-foreground">
                      {backup.branch ?? "Unknown"} {backup.commit ? shortId(backup.commit) : ""}
                    </span>
                  )
                },
                {
                  id: "finished",
                  header: "Finished",
                  cell: (backup) => <span className="text-muted-foreground">{formatDateTime(backup.finishedAt)}</span>
                }
              ]}
            />
          </div>
        ) : null}
      </SectionCard>

      {installHints.length === 0 ? (
        <EmptyState title="No install check has been run" description="Run the check to verify the private gateway path from Frank API to Hermes." />
      ) : null}
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

function backupTone(status: BackupRun["status"]): StatusTone {
  if (status === "completed") return "healthy";
  if (status === "failed") return "offline";
  return "checking";
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "Unavailable";
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Hermes status.";
}
