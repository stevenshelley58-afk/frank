/**
 * CH-02 unit tests — pure logic, no database (FRANK-§18.1 static/unit split).
 * Configuration validation is checked here; store semantics are the SDK
 * conformance suite's job in state-store-conformance.integration.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { PostgresStateStore } from './state-store.js';

const URL = 'postgresql://postgres@127.0.0.1:15434/frank_test';

describe('PostgresStateStore configuration', () => {
  it('rejects a schema name that is not a plain identifier', () => {
    expect(
      () => new PostgresStateStore({ connectionString: URL, schema: 'bad"; DROP TABLE kv; --' }),
    ).toThrow(/not a plain SQL identifier/);
  });

  it('defaults the schema to frank_channels', () => {
    const store = new PostgresStateStore({ connectionString: URL });
    expect(store.schema).toBe('frank_channels');
    void store.close();
  });

  it('accepts a custom identifier schema name', () => {
    const store = new PostgresStateStore({ connectionString: URL, schema: 'frank_channels_test' });
    expect(store.schema).toBe('frank_channels_test');
    void store.close();
  });
});
