import { Boxes, RefreshCw, Route, Sparkles } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/index.js";
import {
  listFreeModels,
  listModelRoles,
  listModels,
  refreshOpenRouterModels,
  type Model,
  type ModelRole,
  type RefreshOpenRouterResult
} from "../api.js";
import { formatDateTime, metadataPreview, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ModelsData }
  | { status: "error"; message: string };

interface ModelsData {
  roles: ModelRole[];
  models: Model[];
  freeModels: Model[];
}

export function ModelsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshOpenRouterResult | { status: "error"; message: string } | null>(null);

  const loadModels = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      listModelRoles({ signal: controller.signal }),
      listModels({ limit: 500 }, { signal: controller.signal }),
      listFreeModels({ limit: 500 }, { signal: controller.signal })
    ])
      .then(([roles, models, freeModels]) => setState({ status: "ready", data: { roles, models, freeModels } }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadModels();
    return () => controller.abort();
  }, []);

  async function handleRefreshOpenRouter() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshOpenRouterModels();
      setRefreshResult(result);
      await Promise.all([listModels({ limit: 500 }), listFreeModels({ limit: 500 }), listModelRoles()]).then(
        ([models, freeModels, roles]) => setState({ status: "ready", data: { roles, models, freeModels } })
      );
    } catch (error) {
      setRefreshResult({ status: "error", message: errorMessage(error) });
    } finally {
      setRefreshing(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => loadModels()} />;
  }

  const { roles, models, freeModels } = state.data;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Model Control Plane"
        description="Role definitions and model metadata only. No inference calls are exposed."
        icon={<Route aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={handleRefreshOpenRouter} disabled={refreshing}>
            <RefreshCw aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh OpenRouter"}
          </Button>
        }
      >
        {refreshResult ? (
          <Alert
            variant={
              refreshResult.status === "success" ? "success" : refreshResult.status === "not_configured" ? "warning" : "destructive"
            }
          >
            <AlertTitle>
              {refreshResult.status === "not_configured"
                ? "OpenRouter not_configured"
                : refreshResult.status === "success"
                  ? "OpenRouter refreshed"
                  : "OpenRouter refresh failed"}
            </AlertTitle>
            <AlertDescription>
              {refreshResult.status === "success"
                ? `${refreshResult.refreshed} model records refreshed.`
                : refreshResult.status === "not_configured"
                  ? (refreshResult.message ?? "OPENROUTER_API_KEY is not configured.")
                  : refreshResult.message}
            </AlertDescription>
          </Alert>
        ) : (
          <KeyValueList
            items={[
              { label: "Roles", value: roles.length },
              { label: "Models", value: models.length },
              { label: "Free models", value: freeModels.length },
              { label: "Runtime inference", value: "Disabled" }
            ]}
          />
        )}
      </SectionCard>

      <Tabs defaultValue="roles" className="grid gap-5">
        <TabsList className="w-fit">
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="free">Free</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="mt-0">
          <SectionCard
            title="Model Roles"
            description="Agents request roles instead of hardcoded model names."
            icon={<Boxes aria-hidden="true" />}
          >
            <DataTable
              data={roles}
              getRowId={(role) => role.id}
              emptyState={
                <EmptyState
                  icon={<Boxes aria-hidden="true" />}
                  title="No model roles"
                  description="Model roles will appear here after the control plane seed data is present."
                />
              }
              columns={[
                {
                  id: "role",
                  header: "Role",
                  cell: (role) => (
                    <div className="grid max-w-lg">
                      <span className="font-semibold text-foreground">{titleize(role.id)}</span>
                      <span className="text-sm text-muted-foreground">{role.description}</span>
                    </div>
                  )
                },
                {
                  id: "budget",
                  header: "Budget",
                  cell: (role) => <StatusBadge tone="neutral">{titleize(role.defaultBudgetTier)}</StatusBadge>
                },
                {
                  id: "capabilities",
                  header: "Capabilities",
                  cell: (role) => <span className="text-muted-foreground">{role.requiredCapabilities.join(", ") || "None"}</span>
                },
                {
                  id: "updated",
                  header: "Updated",
                  cell: (role) => <span className="text-muted-foreground">{formatDateTime(role.updatedAt)}</span>
                }
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="models" className="mt-0">
          <ModelTable
            title="Model Catalog"
            description="Provider model metadata recorded by the backend."
            models={models}
            emptyTitle="No models loaded"
          />
        </TabsContent>

        <TabsContent value="free" className="mt-0">
          <ModelTable
            title="Free Models"
            description="Models whose stored pricing metadata is zero across known fields."
            models={freeModels}
            emptyTitle="No free models found"
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function ModelTable({
  title,
  description,
  models,
  emptyTitle
}: {
  title: string;
  description: string;
  models: Model[];
  emptyTitle: string;
}) {
  return (
    <SectionCard title={title} description={description} icon={<Sparkles aria-hidden="true" />}>
      <DataTable
        data={models}
        getRowId={(model) => model.id}
        emptyState={
          <EmptyState
            icon={<Sparkles aria-hidden="true" />}
            title={emptyTitle}
            description="Use the OpenRouter metadata refresh when the provider key is configured."
          />
        }
        columns={[
          {
            id: "model",
            header: "Model",
            cell: (model) => (
              <div className="grid max-w-lg">
                <span className="font-semibold text-foreground">{model.displayName}</span>
                <code className="text-xs text-muted-foreground">{model.modelKey}</code>
              </div>
            )
          },
          {
            id: "provider",
            header: "Provider",
            cell: (model) => <span className="text-muted-foreground">{model.providerId}</span>
          },
          {
            id: "capabilities",
            header: "Capabilities",
            cell: (model) => <span className="text-muted-foreground">{model.capabilities.join(", ") || "None"}</span>
          },
          {
            id: "status",
            header: "Status",
            cell: (model) => <StatusBadge tone={modelStatusTone(model.status)}>{titleize(model.status)}</StatusBadge>
          },
          {
            id: "free",
            header: "Pricing",
            cell: (model) => <StatusBadge tone={model.free ? "healthy" : "neutral"}>{model.free ? "Free" : "Recorded"}</StatusBadge>
          },
          {
            id: "metadata",
            header: "Metadata",
            cell: (model) => (
              <span className="text-muted-foreground">{metadataPreview(model.metadata, 1)[0]?.value ?? "None"}</span>
            )
          }
        ]}
      />
    </SectionCard>
  );
}

function modelStatusTone(status: Model["status"]): StatusTone {
  if (status === "available") return "healthy";
  if (status === "deprecated") return "degraded";
  if (status === "disabled") return "offline";
  return "neutral";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load model metadata.";
}
