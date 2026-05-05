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
  executionKind: string | null;
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

export interface HermesRunnerStatus {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  health: "ok" | "unavailable" | "error";
  models: string[];
  detailedHealth: JsonRecord | null;
  message: string | null;
}

export interface RunnerSummary {
  id: string;
  type: string;
  displayName: string;
  status: "disabled" | "not_configured" | "available" | "unavailable";
  configSummary: JsonRecord;
  health?: HermesRunnerStatus;
}

export interface HermesStatusResponse {
  runner: RunnerSummary;
  status: HermesRunnerStatus;
}

export interface HermesInstallCheckResponse {
  ok: boolean;
  status: HermesRunnerStatus;
  setupHints: string[];
}

export interface RunnerSession {
  id: string;
  taskId: string | null;
  runnerId: string;
  hermesRunId: string | null;
  conversationId: string | null;
  workspacePath: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  startedAt: string | null;
  finishedAt: string | null;
  lastEventAt: string | null;
  exitCode: number | null;
  errorSummary: string | null;
  finalOutput: string | null;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface RunnerEvent {
  id: string;
  runnerSessionId: string;
  taskId: string | null;
  source: "frank" | "hermes" | "system";
  eventType: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  rawEvent: JsonRecord | null;
  sequence: number;
  createdAt: string;
}

export interface RunnerLogEntry {
  sequence: number;
  severity: RunnerEvent["severity"];
  source: RunnerEvent["source"];
  message: string;
  eventType: string;
  createdAt: string;
}

export interface RunnerArtifact {
  id: string;
  taskId: string;
  runnerSessionId: string;
  artifactType: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  metadata: JsonRecord;
  createdAt: string;
  downloadPath: string;
}

export interface RunHermesResponse {
  task: Task;
  session: RunnerSession;
  reused: boolean;
}

export interface StopHermesResponse {
  task: Task;
  session: RunnerSession;
  stopResult: {
    stopped: boolean;
    method: "api" | "process" | "container" | "frank_only" | "unavailable";
    message: string;
  };
}

export interface RunnerEventsResponse {
  events: RunnerEvent[];
  last_sequence: number;
  next_cursor: number;
}

export interface TaskLogsResponse extends RunnerEventsResponse {
  logs: RunnerLogEntry[];
}

export interface TaskArtifactsResponse {
  artifacts: RunnerArtifact[];
}

export interface BackupRun {
  id: string;
  backupType: "postgres" | "files" | "preflight";
  status: "running" | "completed" | "failed";
  path: string | null;
  sizeBytes: number | null;
  branch: string | null;
  commit: string | null;
  metadata: JsonRecord;
  createdAt: string;
  finishedAt: string | null;
}

export interface BackupPreflightResponse {
  backup: BackupRun;
  status: JsonRecord;
}

export interface BackupStatusResponse {
  backups: BackupRun[];
  backupRoot: string;
}

export interface BackupRunResponse {
  backup: BackupRun;
}

export interface KillSwitchResponse {
  scope: "hermes";
  affectedSessions: Array<{
    sessionId: string;
    taskId: string | null;
    stopped: boolean;
    method: string;
    message: string;
  }>;
  outcome: "success" | "partial";
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

export interface OperatorAccessResponse {
  operator: {
    mode: "lab" | "guarded" | "production";
    repoWorkspacePath: string;
    allowedWorkspaces: string[];
    protectedPaths: string[];
    accessEnvPath: string;
    limits: {
      externalSendPerHour: number;
      apiSpendUsdPerDay: number;
      fileDeleteMaxCount: number;
      hostCommandTimeoutSeconds: number;
      databaseDestructiveRequiresLimit: boolean;
    };
  };
  accessProfile: {
    emailConfigured: boolean;
    mobileConfigured: boolean;
    whatsappConfigured: boolean;
    apiKeyNames: string[];
  };
  accessWrite: {
    enabled: boolean;
    written: boolean;
    allowedKeys: string[];
  };
  notes: string[];
}

export interface OperatorAccessWriteResponse extends OperatorAccessResponse {
  writtenKeys: Array<{
    key: string;
    configured: boolean;
    sensitive: boolean;
    fingerprint: string | null;
  }>;
}

export interface MessagingWhatsAppStatusResponse {
  whatsapp: {
    provider: "hermes_native";
    configured: boolean;
    enabled: boolean;
    mode: "bot" | "self-chat";
    numberConfigured: boolean;
    allowedUsersConfigured: boolean;
    webhookConfigured: boolean;
    webhookRoute: string;
  };
  hermes: {
    enabled: boolean;
    privateApiConfigured: boolean;
    apiBaseUrl: string;
  };
  notes: string[];
}

export interface MessagingNotifyResponse {
  accepted: boolean;
  message: string;
  whatsapp: MessagingWhatsAppStatusResponse["whatsapp"];
}

export interface ChatStatusResponse {
  provider: "openai";
  configured: boolean;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  model: string;
  baseUrl: string;
  notes: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChatMessageResponse {
  provider: "openai";
  model: string;
  responseId: string | null;
  assistantMessage: ChatMessage;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export type AiTool = "codex" | "claude_code";
export type BrowserTarget = "chatgpt" | "claude";

export interface AiToolStatus {
  installed?: boolean;
  path?: string | null;
}

export interface AiHostStatusResponse {
  configured: boolean;
  reachable: boolean;
  ok?: boolean;
  version?: string;
  runWild?: boolean;
  tools: {
    tmux?: AiToolStatus;
    git?: AiToolStatus;
    docker?: AiToolStatus;
    codex?: AiToolStatus;
    claudeCode?: AiToolStatus;
  };
  message?: string;
}

export interface AiToolSession {
  id: string;
  tool: AiTool;
  hostSessionId?: string;
  sessionName?: string;
  workspacePath: string;
  status: "running" | "stopped" | "failed";
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
}

export interface AiHandoff {
  id: string;
  targetTool: AiTool;
  title: string;
  summary: string;
  workspacePath: string;
  prompt: string;
  metadata: JsonRecord;
  createdAt: string;
}

export interface BrowserStatusResponse {
  running: boolean;
  url: string;
  configured?: boolean;
  message?: string;
}

export interface SelfUpgradeRun {
  id: string;
  goal: string;
  status: "queued" | "running" | "waiting_approval" | "deploying" | "completed" | "failed" | "cancelled" | "rolled_back";
  autoDeploy: boolean;
  branch: string;
  baseCommit: string | null;
  taskId: string | null;
  runnerSessionId: string | null;
  workspacePath: string;
  backupIds: string[];
  limits: JsonRecord;
  validationResults: JsonRecord;
  deployResult: JsonRecord;
  rollbackTarget: JsonRecord;
  metadata: JsonRecord;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface Project {
  id: string;
  slug: string;
  displayName: string;
  workspacePath: string;
  repoRemote: string | null;
  backupPolicy: string;
  status: "active" | "paused" | "archived";
  metadata: JsonRecord;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  executionKind?: string | null;
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
  body: Partial<
    Pick<Task, "title" | "description" | "state" | "priority" | "assignedAgentId" | "executionKind" | "metadata">
  > & {
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

export async function listRunners(options?: { signal?: AbortSignal }): Promise<RunnerSummary[]> {
  const data = await apiRequest<{ runners: RunnerSummary[] }>("/v1/runners", { signal: options?.signal });
  return data.runners;
}

export async function getHermesStatus(options?: { signal?: AbortSignal }): Promise<HermesStatusResponse> {
  return apiRequest<HermesStatusResponse>("/v1/runners/hermes/status", { signal: options?.signal });
}

export async function runHermesInstallCheck(): Promise<HermesInstallCheckResponse> {
  return apiRequest<HermesInstallCheckResponse>("/v1/runners/hermes/install-check", { method: "POST" });
}

export async function getHermesRunnerSession(
  id: string,
  options?: { signal?: AbortSignal }
): Promise<RunnerSession> {
  const data = await apiRequest<{ session: RunnerSession }>(`/v1/runners/hermes/sessions/${encodeURIComponent(id)}`, {
    signal: options?.signal
  });
  return data.session;
}

export async function listHermesRunnerSessionEvents(
  id: string,
  query: { afterSequence?: number; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<RunnerEventsResponse> {
  return apiRequest<RunnerEventsResponse>(`/v1/runners/hermes/sessions/${encodeURIComponent(id)}/events`, {
    query: cursorQuery(query),
    signal: options?.signal
  });
}

export async function runHermesTestRun(): Promise<{ session: RunnerSession; result: unknown }> {
  return apiRequest<{ session: RunnerSession; result: unknown }>("/v1/runners/hermes/test-run", { method: "POST" });
}

export async function stopHermesRunnerSession(
  sessionId: string,
  reason?: string
): Promise<{ session: RunnerSession; stopResult: StopHermesResponse["stopResult"] }> {
  return apiRequest<{ session: RunnerSession; stopResult: StopHermesResponse["stopResult"] }>(
    `/v1/runners/hermes/stop/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      body: reason ? { reason } : {}
    }
  );
}

export async function runTaskWithHermes(
  id: string,
  body: { force?: boolean; workspacePath?: string | null; metadata?: JsonRecord } = {}
): Promise<RunHermesResponse> {
  return apiRequest<RunHermesResponse>(`/v1/tasks/${encodeURIComponent(id)}/run-hermes`, {
    method: "POST",
    body
  });
}

export async function stopTaskHermes(id: string, reason?: string): Promise<StopHermesResponse> {
  return apiRequest<StopHermesResponse>(`/v1/tasks/${encodeURIComponent(id)}/stop-hermes`, {
    method: "POST",
    body: reason ? { reason } : {}
  });
}

export async function listTaskRunnerEvents(
  id: string,
  query: { afterSequence?: number; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<RunnerEventsResponse> {
  return apiRequest<RunnerEventsResponse>(`/v1/tasks/${encodeURIComponent(id)}/runner-events`, {
    query: cursorQuery(query),
    signal: options?.signal
  });
}

export async function listTaskLogs(
  id: string,
  query: { afterSequence?: number; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<TaskLogsResponse> {
  return apiRequest<TaskLogsResponse>(`/v1/tasks/${encodeURIComponent(id)}/logs`, {
    query: cursorQuery(query),
    signal: options?.signal
  });
}

export async function listTaskArtifacts(
  id: string,
  options?: { signal?: AbortSignal }
): Promise<TaskArtifactsResponse> {
  return apiRequest<TaskArtifactsResponse>(`/v1/tasks/${encodeURIComponent(id)}/artifacts`, {
    signal: options?.signal
  });
}

export function getArtifactDownloadUrl(downloadPath: string): string {
  return `${apiBase}${downloadPath.startsWith("/") ? downloadPath : `/${downloadPath}`}`;
}

export async function runBackupPreflight(): Promise<BackupPreflightResponse> {
  return apiRequest<BackupPreflightResponse>("/v1/backups/preflight", { method: "POST" });
}

export async function getBackupStatus(options?: { signal?: AbortSignal }): Promise<BackupStatusResponse> {
  return apiRequest<BackupStatusResponse>("/v1/backups/status", { signal: options?.signal });
}

export async function listBackups(
  query: { backupType?: BackupRun["backupType"]; limit?: number } = {},
  options?: { signal?: AbortSignal }
): Promise<BackupRun[]> {
  const data = await apiRequest<{ backups: BackupRun[] }>("/v1/backups", {
    query: {
      backup_type: query.backupType,
      limit: query.limit
    },
    signal: options?.signal
  });
  return data.backups;
}

export async function createPostgresBackup(): Promise<BackupRunResponse> {
  return apiRequest<BackupRunResponse>("/v1/backups/postgres", { method: "POST" });
}

export async function createFilesBackup(): Promise<BackupRunResponse> {
  return apiRequest<BackupRunResponse>("/v1/backups/files", { method: "POST" });
}

export async function runHermesKillSwitch(reason?: string): Promise<KillSwitchResponse> {
  return apiRequest<KillSwitchResponse>("/v1/runners/hermes/kill-switch", {
    method: "POST",
    body: reason ? { reason } : {}
  });
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

export async function getOperatorAccess(options?: { signal?: AbortSignal }): Promise<OperatorAccessResponse> {
  return apiRequest<OperatorAccessResponse>("/v1/operator/access", { signal: options?.signal });
}

export async function getChatStatus(options?: { signal?: AbortSignal }): Promise<ChatStatusResponse> {
  return apiRequest<ChatStatusResponse>("/v1/chat/status", { signal: options?.signal });
}

export async function sendChatMessage(body: {
  message: string;
  mode?: "chat" | "research" | "code" | "summarize";
  modelId?: string;
  previousResponseId?: string;
  metadata?: JsonRecord;
}): Promise<ChatMessageResponse> {
  return apiRequest<ChatMessageResponse>("/v1/chat/messages", {
    method: "POST",
    body
  });
}

export async function getAiHostStatus(options?: { signal?: AbortSignal }): Promise<AiHostStatusResponse> {
  return apiRequest<AiHostStatusResponse>("/v1/ai/host/status", { signal: options?.signal });
}

export async function listAiSessions(options?: { signal?: AbortSignal }): Promise<AiToolSession[]> {
  const data = await apiRequest<{ sessions: AiToolSession[] }>("/v1/ai/sessions", { signal: options?.signal });
  return data.sessions;
}

export async function createAiSession(body: {
  tool: AiTool;
  workspacePath: string;
  prompt?: string;
  metadata?: JsonRecord;
}): Promise<AiToolSession> {
  const data = await apiRequest<{ session: AiToolSession }>("/v1/ai/sessions", { method: "POST", body });
  return data.session;
}

export async function stopAiSession(id: string): Promise<AiToolSession> {
  const data = await apiRequest<{ session: AiToolSession }>(`/v1/ai/sessions/${encodeURIComponent(id)}/stop`, {
    method: "POST"
  });
  return data.session;
}

export async function getAiSessionOutput(id: string, options?: { signal?: AbortSignal }): Promise<string> {
  const data = await apiRequest<{ output: string }>(`/v1/ai/sessions/${encodeURIComponent(id)}/output`, {
    signal: options?.signal
  });
  return data.output;
}

export async function sendAiSessionInput(id: string, input: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/v1/ai/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    body: { input }
  });
}

export async function createAiHandoff(body: {
  targetTool: AiTool;
  title: string;
  summary: string;
  workspacePath: string;
  metadata?: JsonRecord;
}): Promise<AiHandoff> {
  const data = await apiRequest<{ handoff: AiHandoff }>("/v1/ai/handoffs", { method: "POST", body });
  return data.handoff;
}

export async function getBrowserStatus(options?: { signal?: AbortSignal }): Promise<BrowserStatusResponse> {
  return apiRequest<BrowserStatusResponse>("/v1/browser/status", { signal: options?.signal });
}

export async function startBrowser(target?: BrowserTarget): Promise<BrowserStatusResponse> {
  return apiRequest<BrowserStatusResponse>("/v1/browser/start", {
    method: "POST",
    body: target ? { target } : undefined
  });
}

export async function stopBrowser(): Promise<BrowserStatusResponse> {
  return apiRequest<BrowserStatusResponse>("/v1/browser/stop", { method: "POST" });
}

export async function writeOperatorAccess(values: Record<string, string>): Promise<OperatorAccessWriteResponse> {
  return apiRequest<OperatorAccessWriteResponse>("/v1/operator/access", {
    method: "PATCH",
    body: { values }
  });
}

export async function getWhatsAppStatus(options?: { signal?: AbortSignal }): Promise<MessagingWhatsAppStatusResponse> {
  return apiRequest<MessagingWhatsAppStatusResponse>("/v1/messaging/whatsapp/status", { signal: options?.signal });
}

export async function sendWhatsAppNotification(
  body: { message: string; metadata?: JsonRecord }
): Promise<MessagingNotifyResponse> {
  return apiRequest<MessagingNotifyResponse>("/v1/messaging/whatsapp/notify", {
    method: "POST",
    body
  });
}

export async function listSelfUpgrades(options?: { signal?: AbortSignal }): Promise<SelfUpgradeRun[]> {
  const data = await apiRequest<{ selfUpgradeRuns: SelfUpgradeRun[] }>("/v1/self-upgrades", { signal: options?.signal });
  return data.selfUpgradeRuns;
}

export async function getSelfUpgrade(id: string, options?: { signal?: AbortSignal }): Promise<SelfUpgradeRun> {
  const data = await apiRequest<{ selfUpgradeRun: SelfUpgradeRun }>(`/v1/self-upgrades/${encodeURIComponent(id)}`, {
    signal: options?.signal
  });
  return data.selfUpgradeRun;
}

export async function createSelfUpgrade(body: {
  goal: string;
  autoDeploy?: boolean;
  limits?: JsonRecord;
  metadata?: JsonRecord;
}): Promise<{ selfUpgradeRun: SelfUpgradeRun; task: Task }> {
  return apiRequest<{ selfUpgradeRun: SelfUpgradeRun; task: Task }>("/v1/self-upgrades", {
    method: "POST",
    body
  });
}

export async function cancelSelfUpgrade(id: string, reason?: string): Promise<{ selfUpgradeRun: SelfUpgradeRun }> {
  return apiRequest<{ selfUpgradeRun: SelfUpgradeRun }>(`/v1/self-upgrades/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: reason ? { reason } : {}
  });
}

export async function rollbackSelfUpgrade(id: string, reason?: string): Promise<{ selfUpgradeRun: SelfUpgradeRun; task: Task }> {
  return apiRequest<{ selfUpgradeRun: SelfUpgradeRun; task: Task }>(`/v1/self-upgrades/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    body: reason ? { reason } : {}
  });
}

export async function listProjects(options?: { signal?: AbortSignal }): Promise<Project[]> {
  const data = await apiRequest<{ projects: Project[] }>("/v1/projects", { signal: options?.signal });
  return data.projects;
}

export async function createProject(body: {
  slug: string;
  displayName: string;
  workspacePath?: string;
  repoRemote?: string | null;
  backupPolicy?: string;
  metadata?: JsonRecord;
}): Promise<Project> {
  const data = await apiRequest<{ project: Project }>("/v1/projects", {
    method: "POST",
    body
  });
  return data.project;
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

function cursorQuery(query: { afterSequence?: number; limit?: number }): Record<string, string | number | boolean | null | undefined> {
  return {
    after_sequence: query.afterSequence,
    limit: query.limit
  };
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
