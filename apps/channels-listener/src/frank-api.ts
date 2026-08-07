/**
 * CH-03 — the listener's only path to canonical state: the FRANK Domain API
 * over HTTP (§3.5). The listener NEVER writes to Postgres directly for work
 * items; every tap becomes a command envelope posted here. If the API is down,
 * the listener reports the failure truthfully and does not fabricate success.
 */

export interface CommandEnvelopeInput {
  command_id: string;
  expected_version?: number;
  reason?: string;
}

export interface FrankApiResult {
  status: number;
  ok: boolean;
  /** Parsed body when available. */
  body: Record<string, unknown> | null;
  /** True only when the transport itself failed (API unreachable). */
  unreachable: boolean;
}

export interface FrankApiClientOptions {
  /** Base URL of apps/api, e.g. http://127.0.0.1:8080. */
  baseUrl: string;
  /** Bearer token for the Domain API (service identity). */
  token: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export class FrankApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FrankApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Post a command envelope on a work item: `ready` (approve) or `cancel`
   * (deny). Returns the API result; `unreachable` when the transport failed.
   */
  async sendCommand(
    workItemId: string,
    command: 'ready' | 'cancel',
    envelope: CommandEnvelopeInput,
  ): Promise<FrankApiResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${this.baseUrl}/v1/work/${encodeURIComponent(workItemId)}/commands/${command}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(envelope),
        },
      );
    } catch {
      return { status: 0, ok: false, body: null, unreachable: true };
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body, unreachable: false };
  }
}
