import type { ActorKind } from '@frank/adapter-postgres/schema';

export interface MissionBudgetInput {
  readonly spendCapUsd?: number;
  readonly tokenBudget?: number;
  readonly wallClockSec?: number;
  readonly maxAttempts?: number;
}

export interface ResolvedMissionBudget {
  readonly spendCapUsd: number;
  readonly tokenBudget: number;
  readonly wallClockSec: number;
  readonly maxAttempts: number;
}

export interface CreateMissionInput {
  readonly cellId: string;
  /** The command envelope's command_id; the durable idempotency key. */
  readonly commandId: string;
  readonly objective: string;
  readonly title?: string;
  readonly roomName?: string;
  readonly budget?: MissionBudgetInput;
  readonly actor: { readonly kind: ActorKind; readonly id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface StopMissionInput {
  readonly cellId: string;
  readonly missionId: string;
  /** The stop command envelope's command_id; persisted on audit/outbox. */
  readonly commandId: string;
  readonly reason?: string;
  readonly actor: { readonly kind: ActorKind; readonly id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export type MissionLifecycle =
  | 'planning'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MissionModelTier = 'cheap' | 'strong';

export interface MissionWorkGraphNode {
  readonly work_item_id: string;
  readonly title: string;
  readonly state: string;
  readonly depends_on: readonly string[];
  readonly workbench_id: string | null;
  readonly workbench_state: string | null;
  readonly attempts: number;
  readonly model_tier: MissionModelTier;
}

export type MissionWorkGraphView = readonly MissionWorkGraphNode[];

export interface MissionRecordView {
  readonly id: string;
  readonly room_id: string;
  readonly room_name: string;
  readonly objective: string;
  readonly state: MissionLifecycle;
  readonly stop_new_work: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly last_error: string | null;
  readonly budget: {
    readonly spend_cap_usd: number;
    readonly token_budget: number;
    readonly wall_clock_sec: number;
    readonly max_attempts: number;
  };
}

/** Exact `{ mission, work_graph }` envelope consumed by the mission BFF. */
export interface MissionView {
  readonly mission: MissionRecordView;
  readonly work_graph: MissionWorkGraphView;
}

/** Private durable planner shape. The public view intentionally strips it. */
export interface DurableMissionNode extends MissionWorkGraphNode {
  readonly key: string;
  readonly instruction: string;
  readonly timeout_seconds: number;
  readonly verification: string;
}

export interface DurableMissionGraph {
  readonly version: 1;
  readonly summary: string;
  readonly nodes: readonly DurableMissionNode[];
}

export interface TickMissionsInput {
  readonly cellId?: string;
  readonly limit?: number;
  readonly now?: Date;
}

export interface TickMissionsResult {
  readonly inspected: number;
  readonly changed: number;
  readonly completed: number;
  readonly failed: number;
  readonly retried: number;
  readonly released: number;
}
