import { Activity, Database, KeyRound, Lock, Server, ShieldCheck, TerminalSquare, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import {
  FRANK_API_URL,
  FRANK_DASHBOARD_URL,
  MODEL_ROLES,
  PROVIDER_IDS,
  type ServiceStatus,
  type SystemStatus
} from "@frank/shared";
import { fetchSystemStatus } from "../api.js";
import {
  DataTable,
  HealthCheckRow,
  KeyValueList,
  SectionCard,
  StatCard,
  StatusBadge,
  type StatusTone
} from "../components/dashboard/index.js";
import { Alert, AlertDescription, AlertTitle, Skeleton } from "../components/ui/index.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: SystemStatus }
  | { status: "error"; message: string };

const opsControls = [
  { control: "Normal operation", state: "Dashboard-first", status: "healthy" as const },
  { control: "Approval gates", state: "Required", status: "protected" as const },
  { control: "Host commands", state: "Denied", status: "protected" as const },
  { control: "Destructive actions", state: "Denied", status: "protected" as const }
];

export function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    fetchSystemStatus()
      .then((data) => {
        if (active) {
          setState({ status: "ready", data });
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load system status."
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const generatedAt = state.status === "ready" ? new Date(state.data.generatedAt).toLocaleString() : "Pending";
  const apiStatus = getApiStatus(state);
  const postgresStatus = getServiceStatus(state, "postgres");
  const redisStatus = getServiceStatus(state, "redis");
  const accessStatus = getAccessStatus(state);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Activity aria-hidden="true" />}
          label="Dashboard"
          value={hostname(FRANK_DASHBOARD_URL)}
          description="Static Vite SPA served through Nginx."
          status="healthy"
          tone="good"
        />
        <StatCard
          icon={<Server aria-hidden="true" />}
          label="API"
          value={apiStatus.label}
          description="Fastify status endpoint behind Access."
          status={apiStatus.tone}
          tone={apiStatus.cardTone}
        />
        <StatCard
          icon={<Lock aria-hidden="true" />}
          label="Access"
          value={accessStatus.label}
          description="Cloudflare Tunnel and Access boundary."
          status={accessStatus.tone}
          tone="neutral"
        />
        <StatCard
          icon={<Database aria-hidden="true" />}
          label="Last Check"
          value={state.status === "loading" ? <Skeleton className="h-7 w-32" /> : generatedAt}
          description="Most recent API health payload."
          status={state.status === "loading" ? "checking" : state.status === "error" ? "offline" : "neutral"}
          tone={state.status === "error" ? "bad" : "neutral"}
        />
      </section>

      {state.status === "error" ? (
        <Alert variant="destructive" className="flex gap-3">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <AlertTitle>Status requires access</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Runtime"
          description="Core services required for normal hub operation."
          icon={<Database aria-hidden="true" />}
        >
          <HealthCheckRow
            label="Postgres"
            status={postgresStatus.tone}
            detail={postgresStatus.detail}
            latencyMs={postgresStatus.latencyMs}
            icon={<Database aria-hidden="true" />}
          />
          <HealthCheckRow
            label="Redis"
            status={redisStatus.tone}
            detail={redisStatus.detail}
            latencyMs={redisStatus.latencyMs}
            icon={<Server aria-hidden="true" />}
          />
          <HealthCheckRow
            label="Cloudflare Access"
            status={accessStatus.tone}
            detail={accessStatus.detail}
            icon={<ShieldCheck aria-hidden="true" />}
          />
        </SectionCard>

        <SectionCard
          title="Model Control Plane"
          description="Role-based routing foundation without provider runtime calls."
          icon={<Workflow aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              {
                label: "Roles",
                value: String(state.status === "ready" ? state.data.modelControlPlane.roleCount : MODEL_ROLES.length)
              },
              {
                label: "Providers",
                value: String(state.status === "ready" ? state.data.modelControlPlane.providerCount : PROVIDER_IDS.length)
              },
              { label: "Routing", value: "Role-based skeleton" },
              { label: "Provider calls", value: "Disabled" }
            ]}
          />
        </SectionCard>
      </section>

      <SectionCard
        title="No-Terminal Ops Console"
        description="Operational safeguards exposed as dashboard state."
        icon={<TerminalSquare aria-hidden="true" />}
        contentClassName="pb-3"
      >
        <DataTable
          data={opsControls}
          getRowId={(row) => row.control}
          columns={[
            {
              id: "control",
              header: "Control",
              cell: (row) => <span className="font-semibold text-foreground">{row.control}</span>
            },
            {
              id: "state",
              header: "State",
              cell: (row) => <span className="text-muted-foreground">{row.state}</span>
            },
            {
              id: "status",
              header: "Status",
              className: "text-right",
              cell: (row) => <StatusBadge tone={row.status} />
            }
          ]}
        />
      </SectionCard>
    </>
  );
}

function getApiStatus(state: LoadState): { label: string; tone: StatusTone; cardTone: "good" | "warn" | "bad" | "neutral" } {
  if (state.status === "loading") {
    return { label: "Checking", tone: "checking", cardTone: "neutral" };
  }

  if (state.status === "error") {
    return { label: "Access needed", tone: "offline", cardTone: "bad" };
  }

  const ok = state.data.services.postgres.ok && state.data.services.redis.ok;
  return ok
    ? { label: hostname(FRANK_API_URL), tone: "healthy", cardTone: "good" }
    : { label: "Degraded", tone: "degraded", cardTone: "warn" };
}

function getServiceStatus(
  state: LoadState,
  service: "postgres" | "redis"
): { tone: StatusTone; detail: string; latencyMs?: number | undefined } {
  if (state.status === "loading") {
    return { tone: "checking", detail: "Checking service health" };
  }

  if (state.status === "error") {
    return { tone: "offline", detail: "Status unavailable" };
  }

  const serviceStatus = state.data.services[service];
  return normalizeServiceStatus(serviceStatus);
}

function getAccessStatus(state: LoadState): { label: string; tone: StatusTone; detail: string } {
  if (state.status === "loading") {
    return { label: "Protected", tone: "checking", detail: "Checking access boundary" };
  }

  if (state.status === "error") {
    return { label: "Protected", tone: "protected", detail: "Dashboard is still behind Access" };
  }

  return {
    label: state.data.services.cloudflareAccess.message ?? "Enabled",
    tone: state.data.services.cloudflareAccess.ok ? "protected" : "degraded",
    detail: state.data.services.cloudflareAccess.message ?? "Access policy enforced"
  };
}

function normalizeServiceStatus(serviceStatus: ServiceStatus): { tone: StatusTone; detail: string; latencyMs?: number | undefined } {
  return {
    tone: serviceStatus.ok ? "healthy" : "degraded",
    detail: serviceStatus.message ?? (serviceStatus.ok ? "Healthy" : "Degraded"),
    latencyMs: serviceStatus.latencyMs
  };
}

function hostname(url: string) {
  return new URL(url).hostname;
}
