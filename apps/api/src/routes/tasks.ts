import { TASK_STATES, validateTaskStateTransition, type TaskState } from "@frank/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { PgPool } from "../db.js";

const actorTypes = ["system", "user", "worker", "agent"] as const;

const taskStateSchema = z.enum(TASK_STATES);
const uuidParamSchema = z.object({
  id: z.string().uuid()
});

const metadataSchema = z.record(z.unknown());

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    assignedAgentId: z.string().trim().min(1).nullable().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

const patchTaskSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    state: taskStateSchema.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    assignedAgentId: z.string().trim().min(1).nullable().optional(),
    metadata: metadataSchema.optional(),
    reopened: z.literal(true).optional()
  })
  .strict();

const listTasksQuerySchema = z.object({
  state: taskStateSchema.optional(),
  assignedAgentId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const createTaskEventSchema = z
  .object({
    eventType: z.string().trim().min(1),
    actorType: z.enum(actorTypes).optional(),
    actorId: z.string().trim().min(1).optional(),
    fromState: taskStateSchema.nullable().optional(),
    toState: taskStateSchema.nullable().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  state: TaskState;
  priority: number;
  created_by: string | null;
  assigned_agent_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskEventRow {
  id: string;
  task_id: string;
  event_type: string;
  actor_type: (typeof actorTypes)[number];
  actor_id: string | null;
  from_state: TaskState | null;
  to_state: TaskState | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

type TaskBodyPatch = z.infer<typeof patchTaskSchema>;

export function registerTaskRoutes(server: FastifyInstance, pool: PgPool): void {
  server.get("/v1/tasks", async (request, reply) => {
    const query = listTasksQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const where: string[] = [];
    const values: unknown[] = [];

    if (query.data.state) {
      values.push(query.data.state);
      where.push(`state = $${values.length}`);
    }
    if (query.data.assignedAgentId) {
      values.push(query.data.assignedAgentId);
      where.push(`assigned_agent_id = $${values.length}`);
    }

    values.push(query.data.limit);
    const result = await pool.query<TaskRow>(
      `
        select ${taskSelectColumns}
        from tasks
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by created_at desc
        limit $${values.length}
      `,
      values
    );

    return { tasks: result.rows.map(serializeTask) };
  });

  server.post("/v1/tasks", async (request, reply) => {
    const body = createTaskSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const client = await pool.connect();

    try {
      await client.query("begin");
      const task = await client.query<TaskRow>(
        `
          insert into tasks (
            title,
            description,
            state,
            priority,
            created_by,
            assigned_agent_id,
            metadata
          )
          values ($1, $2, 'draft', $3, $4, $5, $6::jsonb)
          returning ${taskSelectColumns}
        `,
        [
          body.data.title,
          body.data.description ?? null,
          body.data.priority ?? 100,
          actorId,
          body.data.assignedAgentId ?? null,
          JSON.stringify(body.data.metadata ?? {})
        ]
      );
      const createdTask = task.rows[0];
      if (!createdTask) {
        throw new Error("Task insert did not return a row.");
      }

      await insertTaskEvent(client, {
        taskId: createdTask.id,
        eventType: "task.created",
        actorType: "user",
        actorId,
        fromState: null,
        toState: createdTask.state,
        metadata: {}
      });

      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "task.create",
        targetType: "task",
        targetId: createdTask.id,
        outcome: "success",
        metadata: {
          state: createdTask.state,
          assignedAgentId: createdTask.assigned_agent_id
        }
      });

      await client.query("commit");
      return reply.code(201).send({ task: serializeTask(createdTask) });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.get("/v1/tasks/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const task = await findTask(pool, params.data.id);
    if (!task) {
      return reply.code(404).send({
        error: "task_not_found",
        message: "Task not found."
      });
    }

    return { task: serializeTask(task) };
  });

  server.patch("/v1/tasks/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = patchTaskSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    if (!hasTaskPatch(body.data)) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "PATCH /v1/tasks/:id requires at least one task field to update."
      });
    }

    const actorId = getRequestActorId(request);
    const client = await pool.connect();

    try {
      await client.query("begin");
      const currentResult = await client.query<TaskRow>(
        `
          select ${taskSelectColumns}
          from tasks
          where id = $1
          for update
        `,
        [params.data.id]
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("rollback");
        return reply.code(404).send({
          error: "task_not_found",
          message: "Task not found."
        });
      }

      const nextState = body.data.state ?? current.state;
      const stateChanged = nextState !== current.state;
      const transitionOptions = body.data.reopened === true ? { reopened: true } : {};
      const transition = validateTaskStateTransition(current.state, nextState, transitionOptions);

      if (!transition.ok) {
        await client.query("rollback");
        return reply.code(transition.statusCode ?? 409).send({
          error: transition.statusCode === 400 ? "invalid_reopen" : "invalid_state_transition",
          message: transition.reason ?? "Invalid task state transition."
        });
      }

      const nextTaskValues = {
        title: body.data.title ?? current.title,
        description: Object.hasOwn(body.data, "description") ? body.data.description ?? null : current.description,
        state: nextState,
        priority: body.data.priority ?? current.priority,
        assignedAgentId: Object.hasOwn(body.data, "assignedAgentId")
          ? body.data.assignedAgentId ?? null
          : current.assigned_agent_id,
        metadata: body.data.metadata ?? current.metadata
      };

      const updatedResult = await client.query<TaskRow>(
        `
          update tasks
          set
            title = $2,
            description = $3,
            state = $4,
            priority = $5,
            assigned_agent_id = $6,
            metadata = $7::jsonb,
            updated_at = now()
          where id = $1
          returning ${taskSelectColumns}
        `,
        [
          current.id,
          nextTaskValues.title,
          nextTaskValues.description,
          nextTaskValues.state,
          nextTaskValues.priority,
          nextTaskValues.assignedAgentId,
          JSON.stringify(nextTaskValues.metadata)
        ]
      );
      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new Error("Task update did not return a row.");
      }

      const changedFields = getChangedFields(current, updated);
      if (stateChanged) {
        await insertTaskEvent(client, {
          taskId: current.id,
          eventType: transition.reopen ? "task.reopened" : "task.state_changed",
          actorType: "user",
          actorId,
          fromState: current.state,
          toState: updated.state,
          metadata: {
            reopened: transition.reopen === true
          }
        });
      }

      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: transition.reopen ? "task.reopen" : "task.update",
        targetType: "task",
        targetId: current.id,
        outcome: "success",
        metadata: {
          changedFields,
          previousState: current.state,
          state: updated.state,
          reopened: transition.reopen === true
        }
      });

      await client.query("commit");
      return { task: serializeTask(updated) };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.get("/v1/tasks/:id/events", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const task = await findTask(pool, params.data.id);
    if (!task) {
      return reply.code(404).send({
        error: "task_not_found",
        message: "Task not found."
      });
    }

    const events = await pool.query<TaskEventRow>(
      `
        select ${taskEventSelectColumns}
        from task_events
        where task_id = $1
        order by created_at asc
      `,
      [params.data.id]
    );

    return { events: events.rows.map(serializeTaskEvent) };
  });

  server.post("/v1/tasks/:id/events", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const body = createTaskEventSchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const client = await pool.connect();

    try {
      await client.query("begin");
      const task = await client.query<{ id: string }>("select id from tasks where id = $1", [params.data.id]);
      if (!task.rows[0]) {
        await client.query("rollback");
        return reply.code(404).send({
          error: "task_not_found",
          message: "Task not found."
        });
      }

      const event = await insertTaskEvent(client, {
        taskId: params.data.id,
        eventType: body.data.eventType,
        actorType: body.data.actorType ?? "user",
        actorId: body.data.actorId ?? actorId,
        fromState: body.data.fromState ?? null,
        toState: body.data.toState ?? null,
        metadata: body.data.metadata ?? {}
      });

      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "task.event.append",
        targetType: "task",
        targetId: params.data.id,
        outcome: "success",
        metadata: {
          eventId: event.id,
          eventType: event.event_type
        }
      });

      await client.query("commit");
      return reply.code(201).send({ event: serializeTaskEvent(event) });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
}

const taskSelectColumns = `
  id,
  title,
  description,
  state,
  priority,
  created_by,
  assigned_agent_id,
  metadata,
  created_at,
  updated_at
`;

const taskEventSelectColumns = `
  id,
  task_id,
  event_type,
  actor_type,
  actor_id,
  from_state,
  to_state,
  metadata,
  created_at
`;

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

async function findTask(db: Queryable, id: string): Promise<TaskRow | undefined> {
  const result = await db.query<TaskRow>(
    `
      select ${taskSelectColumns}
      from tasks
      where id = $1
    `,
    [id]
  );
  return result.rows[0];
}

async function insertTaskEvent(
  db: Queryable,
  event: {
    taskId: string;
    eventType: string;
    actorType: (typeof actorTypes)[number];
    actorId: string | null;
    fromState: TaskState | null;
    toState: TaskState | null;
    metadata: Record<string, unknown>;
  }
): Promise<TaskEventRow> {
  const result = await db.query<TaskEventRow>(
    `
      insert into task_events (
        task_id,
        event_type,
        actor_type,
        actor_id,
        from_state,
        to_state,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      returning ${taskEventSelectColumns}
    `,
    [
      event.taskId,
      event.eventType,
      event.actorType,
      event.actorId,
      event.fromState,
      event.toState,
      JSON.stringify(event.metadata)
    ]
  );
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error("Task event insert did not return a row.");
  }
  return inserted;
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

function hasTaskPatch(body: TaskBodyPatch): boolean {
  return (
    Object.hasOwn(body, "title") ||
    Object.hasOwn(body, "description") ||
    Object.hasOwn(body, "state") ||
    Object.hasOwn(body, "priority") ||
    Object.hasOwn(body, "assignedAgentId") ||
    Object.hasOwn(body, "metadata")
  );
}

function getChangedFields(previous: TaskRow, next: TaskRow): string[] {
  const changed: string[] = [];
  if (previous.title !== next.title) changed.push("title");
  if (previous.description !== next.description) changed.push("description");
  if (previous.state !== next.state) changed.push("state");
  if (previous.priority !== next.priority) changed.push("priority");
  if (previous.assigned_agent_id !== next.assigned_agent_id) changed.push("assignedAgentId");
  if (JSON.stringify(previous.metadata) !== JSON.stringify(next.metadata)) changed.push("metadata");
  return changed;
}

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    state: row.state,
    priority: row.priority,
    createdBy: row.created_by,
    assignedAgentId: row.assigned_agent_id,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeTaskEvent(row: TaskEventRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    fromState: row.from_state,
    toState: row.to_state,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at)
  };
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
