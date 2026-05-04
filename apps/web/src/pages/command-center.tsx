import { AlertTriangle, CheckCircle2, Database, MessageCircle, RefreshCw, Rocket, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getBackupStatus,
  getOperatorAccess,
  getOpsDeploy,
  getWhatsAppStatus,
  listSelfUpgrades,
  listTasks,
  runHermesKillSwitch,
  type BackupStatusResponse,
  type MessagingWhatsAppStatusResponse,
  type OperatorAccessResponse,
  type OpsDeployResponse,
  type SelfUpgradeRun,
  type Task
} from "../api.js";
import {
  DataTable,
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button } from "../components/ui/index.js";
import { formatDateTime, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: CommandCenterData }
  | { status: "error"; message: string };

interface CommandCenterData {
  tasks: Task[];
  selfUpgrades: SelfUpgradeRun[];
  backups: BackupStatusResponse;
  deploy: OpsDeployResponse;
  access: OperatorAccessResponse;
  whatsapp: MessagingWhatsAppStatusResponse;
}

const activeTaskStates = new Set(["queued", "running", "blocked", "waiting_approval"]);

export function CommandCenterPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [killMessage, setKillMessage] = useState<string | null>(null);

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      listTasks({ limit: 25 }, { signal: controller.signal }),
      listSelfUpgrades({ signal: controller.signal }),
      getBackupStatus({ signal: controller.signal }),
      getOpsDeploy({ signal: controller.signal }),
      getOperatorAccess({ signal: controller.signal }),
      getWhatsAppStatus({ signal: controller.signal })
    ])
      .then(([tasks, selfUpgrades, backups, deploy, access, whatsapp]) =>
        setState({ status: "ready", data: { tasks, selfUpgrades, backups, deploy, access, whatsapp } })
      )
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

  async function killHermes() {
    setKillMessage(null);
    const result = await runHermesKillSwitch("Command Center kill switch requested.");
    setKillMessage(`${titleize(result.outcome)}: ${result.affectedSessions.length} session(s) affected`);
    load();
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  const { tasks, selfUpgrades, backups, deploy, access, whatsapp } = state.data;
  const activeTasks = tasks.filter((task) => activeTaskStates.has(task.state));
  const latestSelfUpgrade = selfUpgrades[0] ?? null;
  const latestBackup = backups.backups[0] ?? null;

  return (
    <section className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Tasks" value={String(activeTasks.length)} icon={<Wrench aria-hidden="true" />} />
        <StatCard label="Self-Upgrades" value={String(selfUpgrades.length)} icon={<Rocket aria-hidden="true" />} />
        <StatCard label="WhatsApp" value={whatsapp.whatsapp.configured ? "Ready" : "Review"} icon={<MessageCircle aria-hidden="true" />} />
        <StatCard label="Mode" value={titleize(access.operator.mode)} icon={<ShieldCheck aria-hidden="true" />} />
      </section>

      <SectionCard
        title="Lab Controls"
        description="High-trust controls for the private VPS lab."
        icon={<AlertTriangle aria-hidden="true" />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void killHermes()}>
              <AlertTriangle aria-hidden="true" />
              Kill Hermes
            </Button>
          </div>
        }
      >
        <KeyValueList
          items={[
            { label: "Repo workspace", value: access.operator.repoWorkspacePath },
            { label: "Backup root", value: backups.backupRoot },
            { label: "Latest backup", value: latestBackup ? `${titleize(latestBackup.backupType)} ${titleize(latestBackup.status)}` : "None" },
            {
              label: "Latest deploy",
              value: deploy.deploy.lastDeploy.available ? formatDateTime(deploy.deploy.lastDeploy.data.deployedAt ?? "") : "Unavailable",
              description: deploy.deploy.lastDeploy.available ? deploy.deploy.lastDeploy.data.source : deploy.deploy.lastDeploy.message
            },
            { label: "WhatsApp route", value: whatsapp.whatsapp.webhookRoute },
            { label: "Kill switch", value: killMessage ?? "Idle" }
          ]}
        />
      </SectionCard>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Self-Upgrades" description="Latest Frank self-upgrade runs." icon={<Rocket aria-hidden="true" />}>
          {latestSelfUpgrade ? (
            <KeyValueList
              items={[
                { label: "Goal", value: latestSelfUpgrade.goal },
                { label: "Status", value: <StatusBadge tone={selfUpgradeTone(latestSelfUpgrade.status)}>{titleize(latestSelfUpgrade.status)}</StatusBadge> },
                { label: "Branch", value: latestSelfUpgrade.branch },
                { label: "Workspace", value: latestSelfUpgrade.workspacePath },
                { label: "Auto deploy", value: latestSelfUpgrade.autoDeploy ? "Enabled" : "Disabled" }
              ]}
            />
          ) : (
            <EmptyState icon={<Rocket aria-hidden="true" />} title="No self-upgrades yet" description="Create one from the Self-Upgrades page." />
          )}
        </SectionCard>

        <SectionCard title="Access And Limits" description="Lab-mode limits applied to high-power work." icon={<Database aria-hidden="true" />}>
          <KeyValueList
            items={[
              { label: "External sends / hour", value: String(access.operator.limits.externalSendPerHour) },
              { label: "API spend / day", value: `$${access.operator.limits.apiSpendUsdPerDay}` },
              { label: "File delete max", value: String(access.operator.limits.fileDeleteMaxCount) },
              { label: "Host command timeout", value: `${access.operator.limits.hostCommandTimeoutSeconds}s` },
              { label: "Access write", value: access.accessWrite.enabled ? "Enabled" : "Disabled" }
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard title="Active Work" description="Tasks that need attention or are running." icon={<CheckCircle2 aria-hidden="true" />}>
        <DataTable
          data={activeTasks}
          getRowId={(task) => task.id}
          emptyState={<EmptyState icon={<CheckCircle2 aria-hidden="true" />} title="No active tasks" description="The queue is clear." />}
          columns={[
            { id: "title", header: "Task", cell: (task) => <span className="font-semibold text-foreground">{task.title}</span> },
            { id: "state", header: "State", cell: (task) => <StatusBadge tone={taskTone(task.state)}>{titleize(task.state)}</StatusBadge> },
            { id: "execution", header: "Execution", cell: (task) => <span className="text-muted-foreground">{task.executionKind ?? "manual"}</span> },
            { id: "updated", header: "Updated", cell: (task) => <span className="text-muted-foreground">{formatDateTime(task.updatedAt)}</span> }
          ]}
        />
      </SectionCard>
    </section>
  );
}

function selfUpgradeTone(status: SelfUpgradeRun["status"]) {
  if (status === "completed") return "healthy";
  if (status === "failed" || status === "rolled_back") return "offline";
  if (status === "running" || status === "deploying") return "checking";
  return "planned";
}

function taskTone(state: Task["state"]) {
  if (state === "running") return "checking";
  if (state === "blocked" || state === "failed") return "offline";
  if (state === "completed") return "healthy";
  return "planned";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Command Center.";
}
