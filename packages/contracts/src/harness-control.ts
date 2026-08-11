import type { IsoDateTime } from './common.js';
import type { SourceRef } from './object-manifest.js';
export interface HarnessConfigRevision { id: string; cell_id: string; harness_id: string; revision: number; config: Record<string, unknown>; status: 'draft' | 'active' | 'superseded' | 'rolled_back'; created_at: IsoDateTime; created_by: string; rollback_of?: string; }
export interface RoutePolicy { id: string; cell_id: string; subject_kind: 'central'|'project'|'room'; subject_id: string; room_id?: string; revision: number; profile: string; aliases: Record<string, string[]>; shadow_mode: boolean; active: boolean; created_at: IsoDateTime; }
export type BrowserResearchInput = { query: string; max_sources: number; locale?: string };
export type HermesAllowedTool = 'browser.search'|'browser.open'|'browser.extract';
export type HermesEgressProfile = 'research-public'|'research-allowlist';
/** cell_id and owner_id are filled from the authenticated request context, never trusted from Hermes. */
/** Public NightWatch wire scope; tenant identity is injected from authentication. */
export interface HarnessJobRequestScope { project_id?: string; room_id?: string }
export interface HarnessJobScope extends HarnessJobRequestScope { cell_id: string; owner_id: string }
export interface HarnessJobInput { harness: 'hermes'; task_type: 'browser-research'; idempotency_key: string; scope: HarnessJobRequestScope; input: BrowserResearchInput; allowed_tools: HermesAllowedTool[]; egress_profile: HermesEgressProfile; }
export interface PersistedHarnessJobInput extends Omit<HarnessJobInput, 'scope'> { scope: HarnessJobScope; request_hash: string }
export type HarnessJobStatus = 'queued'|'running'|'completed'|'failed'|'cancelled';
export interface HarnessJobEvent { job_id:string; cursor:number; kind:'progress'|'artifact'|'error'|'terminal'; occurred_at:IsoDateTime; artifact?: { object_id:string; source_ref:SourceRef }; summary?:string }
export interface HarnessJobResult { job_id:string; status:HarnessJobStatus; artifacts:Array<{object_id:string;source_ref:SourceRef}>; source_refs:SourceRef[] }
export interface HarnessJobCancellation { job_id: string; requested_by: string; reason?: string; requested_at: IsoDateTime }
