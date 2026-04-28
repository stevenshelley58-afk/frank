import {
  systemStatusSchema,
  type AgentPermissionLevel,
  type SystemStatus,
  type TaskState
} from "@frank/shared";

const apiBase = "/api";

export type JsonRecord = Record<string, unknown>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(message: string, options: { status: number; code?: string | undefined; body: unknown }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal | undefined;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  state: TaskState;
  priority: number;
  createdBy: string | null;
  assignedAgentId: string | null;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  actorType: "system" | "user" | "worker" | "agent";
  actorId: string | null;
  fromState: TaskState | null;
  toState: TaskState | null;
  metadata: JsonRecord;
  createdAt: string;
}

export interface Agent {
  id: string;
  displayName: string;
  description: string;
  status: "available" | "disabled" | "planned";
  modelRoleId: string | null;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPermission {
  permissionId: string;
  description: string;
  level: AgentPermissionLevel;
  source: "override" | "default";
  defaultDecision: "allow" | "deny" | "approval_required";
  metadata: JsonRecord;
  policyMetadata: JsonRecord;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Provider {
  id: string;
  displayName: string;
  status: "stubbed" | "not_configured" | "healthy" | "degraded" | "unavailable";
  enabled: boolean;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
  health: {
    status: "not_configured" | "healthy" | "degraded" | "unavailable" | null;
    checkedAt: string | null;
    latencyMs: number | null;
    message: string | null;
    metadata: JsonRecord;
  };
}

export interface ModelRole {
  id: string;
  description: string;
  requiredCapabilities: string[];
  defaultBudgetTier: "low" | "standard" | "high";
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  id: string;
  providerId: string;
  modelKey: string;
  displayName: string;
  capabilities: string[];
  status: "unknown" | "available" | "disabled" | "deprecated";
  free: boolean;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEvent {
  id: string;
  occurredAt: string;
  actorType: "system" | "user" | "worker" | "agent";
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: "success" | "failure" | "denied";
  metadata: unknown;
}

export interface AuditLogResponse {
  auditLog: AuditLogEvent[];
  pagination: {
    limit: number;
    offset: number;
    maxLimit: number;
  };
}

export type CollectorResult<T> =
  | {
      available: true;
      data: T;
      message?: string;
    }
  | {
      available: false;
      data: null;
      message: string;
    };

export interface OpsServicesData {
  docker: CollectorResult<{
    containers: Array<{
      name: string;
      image: string;
      status: string;
      health: string | null;
      uptime: string | null;
      localhostPorts: string[];
    }>;
  }>;
  cloudflared: CollectorResult<{
    status: string;
  }>;
}

export interface OpsSystemData {
  host: {
    platform: string;
    release: string;
    arch: string;
    uptimeSeconds: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    processRssBytes: number;
  };
  disk: CollectorResult<{
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
  }>;
}

export interface OpsDeployData {
  git: CollectorResult<{
    branch: string;
    commit: string;
    appVersion: string | null;
  }>;
  lastDeploy: CollectorResult<{
    deployedAt: string | null;
    source: string;
    appVersion: string | null;
  }>;
}

export interface OpsStatus {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  services: OpsServicesData;
  system: OpsSystemData;
  deploy: OpsDeployData;
  mode: "read_only";
}

export interface OpsServicesResponse {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  services: OpsServicesData;
  mode: "read_only";
}

export interface OpsSystemResponse {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  system: OpsSystemData;
  mode: "read_only";
}

export interface OpsDeployResponse {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  deploy: OpsDeployData;
  mode: "read_only";
}

export interface RefreshOpenRouterResult {
  providerId: "openrouter";
  status: "success" | "not_configured";
  refreshed: number;
  message?: string;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers({
    Accept: "application/json"
  });

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers
  };

  if (options.signal) {
    init.signal = options.signal;
  }

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiBase}${withQuery(path, options.query)}`, init);
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new ApiClientError(errorMessage(body, response.status), {
      status: response.status,
      code: errorCode(body),
      body
    });
  }

  return body as T;
}

export async function fetchSystemStatus(options?: { signal?: AbortSignal }): Promise<SystemStatus> {
  const data = await apiRequest<unknown>("/v1/system/status", { signal: options?.signal });
  return systemStatusSchema.parse(data);
}

export async function listTasks(
  query: { state?: TaskState; assignedAgentId?: string; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<Task[]> {
  const data = await apiRequest<{ tasks: Task[] }>("/v1/tasks", { query, signal: options?.signal });
  return data.tasks;
}

export async function createTask(body: {
  title: string;
  description?: string | null;
  priority?: number;
  assignedAgentId?: string | null;
  metadata?: JsonRecord;
}): Promise<Task> {
  const data = await apiRequest<{ task: Task }>("/v1/tasks", { method: "POST", body });
  return data.task;
}

export async function getTask(id: string, options?: { signal?: AbortSignal }): Promise<Task> {
  const data = await apiRequest<{ task: Task }>(`/v1/tasks/${encodeURIComponent(id)}`, { signal: options?.signal });
  return data.task;
}

export async function updateTask(
  id: string,
  body: Partial<Pick<Task, "title" | "description" | "state" | "priority" | "assignedAgentId" | "metadata">> & {
    reopened?: true | undefined;
  }
): Promise<Task> {
  const data = await apiRequest<{ task: Task }>(`/v1/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body
  });
  return data.task;
}

export async function listTaskEvents(id: string, options?: { signal?: AbortSignal }): Promise<TaskEvent[]> {
  const data = await apiRequest<{ events: TaskEvent[] }>(`/v1/tasks/${encodeURIComponent(id)}/events`, {
    signal: options?.signal
  });
  return data.events;
}

export async function appendTaskEvent(
  id: string,
  body: {
    eventType: string;
    actorType?: TaskEvent["actorType"];
    actorId?: string;
    fromState?: TaskState | null;
    toState?: TaskState | null;
    metadata?: JsonRecord;
  }
): Promise<TaskEvent> {
  const data = await apiRequest<{ event: TaskEvent }>(`/v1/tasks/${encodeURIComponent(id)}/events`, {
    method: "POST",
    body
  });
  return data.event;
}

export async function listAgents(options?: { signal?: AbortSignal }): Promise<Agent[]> {
  const data = await apiRequest<{ agents: Agent[] }>("/v1/agents", { signal: options?.signal });
  return data.agents;
}

export async function getAgent(id: string, options?: { signal?: AbortSignal }): Promise<Agent> {
  const data = await apiRequest<{ agent: Agent }>(`/v1/agents/${encodeURIComponent(id)}`, { signal: options?.signal });
  return data.agent;
}

export async function listAgentPermissions(
  id: string,
  options?: { signal?: AbortSignal }
): Promise<{ agent: Agent; permissions: AgentPermission[] }> {
  return apiRequest<{ agent: Agent; permissions: AgentPermission[] }>(
    `/v1/agents/${encodeURIComponent(id)}/permissions`,
    { signal: options?.signal }
  );
}

export async function updateAgentPermissions(
  id: string,
  permissions: Array<{ permissionId: string; level: AgentPermissionLevel; metadata?: JsonRecord }>
): Promise<{ agent: Agent; permissions: AgentPermission[] }> {
  return apiRequest<{ agent: Agent; permissions: AgentPermission[] }>(
    `/v1/agents/${encodeURIComponent(id)}/permissions`,
    {
      method: "PATCH",
      body: { permissions }
    }
  );
}

export async function listProviders(options?: { signal?: AbortSignal }): Promise<Provider[]> {
  const data = await apiRequest<{ providers: Provider[] }>("/v1/providers", { signal: options?.signal });
  return data.providers;
}

export async function listModelRoles(options?: { signal?: AbortSignal }): Promise<ModelRole[]> {
  const data = await apiRequest<{ modelRoles: ModelRole[] }>("/v1/model-roles", { signal: options?.signal });
  return data.modelRoles;
}

export async function listModels(
  query: { providerId?: string; status?: Model["status"]; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<Model[]> {
  const data = await apiRequest<{ models: Model[] }>("/v1/models", { query, signal: options?.signal });
  return data.models;
}

export async function listFreeModels(
  query: { providerId?: string; status?: Model["status"]; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<Model[]> {
  const data = await apiRequest<{ models: Model[] }>("/v1/models/free", { query, signal: options?.signal });
  return data.models;
}

export async function refreshOpenRouterModels(): Promise<RefreshOpenRouterResult> {
  return apiRequest<RefreshOpenRouterResult>("/v1/models/refresh-openrouter", { method: "POST" });
}

export async function listAuditLog(
  query: {
    action?: string;
    actor_type?: AuditLogEvent["actorType"];
    resource_type?: string;
    risk_level?: string;
    limit?: number;
    offset?: number;
  } = {},
  options?: { signal?: AbortSignal }
): Promise<AuditLogResponse> {
  return apiRequest<AuditLogResponse>("/v1/audit-log", { query, signal: options?.signal });
}

export async function getOpsStatus(options?: { signal?: AbortSignal }): Promise<OpsStatus> {
  return apiRequest<OpsStatus>("/v1/ops/status", { signal: options?.signal });
}

export async function getOpsServices(options?: { signal?: AbortSignal }): Promise<OpsServicesResponse> {
  return apiRequest<OpsServicesResponse>("/v1/ops/services", { signal: options?.signal });
}

export async function getOpsSystem(options?: { signal?: AbortSignal }): Promise<OpsSystemResponse> {
  return apiRequest<OpsSystemResponse>("/v1/ops/system", { signal: options?.signal });
}

export async function getOpsDeploy(options?: { signal?: AbortSignal }): Promise<OpsDeployResponse> {
  return apiRequest<OpsDeployResponse>("/v1/ops/deploy", { signal: options?.signal });
}

function withQuery(path: string, query: ApiRequestOptions["query"]): string {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }
  if (isRecord(body) && typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  return `Frank API returned HTTP ${status}`;
}

function errorCode(body: unknown): string | undefined {
  return isRecord(body) && typeof body.error === "string" ? body.error : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
