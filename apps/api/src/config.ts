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
  OPENROUTER_API_KEY: z.string().optional(),
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
      audience: parsed.CLOUDFLARE_ACCESS_AUD
    },
    openrouterApiKey: parsed.OPENROUTER_API_KEY?.trim() || undefined,
    logLevel: parsed.LOG_LEVEL
  };
}
