import { z } from "zod";
import { defaultProtectedPaths } from "./session-manager.js";

function booleanFromEnv(value: unknown): boolean {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const schema = z.object({
  FRANK_HOST_AGENT_HOST: z.string().default("127.0.0.1"),
  FRANK_HOST_AGENT_PORT: z.coerce.number().int().positive().default(8787),
  FRANK_HOST_AGENT_TOKEN: z.string().trim().min(1),
  FRANK_HOST_AGENT_BROWSER_COMPOSE: z.string().default("docker-compose.browser.yml"),
  FRANK_HOST_AGENT_REPO: z.string().default("/opt/frank-hub"),
  FRANK_HOST_AGENT_PROTECTED_PATHS: z.string().optional(),
  FRANK_HOST_AGENT_RUN_WILD: z.preprocess(booleanFromEnv, z.boolean()).default(true),
  AIONUI_VERSION: z.string().default("2.1.9"),
  AIONUI_PUBLIC_URL: z.string().url().default("https://hub.frank.fail/aionui/"),
  AIONUI_HOST_BASE_URL: z.string().url().default("http://127.0.0.1:25808"),
  AIONUI_ADMIN_CREDENTIALS_PATH: z.string().default("/opt/frank-hub/runtime/access/aionui-admin.json"),
  AIONUI_WORKSPACE_MOUNTS: z.string().default("/opt/frank-projects,/opt/frank-hub/workspaces,/opt/frank-hub/runtime/artifacts")
});

export type HostAgentConfig = ReturnType<typeof loadHostAgentConfig>;

export function loadHostAgentConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  return {
    host: parsed.FRANK_HOST_AGENT_HOST,
    port: parsed.FRANK_HOST_AGENT_PORT,
    token: parsed.FRANK_HOST_AGENT_TOKEN,
    browserComposeFile: parsed.FRANK_HOST_AGENT_BROWSER_COMPOSE,
    repoPath: parsed.FRANK_HOST_AGENT_REPO,
    runWild: parsed.FRANK_HOST_AGENT_RUN_WILD,
    protectedPaths: parseList(parsed.FRANK_HOST_AGENT_PROTECTED_PATHS) ?? defaultProtectedPaths,
    aionui: {
      version: parsed.AIONUI_VERSION.trim() || "2.1.9",
      publicUrl: parsed.AIONUI_PUBLIC_URL.replace(/\/$/, ""),
      hostBaseUrl: parsed.AIONUI_HOST_BASE_URL.replace(/\/$/, ""),
      adminCredentialsPath: parsed.AIONUI_ADMIN_CREDENTIALS_PATH,
      workspaceMounts: parseList(parsed.AIONUI_WORKSPACE_MOUNTS) ?? []
    }
  };
}

function parseList(value: string | undefined): string[] | undefined {
  const parsed = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : undefined;
}
