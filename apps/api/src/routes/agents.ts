import { AGENT_PERMISSION_LEVELS, type AgentPermissionLevel } from "@frank/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { PgPool } from "../db.js";

const agentIdParamSchema = z.object({
  id: z.string().trim().min(1).max(100)
});

const permissionLevelSchema = z.enum(AGENT_PERMISSION_LEVELS);

const patchAgentPermissionsSchema = z
  .object({
    permissions: z
      .array(
        z
          .object({
            permissionId: z.string().trim().min(1).max(100),
            level: permissionLevelSchema,
            metadata: z.record(z.unknown()).optional()
          })
          .strict()
      )
      .min(1)
  })
  .strict();

interface AgentRow {
  id: string;
  display_name: string;
  description: string;
  status: "available" | "disabled" | "planned";
  model_role_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PermissionPolicyRow {
  id: string;
  description: string;
  default_decision: "allow" | "deny" | "approval_required";
  metadata: Record<string, unknown>;
}

interface AgentPermissionRow extends PermissionPolicyRow {
  level: AgentPermissionLevel | null;
  permission_metadata: Record<string, unknown> | null;
  permission_created_at: Date | string | null;
  permission_updated_at: Date | string | null;
}

export function registerAgentRoutes(server: FastifyInstance, pool: PgPool): void {
  server.get("/v1/agents", async () => {
    const result = await pool.query<AgentRow>(
      `
        select ${agentSelectColumns}
        from agents
        order by id asc
      `
    );

    return { agents: result.rows.map(serializeAgent) };
  });

  server.get("/v1/agents/:id", async (request, reply) => {
    const params = agentIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const agent = await findAgent(pool, params.data.id);
    if (!agent) {
      return reply.code(404).send({
        error: "agent_not_found",
        message: "Agent not found."
      });
    }

    return { agent: serializeAgent(agent) };
  });

  server.get("/v1/agents/:id/permissions", async (request, reply) => {
    const params = agentIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const agent = await findAgent(pool, params.data.id);
    if (!agent) {
      return reply.code(404).send({
        error: "agent_not_found",
        message: "Agent not found."
      });
    }

    return {
      agent: serializeAgent(agent),
      permissions: await listAgentPermissions(pool, params.data.id)
    };
  });

  server.patch("/v1/agents/:id/permissions", async (request, reply) => {
    const params = agentIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = patchAgentPermissionsSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const duplicate = firstDuplicate(body.data.permissions.map((permission) => permission.permissionId));
    if (duplicate) {
      return reply.code(400).send({
        error: "duplicate_permission",
        message: `Permission ${duplicate} was provided more than once.`
      });
    }

    const hostPermission = body.data.permissions.find(
      (permission) => permission.permissionId === "tool.host" && permission.level !== "denied"
    );
    if (hostPermission) {
      return reply.code(400).send({
        error: "host_permission_denied",
        message: "Raw host command permissions must remain denied."
      });
    }

    const actorId = getRequestActorId(request);
    const client = await pool.connect();

    try {
      await client.query("begin");
      const agent = await findAgent(client, params.data.id);
      if (!agent) {
        await client.query("rollback");
        return reply.code(404).send({
          error: "agent_not_found",
          message: "Agent not found."
        });
      }

      const requestedPermissionIds = body.data.permissions.map((permission) => permission.permissionId);
      const knownPolicies = await client.query<Pick<PermissionPolicyRow, "id">>(
        "select id from permission_policies where id = any($1::text[])",
        [requestedPermissionIds]
      );
      const knownPolicyIds = new Set(knownPolicies.rows.map((policy) => policy.id));
      const missingPermission = requestedPermissionIds.find((permissionId) => !knownPolicyIds.has(permissionId));
      if (missingPermission) {
        await client.query("rollback");
        return reply.code(400).send({
          error: "unknown_permission",
          message: `Unknown permission policy: ${missingPermission}.`
        });
      }

      for (const permission of body.data.permissions) {
        await client.query(
          `
            insert into agent_permissions (
              agent_id,
              permission_id,
              level,
              metadata
            )
            values ($1, $2, $3, $4::jsonb)
            on conflict (agent_id, permission_id) do update set
              level = excluded.level,
              metadata = excluded.metadata,
              updated_at = now()
          `,
          [
            agent.id,
            permission.permissionId,
            permission.level,
            JSON.stringify(permission.metadata ?? {})
          ]
        );
      }

      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "agent.permissions.update",
        targetType: "agent",
        targetId: agent.id,
        outcome: "success",
        metadata: {
          permissions: body.data.permissions.map((permission) => ({
            permissionId: permission.permissionId,
            level: permission.level
          }))
        }
      });

      const permissions = await listAgentPermissions(client, agent.id);
      await client.query("commit");

      return {
        agent: serializeAgent(agent),
        permissions
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
}

const agentSelectColumns = `
  id,
  display_name,
  description,
  status,
  model_role_id,
  metadata,
  created_at,
  updated_at
`;

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

async function findAgent(db: Queryable, id: string): Promise<AgentRow | undefined> {
  const result = await db.query<AgentRow>(
    `
      select ${agentSelectColumns}
      from agents
      where id = $1
    `,
    [id]
  );
  return result.rows[0];
}

async function listAgentPermissions(db: Queryable, agentId: string) {
  const result = await db.query<AgentPermissionRow>(
    `
      select
        p.id,
        p.description,
        p.default_decision,
        p.metadata,
        ap.level,
        ap.metadata as permission_metadata,
        ap.created_at as permission_created_at,
        ap.updated_at as permission_updated_at
      from permission_policies p
      left join agent_permissions ap
        on ap.permission_id = p.id
       and ap.agent_id = $1
      order by p.id asc
    `,
    [agentId]
  );

  return result.rows.map((row) => ({
    permissionId: row.id,
    description: row.description,
    level: row.level ?? defaultPermissionLevel(row.default_decision),
    source: row.level ? "override" : "default",
    defaultDecision: row.default_decision,
    metadata: row.permission_metadata ?? {},
    policyMetadata: row.metadata,
    createdAt: row.permission_created_at ? serializeTimestamp(row.permission_created_at) : null,
    updatedAt: row.permission_updated_at ? serializeTimestamp(row.permission_updated_at) : null
  }));
}

function defaultPermissionLevel(defaultDecision: PermissionPolicyRow["default_decision"]): AgentPermissionLevel {
  if (defaultDecision === "allow") {
    return "auto";
  }
  if (defaultDecision === "approval_required") {
    return "manual";
  }
  return "denied";
}

function serializeAgent(row: AgentRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    modelRoleId: row.model_role_id,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
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

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
