import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];
const httpServers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("Hermes runner discovery routes", () => {
  it("reports disabled Hermes cleanly", async () => {
    const { server } = createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        id: "hermes",
        status: "disabled"
      },
      status: {
        enabled: false,
        configured: false,
        reachable: false,
        health: "unavailable"
      }
    });
  });

  it("refuses enabled Hermes mode when API_SERVER_KEY is missing", async () => {
    const { server } = createTestServer({
      enabled: true,
      apiServerKey: undefined
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "not_configured"
      },
      status: {
        enabled: true,
        configured: false,
        reachable: false,
        health: "error"
      }
    });
  });

  it("reports unreachable Hermes without exposing the API key", async () => {
    const { server } = createTestServer({
      enabled: true,
      apiBaseUrl: "http://127.0.0.1:9",
      apiServerKey: "secret-test-key"
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "unavailable"
      },
      status: {
        configured: true,
        reachable: false,
        health: "unavailable"
      }
    });
    expect(response.body).not.toContain("secret-test-key");
  });

  it("reports reachable Hermes models and sends bearer auth server-side", async () => {
    const seenHeaders: string[] = [];
    const fakeHermes = await startFakeHermes((request, reply) => {
      const authorization = request.headers.authorization;
      seenHeaders.push(Array.isArray(authorization) ? authorization.join(",") : authorization ?? "");
      reply.setHeader("Content-Type", "application/json");

      if (request.url === "/health") {
        reply.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/health/detailed") {
        reply.end(JSON.stringify({ status: "ok", gateway: "running" }));
        return;
      }
      if (request.url === "/v1/models") {
        reply.end(JSON.stringify({ data: [{ id: "hermes-agent" }] }));
        return;
      }

      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "not_found" }));
    });

    const { server } = createTestServer({
      enabled: true,
      apiBaseUrl: fakeHermes.url,
      apiServerKey: "secret-test-key"
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "available"
      },
      status: {
        enabled: true,
        configured: true,
        reachable: true,
        health: "ok",
        models: ["hermes-agent"],
        detailedHealth: {
          gateway: "running"
        }
      }
    });
    expect(seenHeaders).toEqual(["Bearer secret-test-key", "Bearer secret-test-key", "Bearer secret-test-key"]);
    expect(response.body).not.toContain("secret-test-key");
  });
});

function createTestServer(hermes: Partial<ApiConfig["hermes"]> = {}) {
  const server = buildServer({
    config: {
      environment: "test",
      systemName: "Frank Hub",
      domain: "frank.fail",
      dashboardUrl: "https://hub.frank.fail",
      apiUrl: "https://api.frank.fail",
      port: 0,
      databaseUrl: "postgres://frank:test@postgres:5432/frank",
      redisUrl: "redis://redis:6379",
      corsOrigins: [],
      cloudflareAccess: {
        enabled: false,
        issuer: "https://frank.cloudflareaccess.com",
        audiences: ["test-aud"]
      },
      openrouterApiKey: undefined,
      hermes: {
        enabled: false,
        apiBaseUrl: "http://127.0.0.1:8642",
        apiServerKey: undefined,
        timeoutSeconds: 1800,
        stallTimeoutSeconds: 300,
        eventsPollMs: 1000,
        workspaceRoot: "/opt/frank-hub/workspaces",
        artifactRoot: "/opt/frank-hub/runtime/artifacts",
        ...hermes
      },
      backups: {
        root: "/opt/frank-backups"
      },
      logLevel: "silent"
    } satisfies ApiConfig,
    pool: {} as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

async function startFakeHermes(
  handler: (request: IncomingMessage, reply: ServerResponse) => void
): Promise<{ url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  httpServers.push(server);
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`
  };
}
