import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const accessWriteSchema = z
  .object({
    values: z.record(z.string().max(20_000)).refine((values) => Object.keys(values).length > 0, {
      message: "At least one access value is required."
    })
  })
  .strict();

const sensitiveKeyPattern = /(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|KEY|AUTH|COOKIE|CREDENTIAL)/i;

export function registerOperatorRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/operator/access", async () => operatorAccessSummary(config));

  server.patch("/v1/operator/access", async (request, reply) => {
    const body = accessWriteSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    if (config.operator.mode !== "lab" || !config.operator.secretWriteEnabled) {
      return reply.code(403).send({
        error: "secret_write_disabled",
        message: "Access file writes require FRANK_OPERATOR_MODE=lab and FRANK_SECRET_WRITE_ENABLED=true."
      });
    }

    const allowedKeys = new Set(config.operator.secretWriteAllowedKeys);
    const keys = Object.keys(body.data.values);
    const deniedKey = keys.find((key) => !allowedKeys.has(key) || !isSafeEnvKey(key));
    if (deniedKey) {
      return reply.code(400).send({
        error: "access_key_denied",
        message: `Access key ${deniedKey} is not allowlisted for dashboard writes.`
      });
    }

    const actorId = getRequestActorId(request);
    const writtenKeys = keys.map((key) => keySummary(key, body.data.values[key] ?? ""));
    await writeAccessEnvFile(config.operator.accessEnvPath, body.data.values);
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId,
      action: "operator.access.write",
      targetType: "operator_access",
      targetId: config.operator.accessEnvPath,
      outcome: "success",
      metadata: {
        keys
      }
    });

    return {
      ...operatorAccessSummary(config),
      accessWrite: {
        enabled: true,
        written: true,
        allowedKeys: config.operator.secretWriteAllowedKeys
      },
      writtenKeys
    };
  });
}

function operatorAccessSummary(config: ApiConfig) {
  return {
    operator: {
      mode: config.operator.mode,
      repoWorkspacePath: config.operator.repoWorkspacePath,
      allowedWorkspaces: config.operator.allowedWorkspaces,
      protectedPaths: config.operator.protectedPaths,
      accessEnvPath: config.operator.accessEnvPath,
      limits: config.operator.limits
    },
    accessProfile: {
      emailConfigured: Boolean(config.accessProfile.emailAddress),
      mobileConfigured: Boolean(config.accessProfile.mobileNumber),
      whatsappConfigured: Boolean(config.accessProfile.whatsappNumber),
      apiKeyNames: config.accessProfile.apiKeyNames
    },
    accessWrite: {
      enabled: config.operator.mode === "lab" && config.operator.secretWriteEnabled,
      written: false,
      allowedKeys: config.operator.secretWriteAllowedKeys
    },
    notes: [
      "Frank access values are configured through the VPS env/access file, not committed repo files.",
      "Credential values are write-only from the dashboard and never returned by this API.",
      "Hermes-native WhatsApp is allowed only for the explicit lab slice documented in ADR-0002."
    ]
  };
}

async function writeAccessEnvFile(accessEnvPath: string, values: Record<string, string>): Promise<void> {
  const existing = await readEnvFile(accessEnvPath);
  const merged = new Map(existing);
  for (const [key, value] of Object.entries(values)) {
    merged.set(key, value);
  }

  const content = [
    "# Frank Hub VPS-only access file.",
    "# Managed by Frank when FRANK_SECRET_WRITE_ENABLED=true.",
    "# Do not commit this file.",
    "",
    ...[...merged.entries()].map(([key, value]) => `${key}=${formatEnvValue(value)}`),
    ""
  ].join("\n");

  const dir = path.dirname(accessEnvPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.frank-access-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, accessEnvPath);
  await chmod(accessEnvPath, 0o600).catch(() => undefined);
}

async function readEnvFile(accessEnvPath: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let content = "";
  try {
    content = await readFile(accessEnvPath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return result;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (key && isSafeEnvKey(key)) {
      result.set(key, unquoteEnvValue(rest.join("=")));
    }
  }
  return result;
}

function keySummary(key: string, value: string) {
  return {
    key,
    configured: value.trim().length > 0,
    sensitive: sensitiveKeyPattern.test(key),
    fingerprint: value ? `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 12)}` : null
  };
}

function isSafeEnvKey(key: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(key);
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function getRequestActorId(request: FastifyRequest): string {
  return request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown";
}
