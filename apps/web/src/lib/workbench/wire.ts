/** Mapping from the Domain API's snake_case wire format to Workbench UI types. */

import type {
  WorkbenchDetail,
  WorkbenchPlanStep,
  WorkbenchReceipt,
  WorkbenchRecord,
} from './types';

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function titleFromInstruction(instruction: string): string {
  const firstLine = instruction.split('\n', 1)[0]?.trim() ?? '';
  return firstLine.length <= 200 ? firstLine : `${firstLine.slice(0, 197)}...`;
}

export function mapDomainWorkbench(value: unknown): WorkbenchRecord {
  const row = object(value, 'workbench');
  const taskDef = object(row.task_def, 'workbench.task_def');
  const instruction = string(taskDef.instruction, 'workbench.task_def.instruction');
  const createdAt = string(row.created_at, 'workbench.created_at');

  return {
    id: string(row.id, 'workbench.id'),
    workItemId: string(row.work_item_id, 'workbench.work_item_id'),
    roomId: optionalString(row.room_id),
    state: string(row.state, 'workbench.state'),
    version: optionalNumber(row.version) ?? 0,
    task: { title: titleFromInstruction(instruction), goal: instruction },
    taskDef: { instruction },
    createdAt,
    updatedAt: optionalString(row.updated_at),
    startedAt: optionalString(row.started_at),
    finishedAt: optionalString(row.finished_at),
    lastError: optionalString(row.last_error),
    attempts: optionalNumber(row.attempts) ?? 0,
  };
}

export function mapDomainReceipt(value: unknown): WorkbenchReceipt | null {
  if (value === null || value === undefined) return null;
  const row = object(value, 'workbench receipt');
  const summary = string(row.summary, 'workbench receipt.summary');
  const assumptions = Array.isArray(row.assumptions)
    ? row.assumptions.filter((item): item is string => typeof item === 'string')
    : [];
  const evidence = Array.isArray(row.evidence) ? row.evidence.map(evidenceText) : [];
  return {
    summary,
    assumptions,
    evidence,
    publishedAt: string(row.published_at, 'workbench receipt.published_at'),
    publishedBy: string(row.published_by, 'workbench receipt.published_by'),
  };
}

export function mapDomainPlanStep(value: unknown): WorkbenchPlanStep {
  const row = object(value, 'workbench plan step');
  const rawState = string(row.state, 'workbench plan step.state');
  const state =
    rawState === 'pending' ||
    rawState === 'doing' ||
    rawState === 'done' ||
    rawState === 'failed' ||
    rawState === 'skipped'
      ? rawState
      : 'pending';
  return {
    seq: optionalNumber(row.seq) ?? 0,
    step: string(row.step, 'workbench plan step.step'),
    state,
    note: optionalString(row.note),
    updatedAt: optionalString(row.updated_at),
  };
}

export function mapDomainWorkbenchList(value: unknown): { workbenches: WorkbenchRecord[] } {
  const body = object(value, 'workbench list response');
  const rows = Array.isArray(body.workbenches) ? body.workbenches : [];
  return { workbenches: rows.map(mapDomainWorkbench) };
}

export function mapDomainWorkbenchDetail(value: unknown): WorkbenchDetail {
  const body = object(value, 'workbench detail response');
  return {
    workbench: mapDomainWorkbench(body.workbench),
    plan: Array.isArray(body.plan) ? body.plan.map(mapDomainPlanStep) : [],
    receipt: mapDomainReceipt(body.receipt),
  };
}
