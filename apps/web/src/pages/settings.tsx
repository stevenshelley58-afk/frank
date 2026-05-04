import { LockKeyhole, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/index.js";
import { Input } from "../components/ui/input.js";
import { fetchSystemStatus, getOperatorAccess, getOpsStatus, writeOperatorAccess, type OperatorAccessResponse, type OpsStatus } from "../api.js";
import type { SystemStatus } from "@frank/shared";
import { formatDateTime, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: { system: SystemStatus; ops: OpsStatus; access: OperatorAccessResponse } }
  | { status: "error"; message: string };

export function SettingsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [accessKey, setAccessKey] = useState("FRANK_WHATSAPP_NUMBER");
  const [accessValue, setAccessValue] = useState("");
  const [writeMessage, setWriteMessage] = useState<string | null>(null);

  const loadSettings = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      fetchSystemStatus({ signal: controller.signal }),
      getOpsStatus({ signal: controller.signal }),
      getOperatorAccess({ signal: controller.signal })
    ])
      .then(([system, ops, access]) => setState({ status: "ready", data: { system, ops, access } }))
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

  const { system, ops, access } = state.data;

  async function writeAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWriteMessage(null);
    const key = accessKey.trim();
    if (!key || !accessValue) {
      return;
    }
    const result = await writeOperatorAccess({ [key]: accessValue });
    setAccessValue("");
    setWriteMessage(`Updated ${result.writtenKeys.map((item) => item.key).join(", ")}`);
    loadSettings();
  }

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
          description="Dashboard-visible posture and lab credential-write capability. Values are never displayed."
          icon={<LockKeyhole aria-hidden="true" />}
          action={
            <StatusBadge tone={system.services.cloudflareAccess.ok ? "healthy" : "degraded"}>
              {system.services.cloudflareAccess.ok ? "Configured" : "Review"}
            </StatusBadge>
          }
        >
          <KeyValueList
            items={[
              { label: "Operator mode", value: titleize(access.operator.mode) },
              { label: "Frank repo workspace", value: access.operator.repoWorkspacePath },
              { label: "Workspace allowlist", value: access.operator.allowedWorkspaces.join(", ") },
              {
                label: "Cloudflare Access",
                value: system.services.cloudflareAccess.message ?? "Unavailable",
                description: system.services.cloudflareAccess.ok ? "Access boundary is enabled or intentionally disabled in config." : undefined
              },
              { label: "Frank email", value: access.accessProfile.emailConfigured ? "Configured" : "Not configured" },
              { label: "Frank mobile", value: access.accessProfile.mobileConfigured ? "Configured" : "Not configured" },
              { label: "Frank WhatsApp", value: access.accessProfile.whatsappConfigured ? "Configured" : "Not configured" },
              {
                label: "API keys",
                value: access.accessProfile.apiKeyNames.length > 0 ? access.accessProfile.apiKeyNames.join(", ") : "None registered"
              },
              { label: "Access env", value: access.operator.accessEnvPath },
              { label: "Access write", value: access.accessWrite.enabled ? "Enabled" : "Disabled" },
              { label: "Allowed access keys", value: access.accessWrite.allowedKeys.length > 0 ? access.accessWrite.allowedKeys.join(", ") : "None" },
              { label: "Postgres", value: system.services.postgres.ok ? "Available" : "Unavailable", description: system.services.postgres.message },
              { label: "Redis", value: system.services.redis.ok ? "Available" : "Unavailable", description: system.services.redis.message },
              { label: "Deploy actions", value: access.operator.mode === "lab" ? "Operator mode" : "Guarded" },
              { label: "Restart actions", value: access.operator.mode === "lab" ? "Operator mode" : "Guarded" },
              { label: "Shell input", value: access.operator.mode === "lab" ? "Operator mode" : "Guarded" },
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
              { label: "WhatsApp runtime", value: "Hermes lab wiring" },
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

        <SectionCard
          title="Write Access"
          description="Lab-only write path for VPS runtime access values. Values are written to the access env file and then cleared from this form."
          icon={<LockKeyhole aria-hidden="true" />}
        >
          <form className="grid gap-3 md:grid-cols-[18rem_1fr_auto]" onSubmit={writeAccess}>
            <Input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="ENV_KEY" />
            <Input value={accessValue} onChange={(event) => setAccessValue(event.target.value)} placeholder="Value" type="password" />
            <Button type="submit" disabled={!access.accessWrite.enabled}>
              Save
            </Button>
          </form>
          {writeMessage ? <p className="mt-3 text-sm text-muted-foreground">{writeMessage}</p> : null}
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load settings.";
}
