import { Bot, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AGENT_PERMISSION_LEVELS, type AgentPermissionLevel } from "@frank/shared";
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/index.js";
import {
  listAgentPermissions,
  listAgents,
  updateAgentPermissions,
  type Agent,
  type AgentPermission
} from "../api.js";
import { formatDateTime, metadataPreview, titleize } from "../lib/format.js";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export function AgentsPage() {
  const [agentsState, setAgentsState] = useState<LoadState<Agent[]>>({ status: "loading" });
  const [permissionsState, setPermissionsState] = useState<LoadState<AgentPermission[]>>({
    status: "ready",
    data: []
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<Record<string, AgentPermissionLevel>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAgents = () => {
    const controller = new AbortController();
    setAgentsState({ status: "loading" });
    listAgents({ signal: controller.signal })
      .then((agents) => {
        setAgentsState({ status: "ready", data: agents });
        setSelectedAgentId((current) => current ?? agents[0]?.id ?? null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setAgentsState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadAgents();
    return () => controller.abort();
  }, []);

  const agents = agentsState.status === "ready" ? agentsState.data : [];
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (!selectedAgent) {
      setPermissionsState({ status: "ready", data: [] });
      setPermissionDraft({});
      return;
    }

    const controller = new AbortController();
    setPermissionsState({ status: "loading" });
    setSaveMessage(null);
    listAgentPermissions(selectedAgent.id, { signal: controller.signal })
      .then(({ permissions }) => {
        setPermissionsState({ status: "ready", data: permissions });
        setPermissionDraft(
          Object.fromEntries(
            permissions.map((permission) => [
              permission.permissionId,
              safePermissionLevel(permission.permissionId, permission.level)
            ])
          )
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPermissionsState({ status: "error", message: errorMessage(error) });
        }
      });

    return () => controller.abort();
  }, [selectedAgent?.id]);

  async function handleSavePermissions() {
    if (!selectedAgent || permissionsState.status !== "ready") {
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const { permissions } = await updateAgentPermissions(
        selectedAgent.id,
        permissionsState.data.map((permission) => ({
          permissionId: permission.permissionId,
          level: safePermissionLevel(permission.permissionId, permissionDraft[permission.permissionId] ?? permission.level),
          metadata: permission.metadata
        }))
      );
      setPermissionsState({ status: "ready", data: permissions });
      setPermissionDraft(
        Object.fromEntries(
          permissions.map((permission) => [
            permission.permissionId,
            safePermissionLevel(permission.permissionId, permission.level)
          ])
        )
      );
      setSaveMessage("Permissions updated.");
    } catch (error) {
      setSaveMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <SectionCard
          title="Agent Registry"
          description="Seeded agents from the control plane API."
          icon={<Bot aria-hidden="true" />}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => loadAgents()} disabled={agentsState.status === "loading"}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          {agentsState.status === "loading" ? <LoadingBlock rows={5} /> : null}
          {agentsState.status === "error" ? <ResourceError message={agentsState.message} onRetry={() => loadAgents()} /> : null}
          {agentsState.status === "ready" ? (
            <DataTable
              data={agents}
              getRowId={(agent) => agent.id}
              emptyState={
                <EmptyState
                  icon={<Bot aria-hidden="true" />}
                  title="No agents registered"
                  description="Seeded agents will appear here after migrations run."
                />
              }
              columns={[
                {
                  id: "name",
                  header: "Agent",
                  cell: (agent) => (
                    <button
                      type="button"
                      className="grid max-w-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      <span className="font-semibold text-foreground">{agent.displayName}</span>
                      <span className="truncate text-sm text-muted-foreground">{agent.description}</span>
                    </button>
                  )
                },
                {
                  id: "role",
                  header: "Model Role",
                  cell: (agent) => (
                    <code className="rounded-sm bg-muted px-1.5 py-1 text-xs text-muted-foreground">
                      {agent.modelRoleId ?? "none"}
                    </code>
                  )
                },
                {
                  id: "status",
                  header: "Status",
                  className: "text-right",
                  cell: (agent) => <StatusBadge tone={agentStatusTone(agent.status)}>{titleize(agent.status)}</StatusBadge>
                }
              ]}
            />
          ) : null}
        </SectionCard>

        <SectionCard
          title="Agent Details"
          description="Description and metadata for the selected agent."
          icon={<ShieldCheck aria-hidden="true" />}
        >
          {selectedAgent ? (
            <KeyValueList
              items={[
                { label: "ID", value: selectedAgent.id },
                { label: "Status", value: <StatusBadge tone={agentStatusTone(selectedAgent.status)}>{titleize(selectedAgent.status)}</StatusBadge> },
                { label: "Model role", value: selectedAgent.modelRoleId ?? "None" },
                { label: "Created", value: formatDateTime(selectedAgent.createdAt) },
                { label: "Updated", value: formatDateTime(selectedAgent.updatedAt) },
                ...metadataPreview(selectedAgent.metadata).map((item) => ({
                  label: `Metadata: ${item.label}`,
                  value: item.value
                }))
              ]}
            />
          ) : (
            <EmptyState
              icon={<ShieldCheck aria-hidden="true" />}
              title="No agent selected"
              description="Select an agent to inspect its metadata and permissions."
            />
          )}
        </SectionCard>
      </section>

      <SectionCard
        title="Permissions"
        description="Permission edits use the existing API. Raw host command permissions remain denied."
        icon={<ShieldCheck aria-hidden="true" />}
        action={
          <Button
            type="button"
            size="sm"
            onClick={handleSavePermissions}
            disabled={!selectedAgent || permissionsState.status !== "ready" || saving}
          >
            <Save aria-hidden="true" />
            {saving ? "Saving" : "Save"}
          </Button>
        }
      >
        {saveMessage ? (
          <Alert variant={saveMessage === "Permissions updated." ? "success" : "destructive"} className="mb-4">
            <AlertTitle>{saveMessage === "Permissions updated." ? "Saved" : "Permission update failed"}</AlertTitle>
            <AlertDescription>{saveMessage}</AlertDescription>
          </Alert>
        ) : null}

        {permissionsState.status === "loading" ? <LoadingBlock rows={5} /> : null}
        {permissionsState.status === "error" ? <ResourceError message={permissionsState.message} /> : null}
        {permissionsState.status === "ready" ? (
          <DataTable
            data={permissionsState.data}
            getRowId={(permission) => permission.permissionId}
            emptyState={
              <EmptyState
                icon={<ShieldCheck aria-hidden="true" />}
                title="No permissions loaded"
                description="Permissions will appear here when an agent is selected."
              />
            }
            columns={[
              {
                id: "permission",
                header: "Permission",
                cell: (permission) => (
                  <div className="grid max-w-lg">
                    <span className="font-semibold text-foreground">{permission.permissionId}</span>
                    <span className="text-sm text-muted-foreground">{permission.description}</span>
                  </div>
                )
              },
              {
                id: "source",
                header: "Source",
                cell: (permission) => <span className="text-muted-foreground">{titleize(permission.source)}</span>
              },
              {
                id: "level",
                header: "Level",
                className: "w-52",
                cell: (permission) => {
                  const hostPermission = permission.permissionId === "tool.host";
                  const value = safePermissionLevel(
                    permission.permissionId,
                    permissionDraft[permission.permissionId] ?? permission.level
                  );
                  return (
                    <Select
                      value={value}
                      onValueChange={(level) =>
                        setPermissionDraft((current) => ({
                          ...current,
                          [permission.permissionId]: safePermissionLevel(
                            permission.permissionId,
                            level as AgentPermissionLevel
                          )
                        }))
                      }
                      disabled={hostPermission || saving}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_PERMISSION_LEVELS.map((level) => (
                          <SelectItem key={level} value={level} disabled={hostPermission && level !== "denied"}>
                            {titleize(level)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                }
              }
            ]}
          />
        ) : null}
      </SectionCard>
    </section>
  );
}

function safePermissionLevel(permissionId: string, level: AgentPermissionLevel): AgentPermissionLevel {
  return permissionId === "tool.host" ? "denied" : level;
}

function agentStatusTone(status: Agent["status"]): StatusTone {
  if (status === "available") return "healthy";
  if (status === "disabled") return "offline";
  return "planned";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load agents.";
}
