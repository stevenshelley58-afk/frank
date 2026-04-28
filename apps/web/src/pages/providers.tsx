import { PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { listProviders, type Provider } from "../api.js";
import { formatDateTime, metadataPreview, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: Provider[] }
  | { status: "error"; message: string };

export function ProvidersPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const loadProviders = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    listProviders({ signal: controller.signal })
      .then((providers) => {
        setState({ status: "ready", data: providers });
        setSelectedProviderId((current) => current ?? providers[0]?.id ?? null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadProviders();
    return () => controller.abort();
  }, []);

  const providers = state.status === "ready" ? state.data : [];
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null,
    [providers, selectedProviderId]
  );

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadProviders()} />;
  }

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Provider Registry"
        description="Provider status and metadata from the live registry. Secrets are not displayed or editable."
        icon={<PlugZap aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => loadProviders()}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        <DataTable
          data={providers}
          getRowId={(provider) => provider.id}
          emptyState={
            <EmptyState
              icon={<PlugZap aria-hidden="true" />}
              title="No providers registered"
              description="Provider rows will appear here after seed data is present."
            />
          }
          columns={[
            {
              id: "provider",
              header: "Provider",
              cell: (provider) => (
                <button
                  type="button"
                  className="grid max-w-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedProviderId(provider.id)}
                >
                  <span className="font-semibold text-foreground">{provider.displayName}</span>
                  <code className="text-xs text-muted-foreground">{provider.id}</code>
                </button>
              )
            },
            {
              id: "enabled",
              header: "Enabled",
              cell: (provider) => <StatusBadge tone={provider.enabled ? "healthy" : "neutral"}>{provider.enabled ? "Yes" : "No"}</StatusBadge>
            },
            {
              id: "status",
              header: "Status",
              cell: (provider) => <StatusBadge tone={providerTone(provider.status)}>{titleize(provider.status)}</StatusBadge>
            },
            {
              id: "health",
              header: "Health",
              cell: (provider) => (
                <StatusBadge tone={healthTone(provider.health.status)}>{titleize(provider.health.status ?? "not_configured")}</StatusBadge>
              )
            },
            {
              id: "checked",
              header: "Checked",
              cell: (provider) => <span className="text-muted-foreground">{formatDateTime(provider.health.checkedAt)}</span>
            }
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Provider Details"
        description="Safe registry and health metadata for the selected provider."
        icon={<PlugZap aria-hidden="true" />}
      >
        {selectedProvider ? (
          <KeyValueList
            items={[
              { label: "ID", value: selectedProvider.id },
              { label: "Name", value: selectedProvider.displayName },
              { label: "Registry status", value: <StatusBadge tone={providerTone(selectedProvider.status)}>{titleize(selectedProvider.status)}</StatusBadge> },
              {
                label: "Health",
                value: (
                  <StatusBadge tone={healthTone(selectedProvider.health.status)}>
                    {titleize(selectedProvider.health.status ?? "not_configured")}
                  </StatusBadge>
                ),
                description: selectedProvider.health.message ?? undefined
              },
              { label: "Latency", value: selectedProvider.health.latencyMs === null ? "Unavailable" : `${selectedProvider.health.latencyMs}ms` },
              { label: "Created", value: formatDateTime(selectedProvider.createdAt) },
              { label: "Updated", value: formatDateTime(selectedProvider.updatedAt) },
              ...metadataPreview(selectedProvider.metadata).map((item) => ({
                label: `Metadata: ${item.label}`,
                value: item.value
              })),
              ...metadataPreview(selectedProvider.health.metadata).map((item) => ({
                label: `Health: ${item.label}`,
                value: item.value
              }))
            ]}
          />
        ) : (
          <EmptyState
            icon={<PlugZap aria-hidden="true" />}
            title="No provider selected"
            description="Select a provider to inspect its safe metadata."
          />
        )}
      </SectionCard>
    </section>
  );
}

function providerTone(status: Provider["status"]): StatusTone {
  if (status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "unavailable") return "offline";
  if (status === "not_configured") return "planned";
  return "neutral";
}

function healthTone(status: Provider["health"]["status"]): StatusTone {
  if (status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "unavailable") return "offline";
  return "planned";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load providers.";
}
