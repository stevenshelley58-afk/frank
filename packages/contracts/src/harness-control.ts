import type { IsoDateTime } from './common.js';
export interface HarnessConfigRevision { id: string; harness_id: string; revision: number; config: Record<string, unknown>; status: 'draft' | 'active' | 'superseded' | 'rolled_back'; created_at: IsoDateTime; created_by: string; rollback_of?: string; }
export interface RoutePolicy { id: string; cell_id: string; room_id: string; revision: number; profile: string; aliases: Record<string, string[]>; shadow_mode: boolean; active: boolean; created_at: IsoDateTime; }
export interface HarnessJobInput { harness: 'hermes'; task_type: 'browser-research'; idempotency_key: string; scope: { owner_id?: string; cell_id: string; project_id?: string; room_id?: string }; input: Record<string, unknown>; allowed_tools: string[]; egress_profile: string; }
