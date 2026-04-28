import { LockKeyhole, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/index.js";
import { fetchSystemStatus, getOpsStatus, type OpsStatus } from "../api.js";
import type { SystemStatus } from "@frank/shared";
import { formatDateTime, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: { system: SystemStatus; ops: OpsStatus } }
  | { status: "error"; message: string };

export function SettingsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const loadSettings = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([fetchSystemStatus({ signal: controller.signal }), getOpsStatus({ signal: controller.signal })])
      .then(([system, ops]) => setState({ status: "ready", data: { system, ops } }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadSettings();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <LoadingBlock rows={6} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadSettings()} />;
  }

  const { system, ops } = state.data;

  return (
    <Tabs defaultValue="general" className="grid gap-5">
      <TabsList className="w-fit">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="access">Access</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-0">
        <SectionCard
          title="Read-Only Settings"
          description="Safe environment and endpoint summary from existing APIs. Secrets and raw env vars are not exposed."
          icon={<Settings aria-hidden="true" />}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => loadSettings()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          <KeyValueList
            items={[
              { label: "System", value: system.systemName },
              { label: "Environment", value: system.environment },
              { label: "Dashboard URL", value: system.dashboardUrl },
              { label: "API URL", value: system.apiUrl },
              { label: "Generated", value: formatDateTime(system.generatedAt) },
              { label: "Model routing", value: titleize(system.modelControlPlane.routingMode) },
              { label: "Ops mode", value: ops.mode },
              { label: "Terminal access", value: titleize(system.opsConsole.terminalAccess) }
            ]}
          />
        </SectionCard>
      </TabsContent>

      <TabsContent value="access" className="mt-0">
        <SectionCard
          title="Access Guardrails"
          description="Dashboard-visible posture only. No secret editing or provider key input is available."
          icon={<LockKeyhole aria-hidden="true" />}
          action={
            <StatusBadge tone={system.services.cloudflareAccess.ok ? "healthy" : "degraded"}>
              {system.services.cloudflareAccess.ok ? "Configured" : "Review"}
            </StatusBadge>
          }
        >
          <KeyValueList
            items={[
              {
                label: "Cloudflare Access",
                value: system.services.cloudflareAccess.message ?? "Unavailable",
                description: system.services.cloudflareAccess.ok ? "Access boundary is enabled or intentionally disabled in config." : undefined
              },
              { label: "Postgres", value: system.services.postgres.ok ? "Available" : "Unavailable", description: system.services.postgres.message },
              { label: "Redis", value: system.services.redis.ok ? "Available" : "Unavailable", description: system.services.redis.message },
              { label: "Deploy actions", value: "Not exposed" },
              { label: "Restart actions", value: "Not exposed" },
              { label: "Shell input", value: "Not exposed" },
              { label: "Secrets", value: "Not displayed" }
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Runtime Boundaries"
          description="The current frontend exposes read and review surfaces only."
          icon={<ShieldCheck aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              { label: "WhatsApp runtime", value: "Not wired" },
              { label: "Image generation runtime", value: "Not wired" },
              { label: "SearXNG", value: "Not wired" },
              { label: "Playwright", value: "Not wired" },
              { label: "code-server", value: "Not wired" },
              { label: "Infisical runtime", value: "Not wired" },
              { label: "LiteLLM runtime", value: "Not wired" },
              { label: "Model inference", value: "Not exposed" }
            ]}
          />
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load settings.";
}
