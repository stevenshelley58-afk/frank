import type { IsoDateTime } from './common.js';

import type { SourceRef, Sha256 } from './object-manifest.js';
export const MAX_CHAT_TURN_ATTACHMENTS = 10_000;
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image'; attachment_id: string } | { type: 'file'; attachment_id: string };
/** Public request body: the authenticated cell is never accepted from the caller. */
export interface ChatTurnInput { conversation_id: string; idempotency_key: string; content: ChatContentPart[]; attachment_ids: string[]; route_profile?: string; requested_capability?: 'Auto' | 'Deep' | 'Vision' | 'Image'; requested_model_alias?: string; }
/** Canonical persisted turn input after request-context authority has been injected. */
export interface PersistedChatTurnInput extends ChatTurnInput { cell_id: string; owner_id: string; request_hash: Sha256; }
export type TurnEventKind = 'text' | 'tool_call' | 'tool_result' | 'artifact' | 'citation' | 'approval' | 'usage' | 'receipt' | 'error' | 'terminal';
type EventBase<K extends TurnEventKind, P> = { turn_id: string; cursor: number; kind: K; occurred_at: IsoDateTime; payload: P };
export type TurnEvent = EventBase<'text',{text:string}> | EventBase<'tool_call',{tool_call_id:string;name:string;arguments_json:string}> | EventBase<'tool_result',{tool_call_id:string;status:'success'|'warning'|'error';summary:string}> | EventBase<'artifact',{object_id:string;source_ref:SourceRef}> | EventBase<'citation',{source_ref:SourceRef;locator?:string}> | EventBase<'approval',{approval_id:string;state:'requested'|'approved'|'denied'}> | EventBase<'usage',{input_tokens:number;output_tokens:number}> | EventBase<'receipt',{receipt_id:string}> | EventBase<'error',{code:string;message:string;retryable:boolean}> | EventBase<'terminal',{state:'completed'|'failed'|'cancelled'}>;
export interface FallbackAttempt { attempt: number; harness: string; upstream?: string; outcome: 'selected'|'cooldown'|'failed'|'succeeded'; reason?: string; at: IsoDateTime }
/** Exact terminal receipt: no inferred model, cost, policy, or attachment evidence. */
export interface TurnReceipt { turn_id: string; state: 'completed'|'failed'|'cancelled'; completed_at: IsoDateTime; requested_model?: string; selected_model?: string; reported_model?: string; harness: string; upstream?: string; usage: { input_tokens: number; output_tokens: number }; cost: { amount?: string; currency?: string; confidence: 'reported'|'estimated'|'unavailable'; source: 'provider'|'catalogue'|'unavailable' }; request_ids: string[]; policy: { decision: string; result: string }; fallback_chain: FallbackAttempt[]; context_hash: Sha256; attachment_hashes: Sha256[]; }
