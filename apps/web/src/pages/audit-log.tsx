import { FileClock, RefreshCw, Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  DataTable,
  EmptyState,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge,
  type StatusTone
} from "../components/dashboard/index.js";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/index.js";
import { listAuditLog, type AuditLogEvent, type AuditLogResponse } from "../api.js";
import { formatDateTime, metadataPreview, summarizeValue, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: AuditLogResponse }
  | { status: "error"; message: string };

type ActorFilter = "all" | AuditLogEvent["actorType"];

export function AuditLogPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState<ActorFilter>("all");
  const [resourceType, setResourceType] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [limit, setLimit] = useState("50");

  const loadAuditLog = () => {
    const controller = new AbortController();
    const query: {
      action?: string;
      actor_type?: AuditLogEvent["actorType"];
      resource_type?: string;
      risk_level?: string;
      limit: number;
    } = {
      limit: Number(limit)
    };
    if (action.trim()) query.action = action.trim();
    if (actorType !== "all") query.actor_type = actorType;
    if (resourceType.trim()) query.resource_type = resourceType.trim();
    if (riskLevel.trim()) query.risk_level = riskLevel.trim();

    setState({ status: "loading" });
    listAuditLog(query, { signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadAuditLog();
    return () => controller.abort();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadAuditLog();
  }

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Filters"
        description="Supported server-side audit filters. Events are returned newest first."
        icon={<Search aria-hidden="true" />}
      >
        <form className="grid gap-3 lg:grid-cols-[1fr_12rem_1fr_1fr_9rem_auto]" onSubmit={handleSubmit}>
          <Input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Action" />
          <Select value={actorType} onValueChange={(value) => setActorType(value as ActorFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actors</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="worker">Worker</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
            </SelectContent>
          </Select>
          <Input value={resourceType} onChange={(event) => setResourceType(event.target.value)} placeholder="Resource type" />
          <Input value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} placeholder="Risk level" />
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={state.status === "loading"}>
            <RefreshCw aria-hidden="true" />
            Apply
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        title="Audit Events"
        description="Redacted metadata summaries are shown for review. Events cannot be edited or deleted here."
        icon={<FileClock aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => loadAuditLog()} disabled={state.status === "loading"}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        {state.status === "loading" ? <LoadingBlock rows={6} /> : null}
        {state.status === "error" ? <ResourceError message={state.message} onRetry={() => loadAuditLog()} /> : null}
        {state.status === "ready" ? (
          <DataTable
            data={state.data.auditLog}
            getRowId={(event) => event.id}
            emptyState={
              <EmptyState
                icon={<FileClock aria-hidden="true" />}
                title="No audit events"
                description="Try adjusting the filters or limit."
              />
            }
            columns={[
              {
                id: "time",
                header: "Time",
                cell: (event) => <span className="text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
              },
              {
                id: "actor",
                header: "Actor",
                cell: (event) => (
                  <div className="grid">
                    <span className="font-semibold text-foreground">{titleize(event.actorType)}</span>
                    <span className="text-xs text-muted-foreground">{event.actorId ?? "unknown"}</span>
                  </div>
                )
              },
              {
                id: "action",
                header: "Action",
                cell: (event) => <span className="font-semibold text-foreground">{event.action}</span>
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
                id: "metadata",
                header: "Metadata",
                cell: (event) => <span className="text-muted-foreground">{metadataLabel(event.metadata)}</span>
              },
              {
                id: "outcome",
                header: "Outcome",
                className: "text-right",
                cell: (event) => <StatusBadge tone={outcomeTone(event.outcome)}>{titleize(event.outcome)}</StatusBadge>
              }
            ]}
          />
        ) : null}
      </SectionCard>
    </section>
  );
}

function metadataLabel(metadata: unknown): string {
  const preview = metadataPreview(metadata, 2);
  if (preview.length === 0) {
    return summarizeValue(metadata) === "{}" ? "None" : summarizeValue(metadata);
  }
  return preview.map((item) => `${item.label}: ${item.value}`).join("; ");
}

function outcomeTone(outcome: AuditLogEvent["outcome"]): StatusTone {
  if (outcome === "success") return "healthy";
  if (outcome === "denied") return "protected";
  return "offline";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load audit events.";
}
