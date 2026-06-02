import { z } from "zod";

function booleanFromEnv(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const operatorModeSchema = z.enum(["lab", "guarded", "production"]);
const whatsappModeSchema = z.enum(["bot", "self-chat"]);

const envSchema = z.object({
  FRANK_ENV: z.string().default("development"),
  FRANK_SYSTEM_NAME: z.string().default("Frank Hub"),
  FRANK_DOMAIN: z.string().default("frank.fail"),
  FRANK_DASHBOARD_URL: z.string().url().default("https://hub.frank.fail"),
  FRANK_API_URL: z.string().url().default("https://api.frank.fail"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("https://hub.frank.fail,http://localhost:3000"),
  CLOUDFLARE_ACCESS_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  CLOUDFLARE_ACCESS_ISSUER: z.string().url().optional(),
  CLOUDFLARE_ACCESS_AUD: z.string().optional(),
  CLOUDFLARE_ACCESS_AUDS: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_CHAT_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  FRANK_HOST_AGENT_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  FRANK_HOST_AGENT_BASE_URL: z.string().url().default("http://host.docker.internal:8787"),
  FRANK_HOST_AGENT_TOKEN: z.string().optional(),
  FRANK_HOST_AGENT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  HERMES_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  HERMES_API_BASE_URL: z.string().url().default("http://hermes:8642"),
  HERMES_API_SERVER_KEY: z.string().optional(),
  HERMES_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  HERMES_STALL_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  HERMES_EVENTS_POLL_MS: z.coerce.number().int().positive().default(1000),
  HERMES_WORKSPACE_ROOT: z.string().default("/opt/frank-hub/workspaces"),
  HERMES_ARTIFACT_ROOT: z.string().default("/opt/frank-hub/runtime/artifacts"),
  FRANK_BACKUP_ROOT: z.string().default("/opt/frank-backups"),
  FRANK_OPERATOR_MODE: operatorModeSchema.default("guarded"),
  FRANK_REPO_WORKSPACE_PATH: z.string().default("/opt/frank-hub"),
  FRANK_OPERATOR_ALLOWED_WORKSPACES: z.string().default("/opt/frank-hub/workspaces"),
  FRANK_OPERATOR_PROTECTED_PATHS: z.string().default(
    "/,/root,/etc,/boot,/var/lib/docker,/var/lib/postgresql,/opt/frank-backups,/opt/frank-hub/.env,/opt/frank-hub/runtime/access,/opt/frank-hub/runtime/hermes/.env,/opt/frank-hub/runtime/hermes/platforms/whatsapp/session"
  ),
  FRANK_ACCESS_ENV_PATH: z.string().default("/opt/frank-hub/runtime/access/frank-access.env"),
  FRANK_SECRET_WRITE_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  FRANK_SECRET_WRITE_ALLOWED_KEYS: z.string().default(
    "FRANK_EMAIL_ADDRESS,FRANK_MOBILE_NUMBER,FRANK_WHATSAPP_NUMBER,FRANK_API_KEY_NAMES,FRANK_EMAIL_APP_PASSWORD,FRANK_WHATSAPP_API_TOKEN,OPENAI_API_KEY,OPENAI_CHAT_MODEL,OPENAI_BASE_URL,OPENROUTER_API_KEY,FRANK_HOST_AGENT_TOKEN,FRANK_BROWSER_VNC_PASSWORD,WHATSAPP_ENABLED,WHATSAPP_MODE,WHATSAPP_ALLOWED_USERS,WEBHOOK_ENABLED,WEBHOOK_SECRET,HERMES_WEBHOOK_SECRET"
  ),
  FRANK_LIMIT_EXTERNAL_SEND_PER_HOUR: z.coerce.number().int().nonnegative().default(25),
  FRANK_LIMIT_API_SPEND_USD_PER_DAY: z.coerce.number().nonnegative().default(10),
  FRANK_LIMIT_FILE_DELETE_MAX_COUNT: z.coerce.number().int().nonnegative().default(500),
  FRANK_LIMIT_HOST_COMMAND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  FRANK_DATABASE_DESTRUCTIVE_REQUIRES_LIMIT: z.preprocess(booleanFromEnv, z.boolean()).default(true),
  FRANK_EMAIL_ADDRESS: z.string().optional(),
  FRANK_MOBILE_NUMBER: z.string().optional(),
  FRANK_WHATSAPP_NUMBER: z.string().optional(),
  FRANK_API_KEY_NAMES: z.string().optional(),
  WHATSAPP_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  WHATSAPP_MODE: whatsappModeSchema.default("bot"),
  WHATSAPP_ALLOWED_USERS: z.string().optional(),
  HERMES_WEBHOOK_BASE_URL: z.string().url().default("http://hermes:8644"),
  HERMES_WEBHOOK_ROUTE: z.string().default("frank-whatsapp"),
  HERMES_WEBHOOK_SECRET: z.string().optional(),
  AIONUI_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  AIONUI_VERSION: z.string().default("2.1.9"),
  AIONUI_PUBLIC_URL: z.string().url().default("https://aionui.frank.fail/?frank_bootstrapped=1"),
  AIONUI_INTERNAL_BASE_URL: z.string().url().default("http://aionui:25808"),
  AIONUI_ADMIN_CREDENTIALS_PATH: z.string().default("/opt/frank-hub/runtime/access/aionui-admin.json"),
  AIONUI_COOKIE_DOMAIN: z.string().default(".frank.fail"),
  AIONUI_WORKSPACE_MOUNTS: z.string().default("/opt/frank-projects,/opt/frank-hub/workspaces,/opt/frank-hub/runtime/artifacts"),
  FRANK_UPDATE_CHECK_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(true),
  FRANK_UPDATE_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  FRANK_UPDATE_GITHUB_REMOTE: z.string().default("origin"),
  FRANK_UPDATE_GITHUB_BRANCH: z.string().default("main"),
  LOG_LEVEL: z.string().default("info")
});

type LoadedApiConfig = ReturnType<typeof loadConfig>;
export type ApiConfig = Omit<LoadedApiConfig, "aionui" | "updates"> &
  Partial<Pick<LoadedApiConfig, "aionui" | "updates">>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  return {
    environment: parsed.FRANK_ENV,
    systemName: parsed.FRANK_SYSTEM_NAME,
    domain: parsed.FRANK_DOMAIN,
    dashboardUrl: parsed.FRANK_DASHBOARD_URL,
    apiUrl: parsed.FRANK_API_URL,
    port: parsed.API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    cloudflareAccess: {
      enabled: parsed.CLOUDFLARE_ACCESS_ENABLED,
      issuer: parsed.CLOUDFLARE_ACCESS_ISSUER?.replace(/\/$/, ""),
      audiences: parseCloudflareAccessAudiences(parsed.CLOUDFLARE_ACCESS_AUDS, parsed.CLOUDFLARE_ACCESS_AUD)
    },
    openai: {
      apiKey: parsed.OPENAI_API_KEY?.trim() || undefined,
      baseUrl: parsed.OPENAI_BASE_URL.replace(/\/$/, ""),
      chatModel: parsed.OPENAI_CHAT_MODEL?.trim() || ""
    },
    openrouterApiKey: parsed.OPENROUTER_API_KEY?.trim() || undefined,
    hostAgent: {
      enabled: parsed.FRANK_HOST_AGENT_ENABLED,
      baseUrl: parsed.FRANK_HOST_AGENT_BASE_URL.replace(/\/$/, ""),
      token: parsed.FRANK_HOST_AGENT_TOKEN?.trim() || undefined,
      timeoutSeconds: parsed.FRANK_HOST_AGENT_TIMEOUT_SECONDS
    },
    hermes: {
      enabled: parsed.HERMES_ENABLED,
      apiBaseUrl: parsed.HERMES_API_BASE_URL.replace(/\/$/, ""),
      apiServerKey: parsed.HERMES_API_SERVER_KEY?.trim() || undefined,
      timeoutSeconds: parsed.HERMES_TIMEOUT_SECONDS,
      stallTimeoutSeconds: parsed.HERMES_STALL_TIMEOUT_SECONDS,
      eventsPollMs: parsed.HERMES_EVENTS_POLL_MS,
      workspaceRoot: parsed.HERMES_WORKSPACE_ROOT,
      artifactRoot: parsed.HERMES_ARTIFACT_ROOT
    },
    backups: {
      root: parsed.FRANK_BACKUP_ROOT
    },
    operator: {
      mode: parsed.FRANK_OPERATOR_MODE,
      repoWorkspacePath: parsed.FRANK_REPO_WORKSPACE_PATH,
      allowedWorkspaces: parseWorkspaceList(parsed.FRANK_OPERATOR_ALLOWED_WORKSPACES, [
        parsed.HERMES_WORKSPACE_ROOT
      ]),
      protectedPaths: parseWorkspaceList(parsed.FRANK_OPERATOR_PROTECTED_PATHS, [
        "/",
        "/root",
        "/etc",
        "/boot",
        "/var/lib/docker",
        "/var/lib/postgresql",
        parsed.FRANK_BACKUP_ROOT,
        `${parsed.FRANK_REPO_WORKSPACE_PATH.replace(/\/$/, "")}/.env`,
        `${parsed.FRANK_REPO_WORKSPACE_PATH.replace(/\/$/, "")}/runtime/access`,
        `${parsed.FRANK_REPO_WORKSPACE_PATH.replace(/\/$/, "")}/runtime/hermes/.env`,
        `${parsed.FRANK_REPO_WORKSPACE_PATH.replace(/\/$/, "")}/runtime/hermes/platforms/whatsapp/session`
      ]),
      accessEnvPath: parsed.FRANK_ACCESS_ENV_PATH,
      secretWriteEnabled: parsed.FRANK_SECRET_WRITE_ENABLED,
      secretWriteAllowedKeys: parseCommaSeparatedList(parsed.FRANK_SECRET_WRITE_ALLOWED_KEYS),
      limits: {
        externalSendPerHour: parsed.FRANK_LIMIT_EXTERNAL_SEND_PER_HOUR,
        apiSpendUsdPerDay: parsed.FRANK_LIMIT_API_SPEND_USD_PER_DAY,
        fileDeleteMaxCount: parsed.FRANK_LIMIT_FILE_DELETE_MAX_COUNT,
        hostCommandTimeoutSeconds: parsed.FRANK_LIMIT_HOST_COMMAND_TIMEOUT_SECONDS,
        databaseDestructiveRequiresLimit: parsed.FRANK_DATABASE_DESTRUCTIVE_REQUIRES_LIMIT
      }
    },
    messaging: {
      whatsapp: {
        enabled: parsed.WHATSAPP_ENABLED,
        mode: parsed.WHATSAPP_MODE,
        allowedUsers: parseCommaSeparatedList(parsed.WHATSAPP_ALLOWED_USERS),
        webhookBaseUrl: parsed.HERMES_WEBHOOK_BASE_URL.replace(/\/$/, ""),
        webhookRoute: parsed.HERMES_WEBHOOK_ROUTE.trim() || "frank-whatsapp",
        webhookSecret: parsed.HERMES_WEBHOOK_SECRET?.trim() || undefined
      }
    },
    aionui: {
      enabled: parsed.AIONUI_ENABLED,
      version: parsed.AIONUI_VERSION.trim() || "2.1.9",
      publicUrl: parsed.AIONUI_PUBLIC_URL.replace(/\/$/, ""),
      internalBaseUrl: parsed.AIONUI_INTERNAL_BASE_URL.replace(/\/$/, ""),
      adminCredentialsPath: parsed.AIONUI_ADMIN_CREDENTIALS_PATH,
      cookieDomain: parsed.AIONUI_COOKIE_DOMAIN.trim() || ".frank.fail",
      workspaceMounts: parseCommaSeparatedList(parsed.AIONUI_WORKSPACE_MOUNTS)
    },
    updates: {
      checkEnabled: parsed.FRANK_UPDATE_CHECK_ENABLED,
      checkIntervalMinutes: parsed.FRANK_UPDATE_CHECK_INTERVAL_MINUTES,
      githubRemote: parsed.FRANK_UPDATE_GITHUB_REMOTE.trim() || "origin",
      githubBranch: parsed.FRANK_UPDATE_GITHUB_BRANCH.trim() || "main"
    },
    accessProfile: {
      emailAddress: cleanOptionalString(parsed.FRANK_EMAIL_ADDRESS),
      mobileNumber: cleanOptionalString(parsed.FRANK_MOBILE_NUMBER),
      whatsappNumber: cleanOptionalString(parsed.FRANK_WHATSAPP_NUMBER),
      apiKeyNames: parseCommaSeparatedList(parsed.FRANK_API_KEY_NAMES)
    },
    logLevel: parsed.LOG_LEVEL
  };
}

function parseCloudflareAccessAudiences(audiences: string | undefined, audience: string | undefined): string[] {
  const audienceList = parseCommaSeparatedList(audiences);
  return audienceList.length > 0 ? audienceList : parseCommaSeparatedList(audience);
}

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseWorkspaceList(value: string | undefined, fallback: string[]): string[] {
  const parsed = parseCommaSeparatedList(value);
  return parsed.length > 0 ? parsed : fallback;
}

function cleanOptionalString(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}
