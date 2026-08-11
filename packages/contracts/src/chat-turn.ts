import type { IsoDateTime } from './common.js';

export type ChatContentPart = { type: 'text'; text: string } | { type: 'image'; attachment_id: string } | { type: 'file'; attachment_id: string };
export interface ChatTurnInput { conversation_id: string; cell_id: string; idempotency_key: string; content: ChatContentPart[]; attachment_ids: string[]; route_profile?: string; requested_capability?: 'Auto' | 'Deep' | 'Vision' | 'Image'; requested_model_alias?: string; }
export type TurnEventKind = 'text' | 'tool_call' | 'tool_result' | 'artifact' | 'citation' | 'approval' | 'usage' | 'receipt' | 'error' | 'terminal';
export interface TurnEvent { turn_id: string; cursor: number; kind: TurnEventKind; occurred_at: IsoDateTime; payload: Record<string, unknown>; }
export interface TurnReceipt { turn_id: string; requested_model?: string; selected_model?: string; reported_model?: string; harness: string; upstream?: string; usage: { input_tokens?: number; output_tokens?: number }; cost_confidence: 'reported' | 'estimated' | 'unavailable'; request_ids: string[]; policy: { decision: string; result: string }; fallback_chain: string[]; context_hash: string; attachment_hashes: string[]; }
