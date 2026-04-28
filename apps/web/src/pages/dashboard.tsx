import { Activity, Bot, Boxes, Database, FileClock, PlugZap, RefreshCw, Server, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import type { ServiceStatus, SystemStatus } from "@frank/shared";
import {
  DataTable,
  EmptyState,
  HealthCheckRow,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatCard,
  StatusBadge,
  type StatusTone
} from "../components/dashboard/index.js";
import { Button } from "../components/ui/index.js";
import {
  fetchSystemStatus,
  getOpsStatus,
  listAgents,
  listAuditLog,
  listModelRoles,
  listProviders,
  listTasks,
  type Agent,
  type AuditLogEvent,
  type ModelRole,
  type OpsStatus,
  type Provider,
  type Task
} from "../api.js";
import { formatBytes, formatDateTime, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardData }
  | { status: "error"; message: string };

interface DashboardData {
  system: SystemStatus;
  agents: Agent[];
  providers: Provider[];
  modelRoles: ModelRole[];
  tasks: Task[];
  auditLog: AuditLogEvent[];
  ops: OpsStatus;
}

export function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadDashboard = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      fetchSystemStatus({ signal: controller.signal }),
      listAgents({ signal: controller.signal }),
      listProviders({ signal: controller.signal }),
      listModelRoles({ signal: controller.signal }),
      listTasks({ limit: 100 }, { signal: controller.signal }),
      listAuditLog({ limit: 5 }, { signal: controller.signal }),
      getOpsStatus({ signal: controller.signal })
    ])
      .then(([system, agents, providers, modelRoles, tasks, audit, ops]) => {
        setState({
          status: "ready",
          data: {
            system,
            agents,
            providers,
            modelRoles,
            tasks,
            auditLog: audit.auditLog,
            ops
          }
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadDashboard();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadDashboard()} />;
  }

  const { system, agents, providers, modelRoles, tasks, auditLog, ops } = state.data;
  const apiOk = system.services.postgres.ok && system.services.redis.ok;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Activity aria-hidden="true" />}
          label="System"
          value={system.systemName}
          description={`${system.environment} environment`}
          status={apiOk ? "healthy" : "degraded"}
          tone={apiOk ? "good" : "warn"}
        />
        <StatCard
          icon={<Server aria-hidden="true" />}
          label="API Health"
          value={apiOk ? "Healthy" : "Degraded"}
          description={`Checked ${formatDateTime(system.generatedAt)}`}
          status={apiOk ? "healthy" : "degraded"}
          tone={apiOk ? "good" : "warn"}
        />
        <StatCard
          icon={<Bot aria-hidden="true" />}
          label="Agents"
          value={agents.length}
          description="Seeded agent registry rows."
          status="neutral"
        />
        <StatCard
          icon={<TerminalSquare aria-hidden="true" />}
          label="Ops"
          value={titleize(ops.status)}
          description={`Mode ${ops.mode}`}
          status={opsStatusTone(ops.status)}
          tone={ops.status === "ok" ? "good" : ops.status === "partial" ? "warn" : "bad"}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<PlugZap aria-hidden="true" />}
          label="Providers"
          value={providers.length}
          description="Provider registry entries."
          status="neutral"
        />
        <StatCard
          icon={<Boxes aria-hidden="true" />}
          label="Model Roles"
          value={modelRoles.length}
          description="Provider-agnostic role definitions."
          status="neutral"
        />
        <StatCard
          icon={<FileClock aria-hidden="true" />}
          label="Tasks"
          value={tasks.length}
          description="Loaded task rows, newest first."
          status="neutral"
        />
        <StatCard
          icon={<Database aria-hidden="true" />}
          label="Memory"
          value={formatBytes(ops.system.memory.usedBytes)}
          description={`${formatBytes(ops.system.memory.freeBytes)} free`}
          status="neutral"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Runtime Health"
          description="Core API dependencies reported by the live status endpoint."
          icon={<Database aria-hidden="true" />}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => loadDashboard()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          <HealthCheckRow
            label="Postgres"
            status={serviceTone(system.services.postgres)}
            detail={system.services.postgres.message ?? "Database check completed"}
            latencyMs={system.services.postgres.latencyMs}
            icon={<Database aria-hidden="true" />}
          />
          <HealthCheckRow
            label="Redis"
            status={serviceTone(system.services.redis)}
            detail={system.services.redis.message ?? "Redis check completed"}
            latencyMs={system.services.redis.latencyMs}
            icon={<Server aria-hidden="true" />}
          />
          <HealthCheckRow
            label="Cloudflare Access"
            status={serviceTone(system.services.cloudflareAccess)}
            detail={system.services.cloudflareAccess.message ?? "Access check completed"}
            latencyMs={system.services.cloudflareAccess.latencyMs}
            icon={<Activity aria-hidden="true" />}
          />
        </SectionCard>

        <SectionCard
          title="Ops Summary"
          description="Read-only collectors; unavailable sources are displayed as unavailable."
          icon={<TerminalSquare aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              { label: "Mode", value: ops.mode },
              { label: "Status", value: <StatusBadge tone={opsStatusTone(ops.status)}>{titleize(ops.status)}</StatusBadge> },
              {
                label: "Docker",
                value: ops.services.docker.available ? `${ops.services.docker.data.containers.length} containers` : "Unavailable",
                description: ops.services.docker.available ? undefined : ops.services.docker.message
              },
              {
                label: "Cloudflared",
                value: ops.services.cloudflared.available ? ops.services.cloudflared.data.status : "Unavailable",
                description: ops.services.cloudflared.available ? undefined : ops.services.cloudflared.message
              },
              {
                label: "Disk",
                value: ops.system.disk.available ? `${formatBytes(ops.system.disk.data.usedBytes)} used` : "Unavailable",
                description: ops.system.disk.available ? ops.system.disk.data.path : ops.system.disk.message
              },
              {
                label: "Deploy",
                value: ops.deploy.git.available ? `${ops.deploy.git.data.branch}@${ops.deploy.git.data.commit}` : "Unavailable",
                description: ops.deploy.git.available ? undefined : ops.deploy.git.message
              }
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard
        title="Latest Audit Events"
        description="Newest events from the audit log."
        icon={<FileClock aria-hidden="true" />}
      >
        <DataTable
          data={auditLog}
          getRowId={(event) => event.id}
          emptyState={
            <EmptyState
              icon={<FileClock aria-hidden="true" />}
              title="No audit events"
              description="Audit events will appear here as the API records control plane activity."
            />
          }
          columns={[
            {
              id: "time",
              header: "Time",
              cell: (event) => <span className="text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
            },
            {
              id: "action",
              header: "Action",
              cell: (event) => <span className="font-semibold text-foreground">{event.action}</span>
            },
            {
              id: "actor",
              header: "Actor",
              cell: (event) => <span className="text-muted-foreground">{titleize(event.actorType)}</span>
            },
            {
              id: "resource",
              header: "Resource",
              cell: (event) => (
                <span className="text-muted-foreground">
                  {event.resourceType}
                  {event.resourceId ? `:${event.resourceId}` : ""}
                </span>
              )
            },
            {
              id: "outcome",
              header: "Outcome",
              className: "text-right",
              cell: (event) => <StatusBadge tone={outcomeTone(event.outcome)}>{titleize(event.outcome)}</StatusBadge>
            }
          ]}
        />
      </SectionCard>
    </>
  );
}

function serviceTone(status: ServiceStatus): StatusTone {
  return status.ok ? "healthy" : "degraded";
}

function opsStatusTone(status: OpsStatus["status"]): StatusTone {
  if (status === "ok") return "healthy";
  if (status === "partial") return "degraded";
  return "offline";
}

function outcomeTone(outcome: AuditLogEvent["outcome"]): StatusTone {
  if (outcome === "success") return "healthy";
  if (outcome === "denied") return "protected";
  return "offline";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load dashboard data.";
}
