import { Activity, Database, KeyRound, Lock, Server, ShieldCheck, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { MODEL_ROLES, PROVIDER_IDS, type SystemStatus } from "@frank/shared";
import { fetchSystemStatus } from "./api.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: SystemStatus }
  | { status: "error"; message: string };

export function App() {
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Frank Hub</p>
          <h1>System Dashboard</h1>
        </div>
        <div className="route-chip">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Cloudflare Tunnel: frank-hub-vps</span>
        </div>
      </header>

      <section className="status-band">
        <StatusTile
          icon={<Activity size={22} aria-hidden="true" />}
          label="Dashboard"
          value="hub.frank.fail"
          tone="good"
        />
        <StatusTile
          icon={<Server size={22} aria-hidden="true" />}
          label="API"
          value={state.status === "ready" ? serviceText(state.data.services.postgres.ok && state.data.services.redis.ok) : statusText(state)}
          tone={state.status === "ready" ? (state.data.services.postgres.ok && state.data.services.redis.ok ? "good" : "warn") : state.status === "error" ? "bad" : "neutral"}
        />
        <StatusTile
          icon={<Lock size={22} aria-hidden="true" />}
          label="Access"
          value={state.status === "ready" ? state.data.services.cloudflareAccess.message ?? "enabled" : "Protected"}
          tone="neutral"
        />
        <StatusTile
          icon={<Database size={22} aria-hidden="true" />}
          label="Last Check"
          value={generatedAt}
          tone="neutral"
        />
      </section>

      {state.status === "error" ? (
        <section className="alert-panel">
          <KeyRound size={22} aria-hidden="true" />
          <div>
            <h2>Status requires access</h2>
            <p>{state.message}</p>
          </div>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <Database size={20} aria-hidden="true" />
            <h2>Runtime</h2>
          </div>
          <dl className="metric-list">
            <Metric label="Postgres" value={state.status === "ready" ? serviceText(state.data.services.postgres.ok) : statusText(state)} />
            <Metric label="Redis" value={state.status === "ready" ? serviceText(state.data.services.redis.ok) : statusText(state)} />
            <Metric label="Audit Log" value="startup writes enabled" />
            <Metric label="Mode" value="dashboard-first" />
          </dl>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <Workflow size={20} aria-hidden="true" />
            <h2>Model Control Plane</h2>
          </div>
          <dl className="metric-list">
            <Metric label="Roles" value={String(state.status === "ready" ? state.data.modelControlPlane.roleCount : MODEL_ROLES.length)} />
            <Metric label="Providers" value={String(state.status === "ready" ? state.data.modelControlPlane.providerCount : PROVIDER_IDS.length)} />
            <Metric label="Routing" value="role-based skeleton" />
            <Metric label="Provider Calls" value="disabled" />
          </dl>
        </article>

        <article className="panel wide">
          <div className="panel-heading">
            <ShieldCheck size={20} aria-hidden="true" />
            <h2>No-terminal Ops Console</h2>
          </div>
          <div className="ops-row">
            <span>Read-only status</span>
            <span>approval gates</span>
            <span>host commands denied</span>
            <span>destructive actions denied</span>
          </div>
        </article>
      </section>
    </main>
  );
}

function StatusTile({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <article className={`status-tile ${tone}`}>
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function serviceText(ok: boolean) {
  return ok ? "healthy" : "degraded";
}

function statusText(state: LoadState) {
  if (state.status === "loading") {
    return "checking";
  }
  return "access needed";
}
