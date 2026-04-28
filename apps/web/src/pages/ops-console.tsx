import { Database, HardDrive, RefreshCw, Server, TerminalSquare } from "lucide-react";
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
import { Button } from "../components/ui/index.js";
import {
  getOpsDeploy,
  getOpsServices,
  getOpsStatus,
  getOpsSystem,
  type OpsDeployResponse,
  type OpsServicesResponse,
  type OpsStatus,
  type OpsSystemResponse
} from "../api.js";
import { formatBytes, formatDateTime, formatDuration, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: OpsData }
  | { status: "error"; message: string };

interface OpsData {
  status: OpsStatus;
  services: OpsServicesResponse;
  system: OpsSystemResponse;
  deploy: OpsDeployResponse;
}

export function OpsConsolePage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadOps = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      getOpsStatus({ signal: controller.signal }),
      getOpsServices({ signal: controller.signal }),
      getOpsSystem({ signal: controller.signal }),
      getOpsDeploy({ signal: controller.signal })
    ])
      .then(([status, services, system, deploy]) => setState({ status: "ready", data: { status, services, system, deploy } }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadOps();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadOps()} />;
  }

  const { status, services, system, deploy } = state.data;
  const docker = services.services.docker;
  const cloudflared = services.services.cloudflared;
  const disk = system.system.disk;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Read-Only Status"
        description="Operational collectors only. No restart, deploy, shell, or destructive controls are exposed."
        icon={<TerminalSquare aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => loadOps()}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        <KeyValueList
          items={[
            { label: "Mode", value: status.mode },
            { label: "Overall status", value: <StatusBadge tone={opsTone(status.status)}>{titleize(status.status)}</StatusBadge> },
            { label: "Status generated", value: formatDateTime(status.generatedAt) },
            { label: "Services generated", value: formatDateTime(services.generatedAt) },
            { label: "System generated", value: formatDateTime(system.generatedAt) },
            { label: "Deploy generated", value: formatDateTime(deploy.generatedAt) }
          ]}
        />
      </SectionCard>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Services" description="Docker and tunnel collector state." icon={<Server aria-hidden="true" />}>
          <KeyValueList
            items={[
              {
                label: "Docker",
                value: docker.available ? <StatusBadge tone="healthy">Available</StatusBadge> : <StatusBadge tone="planned">Unavailable</StatusBadge>,
                description: docker.available ? `${docker.data.containers.length} containers` : docker.message
              },
              {
                label: "Cloudflared",
                value: cloudflared.available ? (
                  <StatusBadge tone={cloudflared.data.status === "active" ? "healthy" : "degraded"}>
                    {titleize(cloudflared.data.status)}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="planned">Unavailable</StatusBadge>
                ),
                description: cloudflared.available ? "systemctl collector returned status" : cloudflared.message
              }
            ]}
          />
        </SectionCard>

        <SectionCard title="System" description="Host, memory, and disk data from the API." icon={<Database aria-hidden="true" />}>
          <KeyValueList
            items={[
              { label: "Host", value: `${system.system.host.platform} ${system.system.host.release}` },
              { label: "Architecture", value: system.system.host.arch },
              { label: "Uptime", value: formatDuration(system.system.host.uptimeSeconds) },
              { label: "Memory used", value: formatBytes(system.system.memory.usedBytes) },
              { label: "Memory free", value: formatBytes(system.system.memory.freeBytes) },
              { label: "Process RSS", value: formatBytes(system.system.memory.processRssBytes) },
              {
                label: "Disk",
                value: disk.available ? formatBytes(disk.data.usedBytes) : "Unavailable",
                description: disk.available ? `${formatBytes(disk.data.freeBytes)} free at ${disk.data.path}` : disk.message
              }
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard title="Docker Containers" description="Container list when the collector is available." icon={<Server aria-hidden="true" />}>
        {docker.available ? (
          <DataTable
            data={docker.data.containers}
            getRowId={(container) => container.name}
            emptyState={
              <EmptyState
                icon={<Server aria-hidden="true" />}
                title="No containers reported"
                description="The Docker collector is available but returned no running containers."
              />
            }
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (container) => <span className="font-semibold text-foreground">{container.name}</span>
              },
              {
                id: "image",
                header: "Image",
                cell: (container) => <span className="text-muted-foreground">{container.image}</span>
              },
              {
                id: "status",
                header: "Status",
                cell: (container) => <span className="text-muted-foreground">{container.status}</span>
              },
              {
                id: "health",
                header: "Health",
                cell: (container) => (
                  <StatusBadge tone={containerHealthTone(container.health)}>{titleize(container.health ?? "unknown")}</StatusBadge>
                )
              },
              {
                id: "ports",
                header: "Local Ports",
                cell: (container) => (
                  <span className="text-muted-foreground">{container.localhostPorts.join(", ") || "None exposed"}</span>
                )
              }
            ]}
          />
        ) : (
          <EmptyState
            icon={<Server aria-hidden="true" />}
            title="Docker unavailable"
            description={docker.message}
          />
        )}
      </SectionCard>

      <SectionCard title="Deploy Metadata" description="Read-only git and deploy collector output." icon={<HardDrive aria-hidden="true" />}>
        <KeyValueList
          items={[
            {
              label: "Current branch",
              value: deploy.deploy.git.available ? deploy.deploy.git.data.branch : "Unavailable",
              description: deploy.deploy.git.available ? undefined : deploy.deploy.git.message
            },
            {
              label: "Current commit",
              value: deploy.deploy.git.available ? deploy.deploy.git.data.commit : "Unavailable",
              description: deploy.deploy.git.available ? undefined : deploy.deploy.git.message
            },
            {
              label: "Deploy timestamp",
              value: deploy.deploy.lastDeploy.available
                ? (deploy.deploy.lastDeploy.data.deployedAt ?? "Not recorded")
                : "Unavailable",
              description: deploy.deploy.lastDeploy.available
                ? deploy.deploy.lastDeploy.data.source
                : deploy.deploy.lastDeploy.message
            },
            {
              label: "App version",
              value: deploy.deploy.lastDeploy.available && deploy.deploy.lastDeploy.data.appVersion
                ? deploy.deploy.lastDeploy.data.appVersion
                : "Unavailable",
              description: deploy.deploy.lastDeploy.available
                ? (deploy.deploy.lastDeploy.data.appVersion ? undefined : "No app version recorded in deploy metadata.")
                : deploy.deploy.lastDeploy.message
            }
          ]}
        />
      </SectionCard>
    </section>
  );
}

function opsTone(status: OpsStatus["status"]): StatusTone {
  if (status === "ok") return "healthy";
  if (status === "partial") return "degraded";
  return "offline";
}

function containerHealthTone(health: string | null): StatusTone {
  if (health === "healthy") return "healthy";
  if (health === "unhealthy") return "offline";
  if (health === "starting") return "checking";
  return "neutral";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load ops console data.";
}
