/** Model-assisted mission decomposition with strict deterministic validation. */

import { z } from 'zod';

const plannedTaskSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(12_000),
  depends_on: z.array(z.string()).max(8).default([]),
  model_tier: z.enum(['cheap', 'strong']),
  timeout_seconds: z.number().int().min(30).max(14_400),
  verification: z.string().min(1).max(2_000),
});

const planSchema = z.object({
  summary: z.string().min(1).max(2_000),
  tasks: z.array(plannedTaskSchema).min(2).max(12),
});

export type MissionPlan = z.infer<typeof planSchema>;

export interface MissionPlannerOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

export class MissionPlanner {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(options: MissionPlannerOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? 'deepseek-v4-flash';
    this.#timeoutMs = options.timeoutMs ?? 45_000;
  }

  async plan(objective: string): Promise<MissionPlan> {
    try {
      const response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.#model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: PLANNER_SYSTEM,
            },
            {
              role: 'user',
              content: `OBJECTIVE\n${objective}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const body = (await response.json()) as {
        choices?: readonly { message?: { content?: string | null } }[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          `mission planner provider returned ${String(response.status)}: ${body.error?.message ?? 'request failed'}`,
        );
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('mission planner returned no plan');
      }
      const decoded = JSON.parse(content) as unknown;
      const plan = planSchema.parse(decoded);
      assertGraph(plan);
      return plan;
    } catch {
      // Objective acceptance must not depend on one planner model call. The
      // deterministic graph is conservative and still routes execution
      // through the same fenced, budgeted, reviewed workbenches.
      return buildFallbackMissionPlan(objective);
    }
  }
}

export function buildFallbackMissionPlan(objective: string): MissionPlan {
  // Leave headroom for the safety/evidence instructions under the task
  // schema's 12k bound. The durable mission row still keeps the full input.
  const normalized = objective.trim().slice(0, 9_000);
  const plan = planSchema.parse({
    summary: 'Provider-independent recovery plan: execute safely, review independently, and publish verified evidence.',
    tasks: [
      {
        key: 'execute-objective',
        title: 'Execute the objective inside the fenced workspace',
        instruction: `Objective: ${normalized}\n\nWork from /mission-workspace. Complete every reversible, in-fence part of the objective. Do not perform destructive actions, external communication, paid purchases, or production promotion without an explicit approval boundary. Preserve project changes and shared evidence under /mission-workspace. Copy every user-facing deliverable into /workspace/out and register it. Record exact commands, outputs, and remaining blockers truthfully.`,
        depends_on: [],
        model_tier: 'cheap',
        timeout_seconds: 1_800,
        verification: 'Concrete deliverables or a truthful blocker report exist, and every completion claim cites observed command or file evidence.',
      },
      {
        key: 'independent-review',
        title: 'Independently review the objective result',
        instruction: `Objective: ${normalized}\n\nAct as an independent reviewer. Inspect the actual state in /mission-workspace; do not rely on the prior agent's claims. Re-run focused checks appropriate to the objective. Correct reversible defects in-fence when safe. Write /mission-workspace/.frank-fallback-review.md with PASS/FAIL findings and exact evidence, copy it to /workspace/out/review.md, and register that artifact.`,
        depends_on: ['execute-objective'],
        model_tier: 'strong',
        timeout_seconds: 1_200,
        verification: 'The review contains independent command evidence, explicit PASS/FAIL results, and any discovered material defect was corrected or reported.',
      },
      {
        key: 'publish-evidence',
        title: 'Publish the verified completion evidence',
        instruction: `Objective: ${normalized}\n\nRead the actual workspace result and /mission-workspace/.frank-fallback-review.md. Confirm the review passed. Copy all final user-facing deliverables available in /mission-workspace into /workspace/out without overwriting unrelated files. Create /workspace/out/completion-report.md summarizing the objective, work performed, verification commands and results, artifact paths, assumptions, and any genuine blockers. Register every /workspace/out artifact and publish a truthful receipt.`,
        depends_on: ['independent-review'],
        model_tier: 'cheap',
        timeout_seconds: 600,
        verification: 'completion-report.md exists in durable artifact storage and its claims agree with the independent review evidence.',
      },
    ],
  });
  assertGraph(plan);
  return plan;
}

const PLANNER_SYSTEM = `You are FRANK's mission planner. Return only a JSON object.

Decompose the objective into a small, executable dependency graph. FRANK will run each task in a separate isolated workbench. Tasks whose dependencies are satisfied run in parallel.

Schema:
{"summary":"...","tasks":[{"key":"short-key","title":"...","instruction":"standalone instruction with required evidence","depends_on":["other-key"],"model_tier":"cheap|strong","timeout_seconds":600,"verification":"objective evidence check"}]}

Rules:
- Produce 2-12 tasks. Keep the graph as small as reliable completion allows.
- Every instruction is standalone: name inputs, outputs, constraints, and evidence.
- Use cheap for inspection, extraction, routine edits, tests, and mechanical checks.
- Use strong only for architecture, ambiguous debugging, integration, or independent final review.
- Parallelize independent tasks. Add a final integration/review task that depends on all material builders.
- A verifier must inspect real outputs, not repeat another agent's claims.
- Do not include destructive, external communication, paid purchase, or production promotion without explicitly making it a verification/approval boundary.
- The project repository is always mounted at /mission-workspace and shell commands start in /workspace. Use explicit paths such as git -C /mission-workspace.
- Dependency tasks share /mission-workspace. Every final deliverable must also be copied into /workspace/out and registered there for durable archival.
- Keep discovery commands narrowly scoped. Never dump an entire repository or large generated directory into model context; cap search output and inspect only relevant files.
- Never invent credentials or paths. Work only in the workspace provided at runtime.`;

function assertGraph(plan: MissionPlan): void {
  const keys = new Set<string>();
  for (const task of plan.tasks) {
    if (keys.has(task.key)) throw new Error(`mission plan contains duplicate task key ${task.key}`);
    keys.add(task.key);
  }
  for (const task of plan.tasks) {
    for (const dependency of task.depends_on) {
      if (!keys.has(dependency)) {
        throw new Error(`mission task ${task.key} depends on unknown task ${dependency}`);
      }
      if (dependency === task.key) {
        throw new Error(`mission task ${task.key} depends on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`mission plan contains a dependency cycle at ${key}`);
    visiting.add(key);
    for (const dependency of byKey.get(key)?.depends_on ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of plan.tasks) visit(task.key);
}
