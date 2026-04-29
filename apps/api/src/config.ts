import { z } from "zod";

function booleanFromEnv(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

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
  OPENROUTER_API_KEY: z.string().optional(),
  HERMES_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  HERMES_API_BASE_URL: z.string().url().default("http://hermes:8642"),
  HERMES_API_SERVER_KEY: z.string().optional(),
  HERMES_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  HERMES_STALL_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  HERMES_EVENTS_POLL_MS: z.coerce.number().int().positive().default(1000),
  HERMES_WORKSPACE_ROOT: z.string().default("/opt/frank-hub/workspaces"),
  HERMES_ARTIFACT_ROOT: z.string().default("/opt/frank-hub/runtime/artifacts"),
  FRANK_BACKUP_ROOT: z.string().default("/opt/frank-backups"),
  LOG_LEVEL: z.string().default("info")
});

export type ApiConfig = ReturnType<typeof loadConfig>;

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
    openrouterApiKey: parsed.OPENROUTER_API_KEY?.trim() || undefined,
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
