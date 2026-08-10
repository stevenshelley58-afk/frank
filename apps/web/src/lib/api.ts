/* ------------------------------------------------------------------ */
/* Frank API wire types (snake_case, matching the v1 contract)         */
/* ------------------------------------------------------------------ */

export type WorkState =
  | 'inbox'
  | 'planned'
  | 'ready'
  | 'scheduled'
  | 'waiting'
  | 'blocked'
  | 'active'
  | 'reviewing'
  | 'done'
  | 'cancelled'
  | 'failed';

export type Priority = 'none' | 'low' | 'normal' | 'high' | 'critical';

export interface DefinitionOfDone {
  id: string;
  statement: string;
  verification: string;
}

export interface NextSafeAction {
  label: string;
  /** null when terminal, a command verb, or a full /v1/work/:id/commands/:verb href */
  command: string | null;
  safety: string;
}

export interface Guidance {
  why_now: string;
  definition_of_done: DefinitionOfDone[];
  next_safe_action: NextSafeAction;
}

export interface Freshness {
  state: string;
  as_of: string;
  age_seconds: number;
  projection_lag_seconds: number | null;
  recovery_action: string | null;
}

export interface Identifiers {
  cell_id: string;
  actor_id: string;
  request_id: string;
  correlation_id: string;
  trace_id: string;
  policy_version: string;
}

export interface OwnerRef {
  kind: string;
  id: string;
}

export interface TodayCard {
  id: string;
  kind: 'work_item';
  title: string;
  state: WorkState;
  priority: Priority;
  guidance: Guidance;
  data_class: string;
  /** present when the card carries a scheduled slot for the day */
  scheduled_for?: string | null;
  freshness: Freshness;
  _links: { resource: string; provenance: string };
}

export interface TodaySection {
  id: string;
  title: string;
  cards: TodayCard[];
}

export interface TodayResponse {
  date: string;
  timezone: string;
  sections: TodaySection[];
  coverage: {
    included: string[];
    not_yet_available: Array<{ input: string; reason: string; available_in: string }>;
  };
  freshness: Freshness;
  identifiers: Identifiers;
}

export interface WorkSummary {
  id: string;
  kind: string;
  title: string;
  state: WorkState;
  priority: Priority;
  owner: OwnerRef;
  data_class: string;
  version: number;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  scheduled_for: string | null;
  guidance: Guidance;
  _links: { self: string; provenance: string; history: string };
}

export interface WorkListResponse {
  items: WorkSummary[];
  next_cursor: string | null;
  freshness: Freshness;
  identifiers: Identifiers;
}

export interface AvailableCommand {
  command: string;
  to_state: WorkState;
  label: string;
  href: string;
}

export interface WorkDetail extends WorkSummary {
  description: string | null;
  started_at: string | null;
  completed_at: string | null;
  policy_ref: { ref: string; version: string };
  provenance: { method: string; producer: string; correlation_id: string | null };
  source_ids: string[];
  available_commands: AvailableCommand[];
  freshness: Freshness;
}

export interface TransitionEntry {
  seq: number;
  from_state: WorkState;
  to_state: WorkState;
  actor: OwnerRef;
  reason: string | null;
  occurred_at: string;
  audit_entry_id: string | null;
  resulting_version: number;
}

export interface HistoryResponse {
  work_item_id: string;
  transitions: TransitionEntry[];
  identifiers: Identifiers;
}

export interface DevSession {
  access_token: string;
  token_type: string;
  principal_id: string;
  actor_id?: string;
  roles: string[];
  expires_at: string;
}

export interface CaptureResponse {
  acknowledgement: string;
  source_id: string;
  work_item_id: string;
  capture_event_id: string;
  content_hash: string;
  replayed: boolean;
  enrichment: { state: string; detail: string } | null;
  identifiers?: Identifiers;
}

export interface CommandResponse {
  resource: WorkDetail | null;
  policy: { result: string; reasons?: string[] } | null;
  audit_entry_id: string | null;
  emitted_event_ids?: string[];
  identifiers?: Identifiers;
}

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail | null;

  constructor(status: number, problem: ProblemDetail | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export function problemMessage(problem: ProblemDetail | null, fallback: string): string {
  if (!problem) return fallback;
  return problem.detail || problem.title || problem.error || fallback;
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Build a fetcher that injects the Bearer token and re-mints the dev session
 * once when the token expires (401). All URLs are relative — Caddy routes
 * /v1/* to the API.
 */
/**
 * Rewrite /v1/* paths through the Next.js BFF proxy so requests carry the
 * server-side service token. The browser cannot hold a production bearer token:
 * Caddy strips Authorization before proxying to the API container.
 */
function proxyPath(path: string): string {
  if (path.startsWith('/v1/')) return `/api/v1/${path.slice(4)}`;
  return path;
}

export function makeApiFetch(
  getToken: () => string | null,
  reauth: () => Promise<string>,
): ApiFetch {
  return async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const run = async (token: string | null): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (init?.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(proxyPath(path), { ...init, headers });
    };

    let res = await run(getToken());
    if (res.status === 401) {
      const fresh = await reauth();
      res = await run(fresh);
    }
    if (!res.ok) {
      let problem: ProblemDetail | null = null;
      try {
        problem = (await res.clone().json()) as ProblemDetail;
      } catch {
        problem = null;
      }
      throw new ApiError(res.status, problem, `Request failed with status ${res.status}`);
    }
    return res;
  };
}

/**
 * `next_safe_action.command` is sometimes a bare verb, sometimes a full
 * `/v1/work/:id/commands/:verb` href. Reduce both to the verb.
 */
export function commandVerb(command: string | null | undefined): string | null {
  if (!command) return null;
  const match = /\/commands\/([a-z_]+)/i.exec(command);
  return match ? match[1].toLowerCase() : command.toLowerCase();
}

export const COMMAND_VERBS = [
  'plan',
  'ready',
  'schedule',
  'start',
  'wait',
  'block',
  'review',
  'complete',
  'cancel',
  'fail',
] as const;
