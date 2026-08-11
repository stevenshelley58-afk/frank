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
export interface HarnessArtifact { object_id:string; source_ref:SourceRef }
export type HarnessJobEvent =
  | { job_id:string; cursor:number; kind:'progress'; occurred_at:IsoDateTime; payload:{summary:string} }
  | { job_id:string; cursor:number; kind:'artifact'; occurred_at:IsoDateTime; payload:HarnessArtifact }
  | { job_id:string; cursor:number; kind:'error'; occurred_at:IsoDateTime; payload:{summary:string} }
  | { job_id:string; cursor:number; kind:'terminal'; occurred_at:IsoDateTime; payload:{status:Extract<HarnessJobStatus,'completed'|'failed'|'cancelled'>;summary?:string} };
export interface HarnessJobRepresentation { job_id:string; status:HarnessJobStatus; created_at:IsoDateTime; updated_at:IsoDateTime; finished_at:IsoDateTime|null; cancelled_at:IsoDateTime|null; artifacts:HarnessArtifact[]; source_refs:SourceRef[] }
export interface HarnessJobCreateResponse extends HarnessJobRepresentation { replayed:boolean }
export type HarnessJobStatusResponse = HarnessJobRepresentation;
export interface HarnessJobEventsResponse extends HarnessJobRepresentation { events:HarnessJobEvent[]; next_cursor:number|null }
export interface HarnessJobCancelRequest { idempotency_key:string; reason?:string }
export interface HarnessJobCancelResponse extends HarnessJobRepresentation { replayed:boolean }
/** @deprecated Use the operation-specific response types above. */
export type HarnessJobResult = HarnessJobRepresentation;
export interface HarnessJobCancellation { job_id: string; requested_by: string; idempotency_key:string; reason?: string; requested_at: IsoDateTime }
