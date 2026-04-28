import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PgPool } from "../db.js";

const auditActorTypes = ["system", "user", "worker", "agent"] as const;
const maxAuditLogLimit = 100;

const auditLogQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((value) => Math.min(value, maxAuditLogLimit)),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  actor_type: z.enum(auditActorTypes).optional(),
  action: z.string().trim().min(1).max(200).optional(),
  resource_type: z.string().trim().min(1).max(100).optional(),
  risk_level: z.string().trim().min(1).max(100).optional(),
  project_id: z.string().trim().min(1).max(200).optional(),
  since: z.string().trim().refine(isValidDate, "since must be a valid timestamp").optional(),
  until: z.string().trim().refine(isValidDate, "until must be a valid timestamp").optional()
});

interface AuditLogRow {
  id: string;
  occurred_at: Date | string;
  actor_type: (typeof auditActorTypes)[number];
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
}

export function registerAuditLogRoutes(server: FastifyInstance, pool: PgPool): void {
  server.get("/v1/audit-log", async (request, reply) => {
    const query = auditLogQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    if (query.data.since && query.data.until && new Date(query.data.since) > new Date(query.data.until)) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "since must be earlier than or equal to until."
      });
    }

    const where: string[] = [];
    const values: unknown[] = [];

    addWhere(where, values, "actor_type = $", query.data.actor_type);
    addWhere(where, values, "action = $", query.data.action);
    addWhere(where, values, "target_type = $", query.data.resource_type);
    addWhere(where, values, "metadata ->> 'risk_level' = $", query.data.risk_level);
    addWhere(where, values, "metadata ->> 'project_id' = $", query.data.project_id);

    if (query.data.since) {
      values.push(query.data.since);
      where.push(`occurred_at >= $${values.length}::timestamptz`);
    }
    if (query.data.until) {
      values.push(query.data.until);
      where.push(`occurred_at <= $${values.length}::timestamptz`);
    }

    values.push(query.data.limit, query.data.offset);
    const result = await pool.query<AuditLogRow>(
      `
        select
          id,
          occurred_at,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          outcome,
          metadata
        from audit_log
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by occurred_at desc, id desc
        limit $${values.length - 1}
        offset $${values.length}
      `,
      values
    );

    return {
      auditLog: result.rows.map(serializeAuditLogRow),
      pagination: {
        limit: query.data.limit,
        offset: query.data.offset,
        maxLimit: maxAuditLogLimit
      }
    };
  });
}

function addWhere(where: string[], values: unknown[], predicate: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  values.push(value);
  where.push(`${predicate}${values.length}`);
}

function serializeAuditLogRow(row: AuditLogRow) {
  return {
    id: row.id,
    occurredAt: serializeTimestamp(row.occurred_at),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.target_type,
    resourceId: row.target_id,
    outcome: row.outcome,
    metadata: redactSensitiveMetadata(row.metadata)
  };
}

export function redactSensitiveMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveMetadata(item));
  }
  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveMetadataKey(key) ? "[redacted]" : redactSensitiveMetadata(nestedValue);
  }
  return redacted;
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("private_key") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("credential")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
