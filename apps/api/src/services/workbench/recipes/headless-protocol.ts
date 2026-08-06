/**
 * Headless publication protocol — WB-04, harness-agnostic half.
 *
 * The runner and the harness executor depend only on this protocol plus the
 * AgentHarnessAdapter contract; the Goose-specific binding lives next door in
 * `goose-headless.ts`. Keeping the marker grammar here means a future
 * non-ACP CLI harness (codex, claude-code, agentapi — see the agentapi
 * mapping note in goose-headless.ts) reuses the exact same publication
 * contract without touching Goose code.
 *
 * Publication duties encoded (master plan §3.4, §4.2):
 *   - standalone instruction (self-contained; reproducible from the row)
 *   - 3-to-10 step plan published BEFORE substantive execution
 *   - step state updates as work progresses
 *   - artifact registration
 *   - exactly one closing receipt
 */

import type { WorkbenchPlanStepState, WorkbenchTaskDef } from '../types.js';

export const PROTOCOL_MARKERS = {
  planBegin: 'FRANK_PLAN_BEGIN',
  planEnd: 'FRANK_PLAN_END',
  stepPrefix: 'FRANK_STEP',
  artifactPrefix: 'FRANK_ARTIFACT',
  receiptBegin: 'FRANK_RECEIPT_BEGIN',
  receiptEnd: 'FRANK_RECEIPT_END',
} as const;

/**
 * Build the standalone headless instruction for one task def. Self-contained
 * by construction (WB-04 rule): everything the agent needs — task, mounts,
 * skills, leash, and the marker grammar — is in the returned text.
 */
export function buildHeadlessInstruction(taskDef: WorkbenchTaskDef): string {
  const skills =
    taskDef.skills && taskDef.skills.length > 0
      ? `Skills in scope: ${taskDef.skills.join(', ')}.`
      : 'No additional skills are in scope.';
  const mounts =
    taskDef.mounts && taskDef.mounts.length > 0
      ? taskDef.mounts
          .map((m) => `  - ${m.path} (${m.mode})${m.mode === 'ro' ? ' — read-only, do not attempt writes' : ''}`)
          .join('\n')
      : '  (none)';
  const wallClock =
    taskDef.leash?.wallClockSec !== undefined
      ? `Hard wall-clock limit: ${String(taskDef.leash.wallClockSec)} seconds.`
      : 'No explicit wall-clock limit, but finish promptly.';

  return `You are executing one delegated FRANK workbench run, headless, in an isolated container.

TASK
${taskDef.instruction}

ENVIRONMENT
Mounts available to you:
${mounts}
${skills}
${wallClock}
Write your outputs under /workspace/out/.

PUBLICATION DUTIES (contractual — the run is invalid without them)
1. Before ANY substantive execution, publish a plan of 3 to 10 steps, one
   step per line, wrapped exactly in these markers:
${PROTOCOL_MARKERS.planBegin}
1. <step text>
2. <step text>
...
${PROTOCOL_MARKERS.planEnd}
2. As you work, update each step exactly once per state change with:
${PROTOCOL_MARKERS.stepPrefix} <seq> <pending|doing|done|failed|skipped> [<optional note>]
3. For every artifact you produce, register it with:
${PROTOCOL_MARKERS.artifactPrefix} <absolute path under /workspace/out> <kind>
   where kind is one of: code, document, log, test, config, other.
4. End the run with exactly ONE receipt, JSON on one line between these markers:
${PROTOCOL_MARKERS.receiptBegin}
{"summary":"<what you did>","assumptions":["<what you assumed>"],"evidence":["<path or reference>"]}
${PROTOCOL_MARKERS.receiptEnd}

RULES
- Do not access paths outside the mounts and /workspace.
- Do not attempt network access unless explicitly listed in the task.
- If you cannot complete the task, still publish the plan, mark the failed
  steps, and end with a receipt whose summary explains the failure.
`;
}

/* ------------------------------------------------------------------ parser --- */

export interface ParsedStepUpdate {
  readonly seq: number;
  readonly state: WorkbenchPlanStepState;
  readonly note: string | null;
}

export interface ParsedArtifact {
  readonly path: string;
  readonly kind: string;
}

export interface ParsedReceipt {
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly evidence: readonly unknown[];
}

export interface HarnessRunOutput {
  readonly plan: readonly { step: string; note?: string }[];
  readonly stepUpdates: readonly ParsedStepUpdate[];
  readonly artifacts: readonly ParsedArtifact[];
  readonly receipt: ParsedReceipt | null;
}

const STEP_STATES: readonly WorkbenchPlanStepState[] = [
  'pending',
  'doing',
  'done',
  'failed',
  'skipped',
];

/**
 * Inverse of the publication protocol. Tolerant of surrounding chatter and
 * duplicated markers (first plan wins, last receipt wins); strict about the
 * marker grammar itself so a confused agent cannot half-publish.
 */
export function parseHarnessText(text: string): HarnessRunOutput {
  const lines = text.split(/\r?\n/);

  let plan: HarnessRunOutput['plan'] = [];
  let inPlan = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PROTOCOL_MARKERS.planBegin) {
      if (plan.length === 0) inPlan = true;
      continue;
    }
    if (trimmed === PROTOCOL_MARKERS.planEnd) {
      inPlan = false;
      continue;
    }
    if (inPlan && trimmed !== '') {
      // Accept "1. step" / "1) step" / "step" — numbering is optional noise.
      const step = trimmed.replace(/^\d+[.)]\s*/, '');
      if (step !== '') plan = [...plan, { step }];
    }
  }

  const stepUpdates: ParsedStepUpdate[] = [];
  for (const line of lines) {
    const match = /^FRANK_STEP\s+(\d+)\s+(\w+)(?:\s+(.*))?$/.exec(line.trim());
    if (match === null) continue;
    const seqText = match[1];
    const stateText = match[2];
    if (seqText === undefined || stateText === undefined) continue;
    const state = stateText as WorkbenchPlanStepState;
    if (!STEP_STATES.includes(state)) continue;
    stepUpdates.push({
      seq: Number(seqText),
      state,
      note: match[3]?.trim() || null,
    });
  }

  const artifacts: ParsedArtifact[] = [];
  for (const line of lines) {
    const match = /^FRANK_ARTIFACT\s+(\S+)\s+(\S+)\s*$/.exec(line.trim());
    if (match === null) continue;
    const artifactPath = match[1];
    const kind = match[2];
    if (artifactPath === undefined || kind === undefined) continue;
    if (!artifactPath.startsWith('/workspace/')) continue; // explicit-mount discipline
    artifacts.push({ path: artifactPath, kind });
  }

  let receipt: ParsedReceipt | null = null;
  const receiptBlocks = text.split(PROTOCOL_MARKERS.receiptBegin);
  for (const block of receiptBlocks.slice(1)) {
    const jsonText = block.split(PROTOCOL_MARKERS.receiptEnd)[0]?.trim();
    if (jsonText === undefined || jsonText === '') continue;
    try {
      const parsed = JSON.parse(jsonText) as {
        summary?: unknown;
        assumptions?: unknown;
        evidence?: unknown;
      };
      if (typeof parsed.summary === 'string' && parsed.summary !== '') {
        receipt = {
          summary: parsed.summary,
          assumptions: Array.isArray(parsed.assumptions)
            ? parsed.assumptions.map(String)
            : [],
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
        };
      }
    } catch {
      // Malformed receipt block — keep scanning for a valid one.
    }
  }

  return { plan, stepUpdates, artifacts, receipt };
}
