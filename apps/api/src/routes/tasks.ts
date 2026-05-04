import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  TASK_EXECUTION_KINDS,
  TASK_STATES,
  validateTaskStateTransition,
  type TaskExecutionKind,
  type TaskState
} from "@frank/shared";
import { createHermesRunnerAdapter } from "@frank/hermes-runner";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const actorTypes = ["system", "user", "worker", "agent"] as const;

const taskStateSchema = z.enum(TASK_STATES);
const taskExecutionKindSchema = z.enum(TASK_EXECUTION_KINDS);
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
    executionKind: taskExecutionKindSchema.optional(),
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
    executionKind: taskExecutionKindSchema.optional(),
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

const runnerEventsQuerySchema = z.object({
  after_sequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const runHermesSchema = z
  .object({
    force: z.boolean().optional(),
    workspacePath: z.string().trim().min(1).nullable().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

const stopHermesSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional()
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
  execution_kind: TaskExecutionKind | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunnerSessionRow {
  id: string;
  task_id: string | null;
  runner_id: string;
  hermes_run_id: string | null;
  conversation_id: string | null;
  workspace_path: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  started_at: Date | string | null;
  finished_at: Date | string | null;
  last_event_at: Date | string | null;
  exit_code: number | null;
  error_summary: string | null;
  final_output: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunnerEventRow {
  id: string;
  runner_session_id: string;
  task_id: string | null;
  source: "frank" | "hermes" | "system";
  event_type: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  raw_event: Record<string, unknown> | null;
  sequence: number;
  created_at: Date | string;
}

interface RunnerArtifactRow {
  id: string;
  task_id: string | null;
  runner_session_id: string | null;
  artifact_type: string;
  name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
  created_at: Date | string;
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

export function registerTaskRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
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
            execution_kind,
            metadata
          )
          values ($1, $2, 'draft', $3, $4, $5, $6, $7::jsonb)
          returning ${taskSelectColumns}
        `,
        [
          body.data.title,
          body.data.description ?? null,
          body.data.priority ?? 100,
          actorId,
          body.data.assignedAgentId ?? null,
          body.data.executionKind ?? "manual_lifecycle",
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
      const transitionOptions: { reopened?: boolean } = body.data.reopened === true ? { reopened: true } : {};
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
        executionKind: body.data.executionKind ?? current.execution_kind,
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
            execution_kind = $7,
            metadata = $8::jsonb,
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
          nextTaskValues.executionKind,
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

  server.post("/v1/tasks/:id/run-hermes", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const body = runHermesSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const workspacePath = normalizeWorkspacePath(
      body.data.workspacePath ?? `${config.hermes.workspaceRoot.replace(/\/$/, "")}/tasks/${params.data.id}`,
      config
    );
    if (!workspacePath.ok) {
      return reply.code(400).send({
        error: "invalid_workspace",
        message: workspacePath.message
      });
    }

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

      const activeSession = await findActiveHermesSession(client, current.id);
      if (activeSession) {
        await client.query("commit");
        return {
          task: serializeTask(current),
          session: serializeRunnerSession(activeSession),
          reused: true
        };
      }

      await ensureHermesRunner(client);
      const session = await createHermesRunnerSession(client, {
        taskId: current.id,
        workspacePath: workspacePath.path,
        metadata: {
          requestedBy: actorId,
          force: body.data.force === true,
          backupPreflight: null,
          ...(body.data.metadata ?? {})
        }
      });

      const updatedResult = await client.query<TaskRow>(
        `
          update tasks
          set
            state = 'queued',
            execution_kind = 'hermes_operator',
            assigned_agent_id = coalesce(assigned_agent_id, 'ops'),
            queued_at = now(),
            finished_at = null,
            last_error = null,
            metadata = metadata || $2::jsonb,
            updated_at = now()
          where id = $1
          returning ${taskSelectColumns}
        `,
        [
          current.id,
          JSON.stringify({
            activeRunnerSessionId: session.id,
            executionRequestedBy: actorId
          })
        ]
      );
      const queuedTask = updatedResult.rows[0] ?? current;

      await insertTaskEvent(client, {
        taskId: current.id,
        eventType: "task.hermes_queued",
        actorType: "user",
        actorId,
        fromState: current.state,
        toState: "queued",
        metadata: {
          runnerSessionId: session.id
        }
      });
      await insertRunnerEvent(client, {
        runnerSessionId: session.id,
        taskId: current.id,
        source: "frank",
        eventType: "task.hermes_queued",
        severity: "info",
        message: "Task queued for Hermes operator execution.",
        rawEvent: {
          taskId: current.id
        }
      });
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "task.run_hermes",
        targetType: "task",
        targetId: current.id,
        outcome: "success",
        metadata: {
          runnerSessionId: session.id
        }
      });

      await client.query("commit");
      return reply.code(202).send({
        task: serializeTask(queuedTask),
        session: serializeRunnerSession(session),
        reused: false
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.post("/v1/tasks/:id/stop-hermes", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const body = stopHermesSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const session = await findActiveHermesSession(pool, params.data.id);
    if (!session) {
      return reply.code(404).send({
        error: "active_hermes_session_not_found",
        message: "No active Hermes session was found for this task."
      });
    }

    const reason = body.data.reason ?? "Stop requested from Frank task action.";
    const adapter = createHermesRunnerAdapter(config.hermes);
    const stopResult = await adapter.stopRun({
      runnerSessionId: session.id,
      hermesRunId: session.hermes_run_id,
      reason
    });
    const terminalTaskState: TaskState = stopResult.stopped ? "cancelled" : "failed";
    const terminalSessionState: RunnerSessionRow["status"] = stopResult.stopped ? "cancelled" : "failed";
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(
        `
          insert into runner_stop_requests (
            runner_session_id,
            task_id,
            requested_by,
            reason,
            status,
            method
          )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          session.id,
          session.task_id,
          actorId,
          reason,
          stopResult.stopped ? "succeeded" : "failed",
          stopResult.method
        ]
      );
      const updatedSession = await client.query<RunnerSessionRow>(
        `
          update runner_sessions
          set
            status = $2,
            finished_at = now(),
            error_summary = $3,
            updated_at = now()
          where id = $1
          returning ${runnerSessionSelectColumns}
        `,
        [session.id, terminalSessionState, stopResult.message]
      );
      const updatedTask = await client.query<TaskRow>(
        `
          update tasks
          set
            state = $2,
            finished_at = now(),
            last_error = $3,
            updated_at = now()
          where id = $1
          returning ${taskSelectColumns}
        `,
        [params.data.id, terminalTaskState, stopResult.message]
      );
      await insertTaskEvent(client, {
        taskId: params.data.id,
        eventType: stopResult.stopped ? "task.hermes_cancelled" : "task.hermes_stop_failed",
        actorType: "user",
        actorId,
        fromState: "running",
        toState: terminalTaskState,
        metadata: {
          runnerSessionId: session.id,
          method: stopResult.method
        }
      });
      await insertRunnerEvent(client, {
        runnerSessionId: session.id,
        taskId: params.data.id,
        source: "frank",
        eventType: stopResult.stopped ? "task.hermes_cancelled" : "task.hermes_stop_failed",
        severity: stopResult.stopped ? "success" : "error",
        message: stopResult.message,
        rawEvent: {
          method: stopResult.method
        }
      });
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: stopResult.stopped ? "task.stop_hermes" : "task.stop_hermes_failed",
        targetType: "task",
        targetId: params.data.id,
        outcome: stopResult.stopped ? "success" : "failure",
        metadata: {
          runnerSessionId: session.id,
          method: stopResult.method
        }
      });
      await client.query("commit");
      return {
        task: serializeTask(updatedTask.rows[0]!),
        session: serializeRunnerSession(updatedSession.rows[0]!),
        stopResult
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.get("/v1/tasks/:id/runner-events", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const query = runnerEventsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const events = await pool.query<RunnerEventRow>(
      `
        select ${runnerEventSelectColumns}
        from runner_events
        where task_id = $1
          and sequence > $2
        order by sequence asc
        limit $3
      `,
      [params.data.id, query.data.after_sequence, query.data.limit]
    );
    const lastSequence = events.rows.at(-1)?.sequence ?? query.data.after_sequence;
    return {
      events: events.rows.map(serializeRunnerEvent),
      last_sequence: lastSequence,
      next_cursor: lastSequence
    };
  });

  server.get("/v1/tasks/:id/logs", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const query = runnerEventsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const events = await listTaskRunnerEvents(pool, params.data.id, query.data.after_sequence, query.data.limit);
    const lastSequence = events.at(-1)?.sequence ?? query.data.after_sequence;
    return {
      logs: events.map((event) => ({
        sequence: event.sequence,
        severity: event.severity,
        source: event.source,
        message: event.message,
        eventType: event.event_type,
        createdAt: serializeTimestamp(event.created_at)
      })),
      events: events.map(serializeRunnerEvent),
      last_sequence: lastSequence,
      next_cursor: lastSequence
    };
  });

  server.get("/v1/tasks/:id/artifacts", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const result = await pool.query<RunnerArtifactRow>(
      `
        select ${runnerArtifactSelectColumns}
        from runner_artifacts
        where task_id = $1
        order by created_at desc
      `,
      [params.data.id]
    );
    return {
      artifacts: result.rows.map(serializeRunnerArtifact)
    };
  });

  server.get("/v1/artifacts/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const result = await pool.query<RunnerArtifactRow>(
      `
        select ${runnerArtifactSelectColumns}
        from runner_artifacts
        where id = $1
      `,
      [params.data.id]
    );
    const artifact = result.rows[0];
    if (!artifact) {
      return reply.code(404).send({
        error: "artifact_not_found",
        message: "Artifact not found."
      });
    }

    const artifactPath = path.resolve(artifact.storage_path);
    const artifactRoot = path.resolve(config.hermes.artifactRoot);
    if (!artifactPath.startsWith(`${artifactRoot}${path.sep}`) && artifactPath !== artifactRoot) {
      return reply.code(403).send({
        error: "artifact_path_denied",
        message: "Artifact path is outside the configured artifact root."
      });
    }

    const content = await readFile(artifactPath);
    return reply
      .header("Content-Type", artifact.content_type)
      .header("Content-Disposition", `attachment; filename="${safeDownloadName(artifact.name)}"`)
      .send(content);
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
  execution_kind,
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

const runnerSessionSelectColumns = `
  id,
  task_id,
  runner_id,
  hermes_run_id,
  conversation_id,
  workspace_path,
  status,
  started_at,
  finished_at,
  last_event_at,
  exit_code,
  error_summary,
  final_output,
  metadata,
  created_at,
  updated_at
`;

const runnerEventSelectColumns = `
  id,
  runner_session_id,
  task_id,
  source,
  event_type,
  severity,
  message,
  raw_event,
  sequence,
  created_at
`;

const runnerArtifactSelectColumns = `
  id,
  task_id,
  runner_session_id,
  artifact_type,
  name,
  storage_path,
  content_type,
  size_bytes,
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
    Object.hasOwn(body, "executionKind") ||
    Object.hasOwn(body, "metadata")
  );
}

async function findActiveHermesSession(db: Queryable, taskId: string): Promise<RunnerSessionRow | undefined> {
  const result = await db.query<RunnerSessionRow>(
    `
      select ${runnerSessionSelectColumns}
      from runner_sessions
      where task_id = $1
        and runner_id = 'hermes'
        and status in ('queued', 'starting', 'running', 'stopping')
      order by created_at desc
      limit 1
    `,
    [taskId]
  );
  return result.rows[0];
}

async function listTaskRunnerEvents(
  db: Queryable,
  taskId: string,
  afterSequence: number,
  limit: number
): Promise<RunnerEventRow[]> {
  const result = await db.query<RunnerEventRow>(
    `
      select ${runnerEventSelectColumns}
      from runner_events
      where task_id = $1
        and sequence > $2
      order by sequence asc
      limit $3
    `,
    [taskId, afterSequence, limit]
  );
  return result.rows;
}

async function ensureHermesRunner(db: Queryable): Promise<void> {
  await db.query(
    `
      insert into runners (id, type, display_name, status, config_summary)
      values ('hermes', 'hermes', 'Hermes Operator', 'disabled', '{}'::jsonb)
      on conflict (id) do nothing
    `
  );
}

async function createHermesRunnerSession(
  db: Queryable,
  input: { taskId: string; workspacePath: string; metadata: Record<string, unknown> }
): Promise<RunnerSessionRow> {
  const result = await db.query<RunnerSessionRow>(
    `
      insert into runner_sessions (
        task_id,
        runner_id,
        workspace_path,
        status,
        metadata
      )
      values ($1, 'hermes', $2, 'queued', $3::jsonb)
      returning ${runnerSessionSelectColumns}
    `,
    [input.taskId, input.workspacePath, JSON.stringify(input.metadata)]
  );
  const session = result.rows[0];
  if (!session) {
    throw new Error("Runner session insert did not return a row.");
  }
  return session;
}

async function insertRunnerEvent(
  db: Queryable,
  event: {
    runnerSessionId: string;
    taskId: string | null;
    source: "frank" | "hermes" | "system";
    eventType: string;
    severity: "info" | "warning" | "error" | "success";
    message: string;
    rawEvent: Record<string, unknown> | null;
  }
): Promise<RunnerEventRow> {
  const result = await db.query<RunnerEventRow>(
    `
      insert into runner_events (
        runner_session_id,
        task_id,
        source,
        event_type,
        severity,
        message,
        raw_event,
        sequence
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        coalesce((select max(sequence) + 1 from runner_events where runner_session_id = $1), 1)
      )
      returning ${runnerEventSelectColumns}
    `,
    [
      event.runnerSessionId,
      event.taskId,
      event.source,
      event.eventType,
      event.severity,
      event.message,
      JSON.stringify(event.rawEvent)
    ]
  );
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error("Runner event insert did not return a row.");
  }
  return inserted;
}

function getChangedFields(previous: TaskRow, next: TaskRow): string[] {
  const changed: string[] = [];
  if (previous.title !== next.title) changed.push("title");
  if (previous.description !== next.description) changed.push("description");
  if (previous.state !== next.state) changed.push("state");
  if (previous.priority !== next.priority) changed.push("priority");
  if (previous.assigned_agent_id !== next.assigned_agent_id) changed.push("assignedAgentId");
  if (previous.execution_kind !== next.execution_kind) changed.push("executionKind");
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
    executionKind: row.execution_kind,
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

function serializeRunnerSession(row: RunnerSessionRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    runnerId: row.runner_id,
    hermesRunId: row.hermes_run_id,
    conversationId: row.conversation_id,
    workspacePath: row.workspace_path,
    status: row.status,
    startedAt: serializeNullableTimestamp(row.started_at),
    finishedAt: serializeNullableTimestamp(row.finished_at),
    lastEventAt: serializeNullableTimestamp(row.last_event_at),
    exitCode: row.exit_code,
    errorSummary: row.error_summary,
    finalOutput: row.final_output,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeRunnerEvent(row: RunnerEventRow) {
  return {
    id: row.id,
    runnerSessionId: row.runner_session_id,
    taskId: row.task_id,
    source: row.source,
    eventType: row.event_type,
    severity: row.severity,
    message: row.message,
    rawEvent: row.raw_event,
    sequence: row.sequence,
    createdAt: serializeTimestamp(row.created_at)
  };
}

function serializeRunnerArtifact(row: RunnerArtifactRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    runnerSessionId: row.runner_session_id,
    artifactType: row.artifact_type,
    name: row.name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    downloadPath: `/v1/artifacts/${row.id}`
  };
}

function normalizeWorkspacePath(workspacePath: string, config: ApiConfig): { ok: true; path: string } | { ok: false; message: string } {
  const normalizedPath = normalizeOperatorPath(workspacePath);
  if (normalizedPath === "/" || normalizedPath === "/root") {
    return {
      ok: false,
      message: "Hermes workspace cannot be / or /root."
    };
  }

  if (isInsideAnyOperatorPath(normalizedPath, config.operator.protectedPaths)) {
    return {
      ok: false,
      message: "Hermes workspace is inside a protected Frank path."
    };
  }

  const allowedWorkspaces =
    config.operator.mode === "lab"
      ? config.operator.allowedWorkspaces
      : [config.hermes.workspaceRoot];
  if (!isInsideAnyOperatorPath(normalizedPath, allowedWorkspaces)) {
    return {
      ok: false,
      message: "Hermes workspace is outside the configured Frank operator workspace allowlist."
    };
  }

  return {
    ok: true,
    path: normalizedPath
  };
}

function isInsideAnyOperatorPath(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInsideOperatorPath(candidate, root));
}

function isInsideOperatorPath(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeOperatorPath(root);
  if (!normalizedRoot) {
    return false;
  }
  if (normalizedRoot === "/") {
    return candidate === "/";
  }
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

function normalizeOperatorPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNullableTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return serializeTimestamp(value);
}

function safeDownloadName(name: string): string {
  const cleaned = name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return cleaned || "artifact";
}
