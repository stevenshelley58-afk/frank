import { isAbsolute } from 'node:path';

import { sql } from 'drizzle-orm';

import {
  AuditRepository,
  OutboxRepository,
  WorkItemRepository,
  buildEventEnvelope,
  eventSource,
  newId,
  schema,
} from '@frank/adapter-postgres';
import type {
  CanonicalValue,
  FrankDatabase,
  FrankTransaction,
  WorkState,
} from '@frank/adapter-postgres';

import {
  AlreadyTerminalError,
  WorkbenchCancellationService,
  WorkbenchNotFoundError,
} from '../workbench/cancellation.js';
import { WorkbenchStore } from '../workbench/store.js';
import type { WorkbenchState, WorkbenchTaskDef } from '../workbench/types.js';
import {
  dependenciesSatisfied,
  deriveMissionLifecycle,
  resolveMissionBudget,
  selectModelTier,
} from './helpers.js';
import type { MissionPlan } from './planner.js';
import type {
  CreateMissionInput,
  DurableMissionGraph,
  MissionLifecycle,
  MissionModelTier,
  MissionView,
  ResolvedMissionBudget,
  StopMissionInput,
  TickMissionsInput,
  TickMissionsResult,
} from './types.js';

const SYSTEM_ACTOR = { kind: 'service', id: 'mission-orchestrator' } as const;
const DEFAULT_SCHEDULER_INTERVAL_MS = 5_000;
const DEFAULT_POLICY_VERSION = 'mission-orchestrator.v1';
const TERMINAL_MISSION_STATES: readonly MissionLifecycle[] = [
  'completed',
  'failed',
  'cancelled',
];

export interface MissionPlanningPort {
  plan(objective: string): Promise<MissionPlan>;
}

export interface MissionOrchestratorOptions {
  readonly db: FrankDatabase;
  readonly planner: MissionPlanningPort;
  readonly workbenchStore?: WorkbenchStore;
  readonly cancellation?: WorkbenchCancellationService;
  /** Absolute host path mounted into each mission workbench. */
  readonly workspaceSource: string;
  readonly cheapModel: string;
  readonly strongModel: string;
  readonly schedulerIntervalMs?: number;
  readonly policyVersion?: string;
  readonly now?: () => Date;
  readonly log?: (message: string, error?: unknown) => void;
}

export class MissionNotFoundError extends Error {
  constructor(readonly missionId: string) {
    super(`mission ${missionId} not found`);
    this.name = 'MissionNotFoundError';
  }
}

export class MissionAlreadyTerminalError extends Error {
  constructor(
    readonly missionId: string,
    readonly state: MissionLifecycle,
  ) {
    super(`mission ${missionId} is already in terminal state "${state}"`);
    this.name = 'MissionAlreadyTerminalError';
  }
}

export class RoomUnavailableError extends Error {
  constructor(readonly roomName: string, reason: string) {
    super(`room ${JSON.stringify(roomName)} is unavailable: ${reason}`);
    this.name = 'RoomUnavailableError';
  }
}

type MissionRow = {
  id: string;
  cell_id: string;
  room_id: string;
  room_name: string;
  root_work_item_id: string;
  idempotency_key: string;
  objective: string;
  planned_work_graph: unknown;
  state: MissionLifecycle;
  spend_limit: string | number;
  token_limit: number;
  wall_clock_limit_seconds: number;
  attempt_limit: number;
  stop_new_work: boolean;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  error: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type LockedMissionRow = Omit<MissionRow, 'room_name'>;

type RoomLookupRow = {
  id: string;
  state: 'active' | 'completed' | 'failed' | 'cancelled';
  paused: boolean;
  budget: unknown;
};

type WorkItemSnapshot = {
  id: string;
  state: WorkState;
  version: number;
};

type WorkbenchSnapshot = {
  id: string;
  work_item_id: string;
  state: WorkbenchState;
  attempts: number;
  last_error: string | null;
  created_at: Date | string;
};

type MutableNode = {
  key: string;
  work_item_id: string;
  title: string;
  state: string;
  depends_on: string[];
  workbench_id: string | null;
  workbench_state: string | null;
  attempts: number;
  model_tier: MissionModelTier;
  instruction: string;
  timeout_seconds: number;
  verification: string;
};

interface TickOneResult {
  readonly changed: boolean;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly released: number;
  readonly cancellationIds: readonly string[];
  readonly cellId: string;
  readonly correlationId: string;
  readonly now: Date;
}

export class MissionOrchestrator {
  readonly #db: FrankDatabase;
  readonly #planner: MissionPlanningPort;
  readonly #workbenchStore: WorkbenchStore;
  readonly #cancellation: WorkbenchCancellationService;
  readonly #work = new WorkItemRepository();
  readonly #audit = new AuditRepository();
  readonly #outbox = new OutboxRepository();
  readonly #workspaceSource: string;
  readonly #cheapModel: string;
  readonly #strongModel: string;
  readonly #schedulerIntervalMs: number;
  readonly #policyVersion: string;
  readonly #now: () => Date;
  readonly #log: (message: string, error?: unknown) => void;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #schedulerRunning = false;
  #activeTick: Promise<void> | null = null;

  constructor(options: MissionOrchestratorOptions) {
    if (!isAbsolute(options.workspaceSource)) {
      throw new Error('MissionOrchestrator workspaceSource must be an absolute host path');
    }
    if (options.cheapModel.trim() === '' || options.strongModel.trim() === '') {
      throw new Error('MissionOrchestrator cheapModel and strongModel must be non-blank');
    }
    const interval = options.schedulerIntervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS;
    if (!Number.isSafeInteger(interval) || interval < 250) {
      throw new Error('MissionOrchestrator schedulerIntervalMs must be an integer >= 250');
    }

    this.#db = options.db;
    this.#planner = options.planner;
    this.#workbenchStore = options.workbenchStore ?? new WorkbenchStore(options.db);
    this.#cancellation = options.cancellation ?? new WorkbenchCancellationService(options.db);
    this.#workspaceSource = options.workspaceSource;
    this.#cheapModel = options.cheapModel;
    this.#strongModel = options.strongModel;
    this.#schedulerIntervalMs = interval;
    this.#policyVersion = options.policyVersion ?? DEFAULT_POLICY_VERSION;
    this.#now = options.now ?? (() => new Date());
    this.#log = options.log ?? (() => undefined);
  }

  async create(input: CreateMissionInput): Promise<MissionView> {
    assertCreateInput(input);
    const replay = await this.#findMissionByCommand(input.cellId, input.commandId);
    if (replay !== null) return replay;

    const budget = resolveMissionBudget(input.budget);
    const plan = await this.#planner.plan(input.objective.trim());
    const actorRef = `${input.actor.kind}/${input.actor.id}`;
    const missionId = newId();
    const roomName = normalizedRoomName(
      input.roomName,
      input.title,
      input.objective,
      missionId,
    );
    const rootWorkItemId = newId();

    const persistedMissionId = await this.#db.transaction(async (tx) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`${input.cellId}:${input.commandId}`}, 0))
      `);
      const existing = await tx.execute<{ id: string }>(sql`
        select id from "frank_domain"."mission"
        where cell_id = ${input.cellId} and idempotency_key = ${input.commandId}
      `);
      if (existing.rows[0] !== undefined) return existing.rows[0].id;

      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`${input.cellId}:room:${roomName}`}, 0))
      `);

      const room = await this.#getOrCreateRoom(tx, {
        cellId: input.cellId,
        name: roomName,
        objective: input.objective.trim(),
        budget,
        actor: input.actor,
        actorRef,
        correlationId: input.correlationId,
        now: input.now,
      });

      const provenance = {
        method: 'automation',
        producer: 'apps/api/mission-orchestrator',
        correlationId: input.correlationId,
        producerVersion: this.#policyVersion,
      };
      const root = await this.#work.create(tx, {
        id: rootWorkItemId,
        cellId: input.cellId,
        kind: 'milestone',
        title: normalizedTitle(input.title, input.objective),
        description: input.objective.trim(),
        state: 'inbox',
        priority: 'high',
        ownerKind: input.actor.kind,
        ownerId: input.actor.id,
        policyRef: { ref: 'frank.operating-policy', version: this.#policyVersion },
        provenance,
        actor: input.actor,
        correlationId: input.correlationId,
        now: input.now,
        whyNow: 'Mission accepted through the durable autonomous objective front door.',
        nextSafeAction: 'Execute dependency-ready child work items within the mission budget.',
        definitionOfDone: [
          {
            id: 'mission-objective',
            statement: 'All planned child work is complete and the objective has been verified.',
            verification: plan.summary,
          },
        ],
        dataClass: 'private',
      });
      let rootSnapshot: WorkItemSnapshot = { id: root.id, state: root.state, version: root.version };
      rootSnapshot = await this.#moveWorkItem(
        tx,
        rootSnapshot,
        'ready',
        input.actor,
        input.correlationId,
        input.now,
        'Mission plan persisted.',
      );
      await this.#moveWorkItem(
        tx,
        rootSnapshot,
        'active',
        input.actor,
        input.correlationId,
        input.now,
        'Mission execution started.',
      );

      const workItemsByKey = new Map<string, WorkItemSnapshot>();
      for (const task of plan.tasks) {
        const row = await this.#work.create(tx, {
          id: newId(),
          cellId: input.cellId,
          kind: 'agent_job',
          title: task.title,
          description: task.instruction,
          state: 'planned',
          priority: 'normal',
          ownerKind: 'agent',
          ownerId: 'mission-orchestrator',
          parentId: root.id,
          policyRef: { ref: 'frank.operating-policy', version: this.#policyVersion },
          provenance,
          actor: input.actor,
          correlationId: input.correlationId,
          now: input.now,
          whyNow: `Planned as part of mission ${missionId}.`,
          nextSafeAction:
            task.depends_on.length === 0
              ? 'Run in a bounded workbench.'
              : 'Wait until every declared dependency is done.',
          definitionOfDone: [
            { id: `verify-${task.key}`, statement: task.verification, verification: task.verification },
          ],
          dataClass: 'private',
        });
        workItemsByKey.set(task.key, { id: row.id, state: row.state, version: row.version });
      }

      for (const task of plan.tasks) {
        const child = requiredMapValue(workItemsByKey, task.key);
        for (const dependencyKey of task.depends_on) {
          const dependency = requiredMapValue(workItemsByKey, dependencyKey);
          await tx.insert(schema.workItemDependency).values({
            cellId: input.cellId,
            workItemId: child.id,
            dependsOnId: dependency.id,
            kind: 'blocks',
            allowsCycle: false,
            createdAt: input.now,
            createdBy: actorRef,
          });
          await this.#recordMutation(tx, {
            type: 'frank.work.dependency_added.v1',
            action: 'work.dependency_added',
            aggregateKind: 'work_item',
            aggregateId: child.id,
            cellId: input.cellId,
            actor: input.actor,
            correlationId: input.correlationId,
            now: input.now,
            data: { workItemId: child.id, dependsOnId: dependency.id, kind: 'blocks' },
            change: { fields: ['dependency'], dependencyKind: 'blocks' },
          });
        }
      }

      const nodes: MutableNode[] = [];
      for (const task of plan.tasks) {
        let child = requiredMapValue(workItemsByKey, task.key);
        const dependsOn = task.depends_on.map((key) => requiredMapValue(workItemsByKey, key).id);
        let workbenchId: string | null = null;
        let workbenchState: string | null = null;
        let attempts = 0;
        if (dependsOn.length === 0) {
          child = await this.#moveWorkItem(
            tx,
            child,
            'ready',
            input.actor,
            input.correlationId,
            input.now,
            'Mission dependency roots are ready for execution.',
          );
          workItemsByKey.set(task.key, child);
          const workbench = await this.#enqueueWorkbench(tx, {
            missionId,
            roomId: room.id,
            cellId: input.cellId,
            node: {
              key: task.key,
              title: task.title,
              instruction: task.instruction,
              timeoutSeconds: task.timeout_seconds,
              verification: task.verification,
            },
            tier: task.model_tier,
            attempt: 1,
            taskCount: plan.tasks.length,
            budget,
            workItemId: child.id,
            actor: input.actor,
            correlationId: input.correlationId,
            now: input.now,
          });
          workbenchId = workbench.id;
          workbenchState = workbench.state;
          attempts = 1;
        }
        nodes.push({
          key: task.key,
          work_item_id: child.id,
          title: task.title,
          state: child.state,
          depends_on: dependsOn,
          workbench_id: workbenchId,
          workbench_state: workbenchState,
          attempts,
          model_tier: task.model_tier,
          instruction: task.instruction,
          timeout_seconds: task.timeout_seconds,
          verification: task.verification,
        });
      }

      const graph: DurableMissionGraph = { version: 1, summary: plan.summary, nodes };
      await tx.execute(sql`
        insert into "frank_domain"."mission"
          (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
           room_id, root_work_item_id, idempotency_key, objective, planned_work_graph,
           state, spend_limit, spend_currency, token_limit, wall_clock_limit_seconds,
           attempt_limit, stop_new_work, started_at, finished_at, error, data_class, version)
        values
          (${missionId}, ${input.cellId}, ${input.now}, ${input.now}, ${actorRef}, ${actorRef},
           ${JSON.stringify(provenance)}::jsonb, ${room.id}, ${root.id}, ${input.commandId},
           ${input.objective.trim()}, ${JSON.stringify(graph)}::jsonb, 'running',
           ${budget.spendCapUsd.toFixed(8)}, 'USD', ${budget.tokenBudget},
           ${budget.wallClockSec}, ${budget.maxAttempts}, false, ${input.now}, null, null,
           'private', 1)
      `);
      await this.#recordMutation(tx, {
        type: 'frank.mission.created.v1',
        action: 'mission.created',
        aggregateKind: 'mission',
        aggregateId: missionId,
        cellId: input.cellId,
        actor: input.actor,
        correlationId: input.correlationId,
        idempotencyKey: input.commandId,
        now: input.now,
        data: { missionId, roomId: room.id, rootWorkItemId: root.id, state: 'running' },
        change: { fields: ['objective', 'planned_work_graph', 'budget', 'state'], state: 'running' },
      });
      return missionId;
    });

    const created = await this.get(input.cellId, persistedMissionId);
    if (created === null) throw new Error(`mission ${persistedMissionId} committed but is unreadable`);
    return created;
  }

  async get(cellId: string, missionId: string): Promise<MissionView | null> {
    const result = await this.#db.execute<MissionRow>(sql`
      select m.id, m.cell_id, m.room_id, r.identity as room_name,
             m.root_work_item_id, m.idempotency_key, m.objective, m.planned_work_graph,
             m.state, m.spend_limit, m.token_limit, m.wall_clock_limit_seconds,
             m.attempt_limit, m.stop_new_work, m.started_at, m.finished_at, m.error,
             m.version, m.created_at, m.updated_at
      from "frank_domain"."mission" m
      join "frank_domain"."room" r on r.id = m.room_id and r.cell_id = m.cell_id
      where m.cell_id = ${cellId} and m.id = ${missionId}
    `);
    const row = result.rows[0];
    return row === undefined ? null : toMissionView(row);
  }

  async stop(input: StopMissionInput): Promise<MissionView> {
    assertStopInput(input);
    const reason = input.reason?.trim() || 'Stopped by owner request.';
    const cancellationIds = await this.#db.transaction(async (tx) => {
      const mission = await this.#lockMission(tx, input.cellId, input.missionId);
      if (mission === null) throw new MissionNotFoundError(input.missionId);
      if (mission.state === 'cancelled') {
        const items = await this.#loadChildWorkItems(tx, input.cellId, mission.root_work_item_id);
        return this.#liveWorkbenchIds(tx, input.cellId, [...items.keys()]);
      }
      if (mission.state === 'completed' || mission.state === 'failed') {
        throw new MissionAlreadyTerminalError(mission.id, mission.state);
      }

      const items = await this.#loadChildWorkItems(tx, input.cellId, mission.root_work_item_id);
      for (const item of items.values()) {
        if (item.state !== 'done' && item.state !== 'cancelled') {
          await this.#moveWorkItem(
            tx,
            item,
            'cancelled',
            input.actor,
            input.correlationId,
            input.now,
            `Mission stopped: ${reason}`,
          );
        }
      }
      const root = await this.#loadWorkItem(tx, input.cellId, mission.root_work_item_id);
      if (root !== null && root.state !== 'done' && root.state !== 'cancelled') {
        await this.#moveWorkItem(
          tx,
          root,
          'cancelled',
          input.actor,
          input.correlationId,
          input.now,
          `Mission stopped: ${reason}`,
        );
      }

      const graph = mutableGraph(mission.planned_work_graph);
      for (const node of graph.nodes) {
        const item = items.get(node.work_item_id);
        if (item !== undefined && item.state !== 'done') {
          node.state = 'cancelled';
          if (node.workbench_id !== null && node.workbench_state !== 'done') {
            node.workbench_state = 'cancelled';
          }
        }
      }
      await tx.execute(sql`
        update "frank_domain"."mission" set
          state = 'cancelled', stop_new_work = true, finished_at = ${input.now},
          error = ${boundedError(reason)}, planned_work_graph = ${JSON.stringify(graph)}::jsonb,
          updated_at = ${input.now}, updated_by = ${`${input.actor.kind}/${input.actor.id}`},
          version = version + 1
        where id = ${mission.id} and cell_id = ${input.cellId}
      `);
      await this.#recordMissionState(
        tx,
        mission,
        'cancelled',
        input.actor,
        input.correlationId,
        input.now,
        reason,
        input.commandId,
      );
      await this.#terminalizeRoom(
        tx,
        input.cellId,
        mission.room_id,
        input.actor,
        input.correlationId,
        input.now,
      );
      return this.#liveWorkbenchIds(tx, input.cellId, [...items.keys()]);
    });

    await this.#cancelFanout(
      input.cellId,
      cancellationIds,
      reason,
      input.actor,
      input.correlationId,
      input.now,
    );
    const stopped = await this.get(input.cellId, input.missionId);
    if (stopped === null) throw new MissionNotFoundError(input.missionId);
    return stopped;
  }

  async start(): Promise<void> {
    if (this.#schedulerRunning) return;
    this.#schedulerRunning = true;
    await this.#runScheduledTick();
  }

  async stopScheduler(): Promise<void> {
    this.#schedulerRunning = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#activeTick;
  }

  /** Public for operational sweeps and deterministic focused tests. */
  async tick(input: TickMissionsInput = {}): Promise<TickMissionsResult> {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('mission tick limit must be an integer from 1 to 500');
    }
    const now = input.now ?? this.#now();
    if (Number.isNaN(now.getTime())) throw new Error('mission tick now must be a valid Date');
    const candidates = await this.#db.execute<{ id: string; cell_id: string }>(sql`
      select m.id, m.cell_id from "frank_domain"."mission" m
      where (
        m.state in ('planning', 'running', 'waiting')
        or (
          m.stop_new_work = true
          and exists (
            select 1
            from "frank_domain"."work_item" wi
            join "frank_domain"."workbench" wb
              on wb.work_item_id = wi.id and wb.cell_id = wi.cell_id
            where wi.cell_id = m.cell_id and wi.parent_id = m.root_work_item_id
              and wb.state not in ('done', 'failed', 'cancelled')
          )
        )
      )
        ${input.cellId === undefined ? sql`` : sql`and m.cell_id = ${input.cellId}`}
      order by m.updated_at, m.id
      limit ${limit}
    `);

    const result = {
      inspected: 0,
      changed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      released: 0,
    };
    for (const candidate of candidates.rows) {
      result.inspected += 1;
      try {
        const outcome = await this.#tickOne(candidate.cell_id, candidate.id, now);
        if (outcome.changed) result.changed += 1;
        result.completed += outcome.completed;
        result.failed += outcome.failed;
        result.retried += outcome.retried;
        result.released += outcome.released;
        await this.#cancelFanout(
          outcome.cellId,
          outcome.cancellationIds,
          'Mission reached a terminal state.',
          SYSTEM_ACTOR,
          outcome.correlationId,
          outcome.now,
        );
      } catch (error) {
        this.#log(`mission tick failed for ${candidate.id}`, error);
      }
    }
    return result;
  }

  async #runScheduledTick(): Promise<void> {
    if (!this.#schedulerRunning) return;
    this.#activeTick = this.tick()
      .then(() => undefined)
      .catch((error: unknown) => this.#log('mission scheduler sweep failed', error));
    await this.#activeTick;
    this.#activeTick = null;
    if (!this.#schedulerRunning) return;
    this.#timer = setTimeout(() => {
      void this.#runScheduledTick();
    }, this.#schedulerIntervalMs);
    this.#timer.unref?.();
  }

  async #tickOne(cellId: string, missionId: string, now: Date): Promise<TickOneResult> {
    const correlationId = `mission-tick:${missionId}:${now.toISOString()}`;
    return this.#db.transaction(async (tx) => {
      const mission = await this.#lockMission(tx, cellId, missionId);
      if (mission === null) return unchangedTick(cellId, correlationId, now);
      if (isTerminalMission(mission.state)) {
        const items = await this.#loadChildWorkItems(tx, cellId, mission.root_work_item_id);
        return {
          ...unchangedTick(cellId, correlationId, now),
          cancellationIds: await this.#liveWorkbenchIds(tx, cellId, [...items.keys()]),
        };
      }

      const graph = mutableGraph(mission.planned_work_graph);
      const items = await this.#loadChildWorkItems(tx, cellId, mission.root_work_item_id);
      const workbenches = await this.#loadWorkbenches(tx, cellId, [...items.keys()]);
      const latestByItem = new Map<string, WorkbenchSnapshot>();
      const attemptsByItem = new Map<string, number>();
      for (const workbench of workbenches) {
        latestByItem.set(workbench.work_item_id, workbench);
        attemptsByItem.set(
          workbench.work_item_id,
          (attemptsByItem.get(workbench.work_item_id) ?? 0) + Math.max(workbench.attempts, 1),
        );
      }

      let retried = 0;
      let released = 0;
      let failure: string | null = null;
      const startedAt = mission.started_at === null ? null : asDate(mission.started_at);
      const wallClockExceeded =
        startedAt !== null &&
        now.getTime() - startedAt.getTime() >= mission.wall_clock_limit_seconds * 1_000;

      for (const node of graph.nodes) {
        let item = items.get(node.work_item_id);
        if (item === undefined) {
          failure ??= `Mission graph references missing work item ${node.work_item_id}.`;
          continue;
        }
        const workbench = latestByItem.get(item.id);
        const attempts = attemptsByItem.get(item.id) ?? 0;
        node.attempts = attempts;
        if (workbench !== undefined) {
          node.workbench_id = workbench.id;
          node.workbench_state = workbench.state;
        }

        if (workbench?.state === 'done' && item.state !== 'done' && item.state !== 'cancelled') {
          item = await this.#moveWorkItem(
            tx,
            item,
            'done',
            SYSTEM_ACTOR,
            correlationId,
            now,
            'Workbench completed with a durable receipt.',
          );
        } else if (workbench?.state === 'failed') {
          // The canonical terminal reporter owns active -> failed. Waiting for
          // that transaction avoids an old workbench reporter racing a newly
          // queued retry and failing the shared WorkItem a second time.
          if (item.state === 'failed' && attempts < mission.attempt_limit && !mission.stop_new_work) {
            item = await this.#moveWorkItem(
              tx,
              item,
              'ready',
              SYSTEM_ACTOR,
              correlationId,
              now,
              'Retry admitted within the mission attempt budget.',
            );
            const tier = selectModelTier(node.model_tier, attempts + 1);
            const workbenchRetry = await this.#enqueueWorkbench(tx, {
              missionId,
              roomId: mission.room_id,
              cellId,
              node: {
                key: node.key,
                title: node.title,
                instruction: node.instruction,
                timeoutSeconds: node.timeout_seconds,
                verification: node.verification,
              },
              tier,
              attempt: attempts + 1,
              taskCount: graph.nodes.length,
              budget: budgetFromMission(mission),
              workItemId: item.id,
              actor: SYSTEM_ACTOR,
              correlationId,
              now,
            });
            node.workbench_id = workbenchRetry.id;
            node.workbench_state = workbenchRetry.state;
            node.attempts = attempts + 1;
            node.model_tier = tier;
            retried += 1;
          } else if (item.state === 'failed') {
            failure ??= boundedError(
              workbench.last_error ??
                `Task ${node.title} exhausted its ${String(mission.attempt_limit)} attempts.`,
            );
          }
        } else if (workbench?.state === 'cancelled' && item.state !== 'done' && item.state !== 'cancelled') {
          item = await this.#moveWorkItem(
            tx,
            item,
            'cancelled',
            SYSTEM_ACTOR,
            correlationId,
            now,
            'Workbench was cancelled.',
          );
          if (!mission.stop_new_work) failure ??= `Task ${node.title} was cancelled unexpectedly.`;
        } else if (workbench?.state !== undefined) {
          const desired = desiredWorkState(workbench.state);
          if (desired !== null && item.state !== desired && item.state !== 'done' && item.state !== 'cancelled') {
            item = await this.#moveWorkItem(
              tx,
              item,
              desired,
              SYSTEM_ACTOR,
              correlationId,
              now,
              `Synchronized from workbench ${workbench.id} state ${workbench.state}.`,
            );
          }
        }
        items.set(item.id, item);
        node.state = item.state;
      }

      if (
        failure === null &&
        wallClockExceeded &&
        ![...items.values()].every((item) => item.state === 'done')
      ) {
        failure = `Mission wall-clock budget of ${String(mission.wall_clock_limit_seconds)} seconds was exhausted.`;
      }

      if (failure === null && !mission.stop_new_work) {
        const stateByItem = new Map([...items].map(([id, item]) => [id, item.state]));
        for (const node of graph.nodes) {
          let item = items.get(node.work_item_id);
          if (
            item !== undefined &&
            item.state === 'planned' &&
            dependenciesSatisfied(node.depends_on, stateByItem)
          ) {
            item = await this.#moveWorkItem(
              tx,
              item,
              'ready',
              SYSTEM_ACTOR,
              correlationId,
              now,
              'All mission dependencies completed.',
            );
            const workbench = await this.#enqueueWorkbench(tx, {
              missionId,
              roomId: mission.room_id,
              cellId,
              node: {
                key: node.key,
                title: node.title,
                instruction: node.instruction,
                timeoutSeconds: node.timeout_seconds,
                verification: node.verification,
              },
              tier: node.model_tier,
              attempt: 1,
              taskCount: graph.nodes.length,
              budget: budgetFromMission(mission),
              workItemId: item.id,
              actor: SYSTEM_ACTOR,
              correlationId,
              now,
            });
            node.state = item.state;
            node.workbench_id = workbench.id;
            node.workbench_state = workbench.state;
            node.attempts = 1;
            items.set(item.id, item);
            stateByItem.set(item.id, item.state);
            released += 1;
          }
        }
      }

      if (failure === null) {
        const failedNode = graph.nodes.find(
          (node) => items.get(node.work_item_id)?.state === 'failed',
        );
        if (failedNode !== undefined) {
          failure = `Task ${failedNode.title} is failed with no retryable workbench attempt.`;
        } else if (!mission.stop_new_work) {
          const cancelledNode = graph.nodes.find(
            (node) => items.get(node.work_item_id)?.state === 'cancelled',
          );
          if (cancelledNode !== undefined) {
            failure = `Task ${cancelledNode.title} was cancelled outside the mission stop path.`;
          }
        }
      }

      const cancellationIds: string[] = [];
      let nextState: MissionLifecycle;
      let stopNewWork = mission.stop_new_work;
      let finishedAt: Date | null = null;
      if (failure !== null) {
        nextState = 'failed';
        stopNewWork = true;
        finishedAt = now;
        for (const item of items.values()) {
          // Preserve the failed item as the durable failure anchor. Siblings
          // are cancelled because no new work is admitted after mission
          // failure.
          if (item.state !== 'done' && item.state !== 'failed' && item.state !== 'cancelled') {
            const cancelled = await this.#moveWorkItem(
              tx,
              item,
              'cancelled',
              SYSTEM_ACTOR,
              correlationId,
              now,
              `Mission failed: ${failure}`,
            );
            items.set(cancelled.id, cancelled);
          }
        }
        const root = await this.#loadWorkItem(tx, cellId, mission.root_work_item_id);
        if (root !== null && root.state !== 'done' && root.state !== 'cancelled') {
          if (root.state !== 'failed') {
            await this.#moveWorkItem(
              tx,
              root,
              'failed',
              SYSTEM_ACTOR,
              correlationId,
              now,
              failure,
            );
          }
        }
        cancellationIds.push(...(await this.#liveWorkbenchIds(tx, cellId, [...items.keys()])));
      } else {
        nextState = deriveMissionLifecycle([...items.values()].map((item) => item.state));
        if (nextState === 'completed') {
          stopNewWork = true;
          finishedAt = now;
          const root = await this.#loadWorkItem(tx, cellId, mission.root_work_item_id);
          if (root !== null && root.state !== 'done' && root.state !== 'cancelled') {
            await this.#moveWorkItem(
              tx,
              root,
              'done',
              SYSTEM_ACTOR,
              correlationId,
              now,
              'All mission child work completed.',
            );
          }
        } else if (nextState === 'cancelled') {
          stopNewWork = true;
          finishedAt = now;
        }
      }

      for (const node of graph.nodes) {
        const item = items.get(node.work_item_id);
        if (item !== undefined) {
          node.state = item.state;
          if (
            nextState === 'failed' &&
            item.state === 'cancelled' &&
            node.workbench_id !== null &&
            node.workbench_state !== 'done'
          ) {
            node.workbench_state = 'cancelled';
          }
        }
      }
      const graphChanged = JSON.stringify(graph) !== JSON.stringify(mutableGraph(mission.planned_work_graph));
      const stateChanged =
        nextState !== mission.state ||
        stopNewWork !== mission.stop_new_work ||
        (failure ?? null) !== mission.error;
      if (!graphChanged && !stateChanged) {
        return {
          ...unchangedTick(cellId, correlationId, now),
          retried,
          released,
          cancellationIds,
        };
      }

      await tx.execute(sql`
        update "frank_domain"."mission" set
          state = ${nextState}, stop_new_work = ${stopNewWork},
          planned_work_graph = ${JSON.stringify(graph)}::jsonb,
          finished_at = ${finishedAt}, error = ${failure}, updated_at = ${now},
          updated_by = ${`${SYSTEM_ACTOR.kind}/${SYSTEM_ACTOR.id}`}, version = version + 1
        where id = ${mission.id} and cell_id = ${cellId}
      `);
      if (stateChanged) {
        await this.#recordMissionState(
          tx,
          mission,
          nextState,
          SYSTEM_ACTOR,
          correlationId,
          now,
          failure ?? 'Mission work graph advanced.',
        );
      } else {
        await this.#recordMutation(tx, {
          type: 'frank.mission.graph_advanced.v1',
          action: 'mission.graph_advanced',
          aggregateKind: 'mission',
          aggregateId: mission.id,
          cellId,
          actor: SYSTEM_ACTOR,
          correlationId,
          now,
          data: { missionId: mission.id, state: nextState, retried, released },
          change: { fields: ['planned_work_graph'], retried, released },
        });
      }
      if (isTerminalMission(nextState)) {
        await this.#terminalizeRoom(tx, cellId, mission.room_id, SYSTEM_ACTOR, correlationId, now);
      }
      return {
        changed: true,
        completed: nextState === 'completed' ? 1 : 0,
        failed: nextState === 'failed' ? 1 : 0,
        retried,
        released,
        cancellationIds,
        cellId,
        correlationId,
        now,
      };
    });
  }

  async #getOrCreateRoom(
    tx: FrankTransaction,
    input: {
      cellId: string;
      name: string;
      objective: string;
      budget: ResolvedMissionBudget;
      actor: CreateMissionInput['actor'];
      actorRef: string;
      correlationId: string;
      now: Date;
    },
  ): Promise<RoomLookupRow> {
    const found = await tx.execute<RoomLookupRow>(sql`
      select id, state, paused, budget from "frank_domain"."room"
      where cell_id = ${input.cellId} and identity = ${input.name}
      for update
    `);
    const existing = found.rows[0];
    if (existing !== undefined) {
      if (existing.state !== 'active') throw new RoomUnavailableError(input.name, `state is ${existing.state}`);
      if (existing.paused) throw new RoomUnavailableError(input.name, 'room is paused');
      assertWithinRoomBudget(input.name, input.budget, existing.budget);
      const active = await tx.execute<{ count: string | number }>(sql`
        select count(*) as count from "frank_domain"."mission"
        where cell_id = ${input.cellId} and room_id = ${existing.id}
          and state in ('planning', 'running', 'waiting')
      `);
      if (Number(active.rows[0]?.count ?? 0) > 0) {
        throw new RoomUnavailableError(input.name, 'another mission is already active');
      }
      return existing;
    }

    const id = newId();
    const provenance = {
      method: 'automation',
      producer: 'apps/api/mission-orchestrator',
      correlationId: input.correlationId,
      producerVersion: this.#policyVersion,
    };
    const roomBudget = {
      spendLimit: { amount: input.budget.spendCapUsd.toFixed(8), currency: 'USD' },
      tokenLimit: input.budget.tokenBudget,
      attemptLimit: input.budget.maxAttempts,
    };
    const fence = {
      readScopes: [this.#workspaceSource],
      writeScopes: [this.#workspaceSource],
      sharedWritesRequireApproval: false,
    };
    await tx.execute(sql`
      insert into "frank_domain"."room"
        (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
         identity, objective, fence, state, budget, paused, data_class, version)
      values
        (${id}, ${input.cellId}, ${input.now}, ${input.now}, ${input.actorRef}, ${input.actorRef},
         ${JSON.stringify(provenance)}::jsonb, ${input.name}, ${input.objective},
         ${JSON.stringify(fence)}::jsonb, 'active', ${JSON.stringify(roomBudget)}::jsonb,
         false, 'private', 1)
    `);
    await this.#recordMutation(tx, {
      type: 'frank.room.created.v1',
      action: 'room.created',
      aggregateKind: 'room',
      aggregateId: id,
      cellId: input.cellId,
      actor: input.actor,
      correlationId: input.correlationId,
      now: input.now,
      data: { roomId: id, state: 'active' },
      change: { fields: ['identity', 'objective', 'fence', 'budget', 'state'], state: 'active' },
    });
    return { id, state: 'active', paused: false, budget: roomBudget };
  }

  async #enqueueWorkbench(
    tx: FrankTransaction,
    input: {
      missionId: string;
      roomId: string;
      cellId: string;
      node: {
        key: string;
        title: string;
        instruction: string;
        timeoutSeconds: number;
        verification: string;
      };
      tier: MissionModelTier;
      attempt: number;
      taskCount: number;
      budget: ResolvedMissionBudget;
      workItemId: string;
      actor: CreateMissionInput['actor'];
      correlationId: string;
      now: Date;
    },
  ): Promise<{ id: string; state: WorkbenchState }> {
    const id = newId();
    const idempotencyKey = `mission:${input.missionId}:task:${input.node.key}:attempt:${String(input.attempt)}`;
    const created = await this.#workbenchStore.createWorkbenchInTransaction(tx, {
      id,
      cellId: input.cellId,
      workItemId: input.workItemId,
      roomId: input.roomId,
      idempotencyKey,
      taskDef: this.#taskDef(input.node, input.tier, input.taskCount, input.budget),
      createdBy: `${input.actor.kind}/${input.actor.id}`,
      now: input.now,
    });
    if (!created.created) {
      if (created.record.workItemId !== input.workItemId) {
        throw new Error(`mission workbench idempotency collision on ${idempotencyKey}`);
      }
      return { id: created.record.id, state: created.record.state };
    }
    await this.#recordMutation(tx, {
      type: 'frank.workbench.created.v1',
      action: 'workbench.created',
      aggregateKind: 'workbench',
      aggregateId: id,
      cellId: input.cellId,
      actor: input.actor,
      correlationId: input.correlationId,
      idempotencyKey,
      now: input.now,
      data: {
        workbenchId: id,
        workItemId: input.workItemId,
        roomId: input.roomId,
        state: created.record.state,
        missionId: input.missionId,
        attempt: input.attempt,
        modelTier: input.tier,
      },
      change: { fields: ['task_def', 'state'], state: created.record.state },
    });
    return { id, state: created.record.state };
  }

  #taskDef(
    node: {
      key: string;
      title: string;
      instruction: string;
      timeoutSeconds: number;
      verification: string;
    },
    tier: MissionModelTier,
    taskCount: number,
    budget: ResolvedMissionBudget,
  ): WorkbenchTaskDef {
    const divisor = Math.max(1, taskCount * budget.maxAttempts);
    return {
      instruction: [
        node.instruction,
        '',
        `Verification: ${node.verification}`,
        'Work only inside /mission-workspace. Leave durable evidence for the verifier.',
      ].join('\n'),
      mounts: [{ source: this.#workspaceSource, path: '/mission-workspace', mode: 'rw' }],
      harness: {
        adapter: 'frank-container-agent',
        model: tier === 'cheap' ? this.#cheapModel : this.#strongModel,
      },
      leash: {
        wallClockSec: Math.min(node.timeoutSeconds, budget.wallClockSec),
        tokenBudget: Math.floor(budget.tokenBudget / divisor),
        spendCapUsd: Number((budget.spendCapUsd / divisor).toFixed(8)),
      },
      network: { egressAllowlist: [] },
    };
  }

  async #moveWorkItem(
    tx: FrankTransaction,
    item: WorkItemSnapshot,
    target: WorkState,
    actor: CreateMissionInput['actor'],
    correlationId: string,
    now: Date,
    reason: string,
  ): Promise<WorkItemSnapshot> {
    let current = item;
    for (const next of transitionPath(current.state, target)) {
      const result = await this.#work.transition(tx, {
        workItemId: current.id,
        cellId: await cellIdForWorkItem(tx, current.id),
        expectedVersion: current.version,
        toState: next,
        actor,
        reason,
        correlationId,
        now,
        policyVersion: this.#policyVersion,
        policyDecision: 'allow_with_limits',
      });
      current = { id: current.id, state: result.toState, version: result.version };
    }
    return current;
  }

  async #lockMission(
    tx: FrankTransaction,
    cellId: string,
    missionId: string,
  ): Promise<LockedMissionRow | null> {
    const result = await tx.execute<LockedMissionRow>(sql`
      select id, cell_id, room_id, root_work_item_id, idempotency_key, objective,
             planned_work_graph, state, spend_limit, token_limit,
             wall_clock_limit_seconds, attempt_limit, stop_new_work, started_at,
             finished_at, error, version, created_at, updated_at
      from "frank_domain"."mission"
      where cell_id = ${cellId} and id = ${missionId}
      for update
    `);
    return result.rows[0] ?? null;
  }

  async #loadChildWorkItems(
    tx: FrankTransaction,
    cellId: string,
    rootWorkItemId: string,
  ): Promise<Map<string, WorkItemSnapshot>> {
    const result = await tx.execute<WorkItemSnapshot>(sql`
      select id, state, version from "frank_domain"."work_item"
      where cell_id = ${cellId} and parent_id = ${rootWorkItemId}
      order by created_at, id
      for update
    `);
    return new Map(result.rows.map((row) => [row.id, row]));
  }

  async #loadWorkItem(
    tx: FrankTransaction,
    cellId: string,
    workItemId: string,
  ): Promise<WorkItemSnapshot | null> {
    const result = await tx.execute<WorkItemSnapshot>(sql`
      select id, state, version from "frank_domain"."work_item"
      where cell_id = ${cellId} and id = ${workItemId}
      for update
    `);
    return result.rows[0] ?? null;
  }

  async #loadWorkbenches(
    tx: FrankTransaction,
    cellId: string,
    workItemIds: readonly string[],
  ): Promise<WorkbenchSnapshot[]> {
    if (workItemIds.length === 0) return [];
    const result = await tx.execute<WorkbenchSnapshot>(sql`
      select id, work_item_id, state, attempts, last_error, created_at
      from "frank_domain"."workbench"
      where cell_id = ${cellId} and work_item_id in (${sql.join(workItemIds.map((id) => sql`${id}`), sql`, `)})
      order by created_at, id
    `);
    return [...result.rows];
  }

  async #liveWorkbenchIds(
    tx: FrankTransaction,
    cellId: string,
    workItemIds: readonly string[],
  ): Promise<string[]> {
    if (workItemIds.length === 0) return [];
    const result = await tx.execute<{ id: string }>(sql`
      select id from "frank_domain"."workbench"
      where cell_id = ${cellId}
        and work_item_id in (${sql.join(workItemIds.map((id) => sql`${id}`), sql`, `)})
        and state not in ('done', 'failed', 'cancelled')
      order by created_at, id
    `);
    return result.rows.map((row) => row.id);
  }

  async #findMissionByCommand(cellId: string, commandId: string): Promise<MissionView | null> {
    const result = await this.#db.execute<{ id: string }>(sql`
      select id from "frank_domain"."mission"
      where cell_id = ${cellId} and idempotency_key = ${commandId}
    `);
    const id = result.rows[0]?.id;
    return id === undefined ? null : this.get(cellId, id);
  }

  async #terminalizeRoom(
    tx: FrankTransaction,
    cellId: string,
    roomId: string,
    actor: CreateMissionInput['actor'],
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const aggregate = await tx.execute<{
      active_count: string | number;
      failed_count: string | number;
      completed_count: string | number;
    }>(sql`
      select
        count(*) filter (where state in ('planning', 'running', 'waiting')) as active_count,
        count(*) filter (where state = 'failed') as failed_count,
        count(*) filter (where state = 'completed') as completed_count
      from "frank_domain"."mission"
      where cell_id = ${cellId} and room_id = ${roomId}
    `);
    const counts = aggregate.rows[0];
    if (counts === undefined || Number(counts.active_count) > 0) return;
    const state =
      Number(counts.failed_count) > 0
        ? 'failed'
        : Number(counts.completed_count) > 0
          ? 'completed'
          : 'cancelled';
    const updated = await tx.execute<{ state: string }>(sql`
      update "frank_domain"."room" set
        state = ${state}, paused = false, updated_at = ${now},
        updated_by = ${`${actor.kind}/${actor.id}`}, version = version + 1
      where id = ${roomId} and cell_id = ${cellId} and state = 'active'
      returning state
    `);
    if (updated.rows.length === 0) return;
    await this.#recordMutation(tx, {
      type: 'frank.room.state_changed.v1',
      action: 'room.state_changed',
      aggregateKind: 'room',
      aggregateId: roomId,
      cellId,
      actor,
      correlationId,
      now,
      data: { roomId, fromState: 'active', toState: state },
      change: { field: 'state', from: 'active', to: state },
    });
  }

  async #recordMissionState(
    tx: FrankTransaction,
    mission: LockedMissionRow,
    toState: MissionLifecycle,
    actor: CreateMissionInput['actor'],
    correlationId: string,
    now: Date,
    reason: string,
    commandId?: string,
  ): Promise<void> {
    await this.#recordMutation(tx, {
      type: 'frank.mission.state_changed.v1',
      action: 'mission.state_changed',
      aggregateKind: 'mission',
      aggregateId: mission.id,
      cellId: mission.cell_id,
      actor,
      correlationId,
      ...(commandId === undefined
        ? {}
        : { idempotencyKey: commandId, causationId: commandId }),
      now,
      data: { missionId: mission.id, roomId: mission.room_id, fromState: mission.state, toState },
      change: { field: 'state', from: mission.state, to: toState, reason: boundedError(reason) },
    });
  }

  async #recordMutation(
    tx: FrankTransaction,
    input: {
      type: string;
      action: string;
      aggregateKind: string;
      aggregateId: string;
      cellId: string;
      actor: CreateMissionInput['actor'];
      correlationId: string;
      idempotencyKey?: string;
      causationId?: string;
      now: Date;
      data: Record<string, unknown>;
      change: CanonicalValue;
    },
  ): Promise<void> {
    await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: input.action,
      targetKind: input.aggregateKind,
      targetId: input.aggregateId,
      correlationId: input.correlationId,
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      dataClass: 'private',
      changeRedacted: input.change,
    });
    const envelope = buildEventEnvelope({
      type: input.type,
      source: eventSource(eventSourceContext(input.aggregateKind), input.aggregateId),
      cellId: input.cellId,
      actorId: `${input.actor.kind}/${input.actor.id}`,
      correlationId: input.correlationId,
      classification: 'private',
      subject: `${input.aggregateKind}/${input.aggregateId}`,
      occurredAt: input.now,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      data: input.data,
    });
    await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: input.aggregateKind,
      aggregateId: input.aggregateId,
      createdAt: input.now,
    });
  }

  async #cancelFanout(
    cellId: string,
    workbenchIds: readonly string[],
    reason: string,
    actor: CreateMissionInput['actor'],
    correlationId: string,
    now: Date,
  ): Promise<void> {
    for (const workbenchId of workbenchIds) {
      try {
        await this.#cancellation.cancel({
          cellId,
          workbenchId,
          reason,
          actor,
          correlationId,
          now,
        });
      } catch (error) {
        if (error instanceof AlreadyTerminalError || error instanceof WorkbenchNotFoundError) continue;
        this.#log(`mission cancellation fanout failed for workbench ${workbenchId}`, error);
      }
    }
  }
}

function toMissionView(row: MissionRow): MissionView {
  const graph = mutableGraph(row.planned_work_graph);
  return {
    mission: {
      id: row.id,
      room_id: row.room_id,
      room_name: row.room_name,
      objective: row.objective,
      state: row.state,
      stop_new_work: row.stop_new_work,
      created_at: asDate(row.created_at).toISOString(),
      updated_at: asDate(row.updated_at).toISOString(),
      completed_at: row.finished_at === null ? null : asDate(row.finished_at).toISOString(),
      last_error: row.error,
      budget: {
        spend_cap_usd: Number(row.spend_limit),
        token_budget: Number(row.token_limit),
        wall_clock_sec: Number(row.wall_clock_limit_seconds),
        max_attempts: Number(row.attempt_limit),
      },
    },
    work_graph: graph.nodes.map((node) => ({
      work_item_id: node.work_item_id,
      title: node.title,
      state: node.state,
      depends_on: [...node.depends_on],
      workbench_id: node.workbench_id,
      workbench_state: node.workbench_state,
      attempts: node.attempts,
      model_tier: node.model_tier as MissionModelTier,
    })),
  };
}

function mutableGraph(value: unknown): { version: 1; summary: string; nodes: MutableNode[] } {
  if (typeof value !== 'object' || value === null) throw new Error('mission graph is not an object');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.summary !== 'string' || !Array.isArray(record.nodes)) {
    throw new Error('mission graph has an unsupported shape');
  }
  const nodes = record.nodes.map((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) throw new Error('mission graph node is invalid');
    const node = candidate as Record<string, unknown>;
    if (
      typeof node.key !== 'string' ||
      typeof node.work_item_id !== 'string' ||
      typeof node.title !== 'string' ||
      typeof node.state !== 'string' ||
      !Array.isArray(node.depends_on) ||
      !node.depends_on.every((dependency) => typeof dependency === 'string') ||
      (node.workbench_id !== null && typeof node.workbench_id !== 'string') ||
      (node.workbench_state !== null && typeof node.workbench_state !== 'string') ||
      typeof node.attempts !== 'number' ||
      (node.model_tier !== 'cheap' && node.model_tier !== 'strong') ||
      typeof node.instruction !== 'string' ||
      typeof node.timeout_seconds !== 'number' ||
      typeof node.verification !== 'string'
    ) {
      throw new Error('mission graph node has an unsupported shape');
    }
    return {
      key: node.key,
      work_item_id: node.work_item_id,
      title: node.title,
      state: node.state,
      depends_on: [...node.depends_on] as string[],
      workbench_id: node.workbench_id,
      workbench_state: node.workbench_state,
      attempts: node.attempts,
      model_tier: node.model_tier as MissionModelTier,
      instruction: node.instruction,
      timeout_seconds: node.timeout_seconds,
      verification: node.verification,
    };
  });
  return { version: 1, summary: record.summary, nodes };
}

function eventSourceContext(aggregateKind: string): string {
  // Event source contexts are URI path vocabulary (`work`), while audit and
  // outbox aggregate kinds retain the canonical table vocabulary (`work_item`).
  return aggregateKind === 'work_item' ? 'work' : aggregateKind.replaceAll('_', '-');
}

function transitionPath(from: WorkState, target: WorkState): readonly WorkState[] {
  if (from === target) return [];
  if (from === 'done' || from === 'cancelled') {
    throw new Error(`cannot move terminal work item from ${from} to ${target}`);
  }
  if (target === 'cancelled') return ['cancelled'];
  if (target === 'ready') {
    if (['inbox', 'planned', 'scheduled', 'waiting', 'blocked', 'failed'].includes(from)) return ['ready'];
  }
  if (target === 'active') {
    if (from === 'inbox' || from === 'planned') return ['ready', 'active'];
    if (['ready', 'scheduled', 'waiting', 'blocked', 'failed', 'reviewing'].includes(from)) return ['active'];
  }
  if (target === 'waiting' || target === 'blocked') {
    if (from === 'inbox' || from === 'planned') return ['ready', target];
    if (from === 'failed') return ['ready', target];
    return [target];
  }
  if (target === 'reviewing') {
    if (from === 'inbox' || from === 'planned') return ['ready', 'active', 'reviewing'];
    if (from === 'ready' || from === 'scheduled' || from === 'waiting' || from === 'blocked' || from === 'failed') {
      return ['active', 'reviewing'];
    }
  }
  if (target === 'done') {
    if (from === 'reviewing' || from === 'active') return ['done'];
    if (from === 'inbox' || from === 'planned') return ['ready', 'active', 'done'];
    if (['ready', 'scheduled', 'waiting', 'blocked', 'failed'].includes(from)) return ['active', 'done'];
  }
  if (target === 'failed') {
    if (from === 'reviewing' || from === 'active' || from === 'waiting' || from === 'blocked') return ['failed'];
    if (from === 'inbox' || from === 'planned') return ['ready', 'active', 'failed'];
    if (from === 'ready' || from === 'scheduled' || from === 'failed') return ['active', 'failed'];
  }
  throw new Error(`no legal work transition path from ${from} to ${target}`);
}

function desiredWorkState(state: WorkbenchState): WorkState | null {
  switch (state) {
    case 'queued':
      return null;
    case 'provisioning':
      return 'blocked';
    case 'running':
      return 'active';
    case 'waiting':
      return 'waiting';
    case 'verifying':
      return 'reviewing';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function budgetFromMission(mission: LockedMissionRow): ResolvedMissionBudget {
  return {
    spendCapUsd: Number(mission.spend_limit),
    tokenBudget: Number(mission.token_limit),
    wallClockSec: Number(mission.wall_clock_limit_seconds),
    maxAttempts: Number(mission.attempt_limit),
  };
}

function assertWithinRoomBudget(
  roomName: string,
  mission: ResolvedMissionBudget,
  rawRoomBudget: unknown,
): void {
  if (typeof rawRoomBudget !== 'object' || rawRoomBudget === null) {
    throw new RoomUnavailableError(roomName, 'stored room budget is invalid');
  }
  const room = rawRoomBudget as Record<string, unknown>;
  const spend = room.spendLimit as { amount?: unknown; currency?: unknown } | undefined;
  const roomSpend = Number(spend?.amount);
  const roomTokens = Number(room.tokenLimit);
  const roomAttempts = Number(room.attemptLimit);
  if (
    spend?.currency !== 'USD' ||
    !Number.isFinite(roomSpend) ||
    !Number.isSafeInteger(roomTokens) ||
    !Number.isSafeInteger(roomAttempts)
  ) {
    throw new RoomUnavailableError(roomName, 'stored room budget is invalid');
  }
  if (
    mission.spendCapUsd > roomSpend ||
    mission.tokenBudget > roomTokens ||
    mission.maxAttempts > roomAttempts
  ) {
    throw new RoomUnavailableError(roomName, 'mission budget exceeds the room ceiling');
  }
}

function normalizedRoomName(
  roomName: string | undefined,
  title: string | undefined,
  objective: string,
  missionId: string,
): string {
  const explicit = roomName?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const label = title?.trim() || objective.trim().split('\n', 1)[0]?.slice(0, 100);
  const value = `${label || 'Autonomous mission'} · ${missionId.slice(0, 8)}`;
  if (value === '') throw new Error('mission room name cannot be blank');
  return value;
}

function normalizedTitle(title: string | undefined, objective: string): string {
  const value = title?.trim() || objective.trim().split('\n', 1)[0]?.slice(0, 200) || 'Autonomous mission';
  return value.length <= 200 ? value : `${value.slice(0, 199)}…`;
}

function assertCreateInput(input: CreateMissionInput): void {
  if (input.cellId.trim() === '') throw new Error('mission cellId cannot be blank');
  if (input.commandId.trim() === '') throw new Error('mission commandId cannot be blank');
  if (input.objective.trim() === '') throw new Error('mission objective cannot be blank');
  if (input.actor.id.trim() === '') throw new Error('mission actor id cannot be blank');
  if (input.correlationId.trim() === '') throw new Error('mission correlationId cannot be blank');
  if (Number.isNaN(input.now.getTime())) throw new Error('mission now must be a valid Date');
}

function assertStopInput(input: StopMissionInput): void {
  if (input.cellId.trim() === '') throw new Error('mission cellId cannot be blank');
  if (input.missionId.trim() === '') throw new Error('mission missionId cannot be blank');
  if (input.commandId.trim() === '') throw new Error('mission commandId cannot be blank');
  if (input.actor.id.trim() === '') throw new Error('mission actor id cannot be blank');
  if (input.correlationId.trim() === '') throw new Error('mission correlationId cannot be blank');
  if (Number.isNaN(input.now.getTime())) throw new Error('mission now must be a valid Date');
}

function requiredMapValue<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`mission plan references missing task ${key}`);
  return value;
}

function isTerminalMission(state: MissionLifecycle): boolean {
  return TERMINAL_MISSION_STATES.includes(state);
}

function boundedError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 4_000 ? trimmed : `${trimmed.slice(0, 3_999)}…`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function cellIdForWorkItem(tx: FrankTransaction, workItemId: string): Promise<string> {
  const result = await tx.execute<{ cell_id: string }>(sql`
    select cell_id from "frank_domain"."work_item" where id = ${workItemId}
  `);
  const cellId = result.rows[0]?.cell_id;
  if (cellId === undefined) throw new Error(`work item ${workItemId} disappeared during transition`);
  return cellId;
}

function unchangedTick(cellId: string, correlationId: string, now: Date): TickOneResult {
  return {
    changed: false,
    completed: 0,
    failed: 0,
    retried: 0,
    released: 0,
    cancellationIds: [],
    cellId,
    correlationId,
    now,
  };
}
