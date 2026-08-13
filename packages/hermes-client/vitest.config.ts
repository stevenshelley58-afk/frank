import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config, matching the convention set by the other
 * `packages/*` members.
 *
 * The suite talks only to a fake OpenAI-compatible HTTP server on loopback
 * (Node `http.createServer`) — never to a real Hermes gateway and never to the
 * public internet. The transport is exercised end to end (request shape,
 * headers, SSE parsing, abort) but nothing leaves the machine.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
