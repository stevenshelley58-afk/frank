/**
 * Chat-turn routes against a capturing fake database.
 *
 * The DB-backed chat-turn routes are exercised with a fake `FrankDatabase`
 * that records every executed statement (rendered SQL + bound params) instead
 * of a real Postgres. That is enough to prove the W2-1 security property the
 * packet demands: submitting a turn persists ONLY profile + session key —
 * never the message text — and cancellation never touches the deleted
 * harness tables. The Hermes streaming itself is covered by
 * `@frank/hermes-client`'s own fake-HTTP-server suite; here the submit stream
 * is pointed at a dead port so `chat()` yields a quick error event and
 * nothing ever leaves the process.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FrankDatabase } from '@frank/adapter-postgres';

import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';

interface ExecutedQuery {
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * Renders a drizzle `sql` template into SQL text + bound params.
 *
 * Drizzle's chunk structure (0.45): text segments are objects shaped
 * `{ value: ['...'] }` (the value may itself contain nested chunks), while
 * interpolated values appear as bare strings at the top level of
 * `queryChunks`. The walker mirrors that shape; `?` stands for each bound
 * param, in order.
 */
function renderQuery(query: unknown): ExecutedQuery {
  const params: unknown[] = [];
  let sql = '';
  const walk = (chunk: unknown): void => {
    if (typeof chunk === 'string') {
      params.push(chunk);
      sql += '?';
      return;
    }
    if (chunk !== null && typeof chunk === 'object') {
      const record = chunk as { queryChunks?: unknown[]; value?: unknown };
      if (Array.isArray(record.queryChunks)) {
        for (const inner of record.queryChunks) walk(inner);
        return;
      }
      if (Array.isArray(record.value)) {
        for (const inner of record.value) {
          if (typeof inner === 'string') sql += inner;
          else walk(inner);
        }
        return;
      }
      if ('value' in record) {
        params.push(record.value);
        sql += '?';
        return;
      }
    }
    sql += String(chunk);
  };
  walk(query);
  return { sql, params };
}

/**
 * A minimal `FrankDatabase` stand-in. `rollback` is a function so
 * `chat-turn-events.ts`'s open-transaction discriminator treats every handle
 * as an already-open transaction and appends events without recursing.
 */
class CapturingDatabase {
  readonly executed: ExecutedQuery[] = [];
  private readonly conversationId: string;
  private turn: Record<string, unknown> | undefined;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }

  async execute<T extends Record<string, unknown>>(query: unknown): Promise<{ rows: T[] }> {
    const rendered = renderQuery(query);
    this.executed.push(rendered);
    const sqlText = rendered.sql;

    // Submit: the INSERT ... RETURNING * row is derived from the statement's
    // own params, so the response and the persisted input come from the same
    // captured data the test asserts on.
    if (sqlText.includes('insert into frank_domain.chat_turn(')) {
      const [turnId, cellId, , , , inputJson] = rendered.params as [
        string, string, string, string, string, string,
      ];
      this.turn = {
        id: turnId,
        cell_id: cellId,
        conversation_id: this.conversationId,
        state: 'queued',
        request_hash: rendered.params[4],
        input: JSON.parse(inputJson ?? '{}') as Record<string, unknown>,
        created_at: '2026-07-28T09:00:00.000Z',
        updated_at: '2026-07-28T09:00:00.000Z',
        finished_at: null,
        cancelled_at: null,
      };
      return { rows: [{ ...this.turn, inserted: true } as unknown as T] };
    }
    // Ownership reads (submit conversation lock, cancel/get/events fetchOwned).
    if (sqlText.includes('select t.* from frank_domain.chat_turn')) {
      return { rows: [this.turn as T] };
    }
    if (sqlText.includes('from frank_domain.chat_conversation')) {
      return { rows: [{ id: this.conversationId } as unknown as T] };
    }
    // Cancel transition: reflect the state change so the response is realistic.
    if (sqlText.includes("set state='cancelled'")) {
      if (this.turn) this.turn = { ...this.turn, state: 'cancelled' };
      return { rows: [{ id: this.turn?.id ?? '' } as unknown as T] };
    }
    // The queued→running transition returns NO row, so the streamed executor
    // bails before it can open a connection.
    return { rows: [] };
  }

  async transaction<T>(fn: (tx: CapturingDatabase) => Promise<T>): Promise<T> {
    return fn(this);
  }

  // `chat-turn-events.ts` discriminates "already in a transaction" by the
  // presence of a function-valued `rollback` (PgTransaction only) — without it
  // appendChatTurnEvent wraps another transaction forever.
  readonly rollback = (): void => {};
}

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_TEXT = 'the-words-live-in-hermes-7f3a91';

describe('chat turns (capturing fake DB)', () => {
  let server: TestServer;
  let db: CapturingDatabase;

  beforeEach(() => {
    db = new CapturingDatabase(CONVERSATION_ID);
    server = buildTestServer({ db: db as unknown as FrankDatabase });
    // The submit stream points at a dead port so chat() fails fast instead of
    // touching a real gateway; the error event is itself part of the contract.
    process.env.HERMES_API_URL = 'http://127.0.0.1:9';
    process.env.HERMES_API_KEY = 'dev-key-abc123';
  });

  afterEach(async () => {
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
    await server.close();
  });

  function submitTurn(idempotencyKey = 'cmd-submit-1'): Promise<import('fastify').LightMyRequestResponse> {
    return server.app.inject({
      method: 'POST',
      url: '/v1/chat/turns',
      headers: {
        authorization: server.auth(['owner']),
        'idempotency-key': idempotencyKey,
      },
      payload: {
        conversation_id: CONVERSATION_ID,
        idempotency_key: idempotencyKey,
        profile: 'hub',
        message: MESSAGE_TEXT,
      },
    });
  }

  it('streams a turn and persists only profile + session key — never the message text', async () => {
    const response = await submitTurn();

    // The POST response IS the stream: an SSE ack + the Hermes error event
    // (dead gateway), not a JSON view.
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: turn');
    expect(response.body).toContain('"state":"queued"');
    expect(response.body).toContain('event: error');

    const allSql = db.executed.map((query) => query.sql).join('\n');
    const allParams = db.executed
      .flatMap((query) => query.params.map((param) => (typeof param === 'string' ? param : JSON.stringify(param))))
      .join('\n');

    // The only persisted input jsonb is {profile, session_key}.
    const inputJson = db.executed
      .flatMap((query) => query.params)
      .filter((param): param is string => typeof param === 'string')
      .map((param) => {
        try {
          return JSON.parse(param) as unknown;
        } catch {
          return undefined;
        }
      })
      .find((parsed): parsed is { profile: string; session_key: string } =>
        typeof parsed === 'object' && parsed !== null && 'profile' in parsed && 'session_key' in parsed,
      );
    expect(inputJson).toEqual({ profile: 'hub', session_key: CONVERSATION_ID });

    // Belt and suspenders: the message text appears in NO statement or param.
    expect(allSql).not.toContain(MESSAGE_TEXT);
    expect(allParams).not.toContain(MESSAGE_TEXT);
  });

  it('cancels a turn without ever touching the deleted harness tables', async () => {
    const submitted = await submitTurn('cmd-submit-2');
    expect(submitted.statusCode).toBe(200);
    const turnId = /"turn_id":"([0-9a-f-]{36})"/.exec(submitted.body)?.[1];
    expect(turnId).toBeTruthy();

    const cancelled = await server.app.inject({
      method: 'POST',
      url: `/v1/chat/turns/${turnId}/cancel`,
      headers: {
        authorization: server.auth(['owner']),
        'idempotency-key': 'cmd-cancel-2',
      },
      payload: { idempotency_key: 'cmd-cancel-2' },
    });
    expect(cancelled.statusCode).toBe(200);

    const allSql = db.executed.map((query) => query.sql).join('\n');
    expect(allSql).toContain("state='cancelled'");
    expect(allSql).not.toContain('harness_fallback_attempt');
    expect(allSql).not.toContain('chat_turn_receipt');
    expect(allSql).not.toContain(MESSAGE_TEXT);
    expect(cancelled.json()).toMatchObject({ state: 'cancelled' });
  });
});
