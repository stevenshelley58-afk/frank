import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAccessToken, validateCloudflareAccessJwt } from "../src/access.js";
import { loadConfig } from "../src/config.js";

let issuer = "";
let jwksServer: Server;
let privateKey: KeyLike;
const keyId = "cloudflare-access-test-key";

describe("Cloudflare Access helper", () => {
  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256", {
      extractable: true
    });
    privateKey = keyPair.privateKey;

    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    jwksServer = createServer((request, response) => {
      if (request.url === "/cdn-cgi/access/certs") {
        response.writeHead(200, {
          "content-type": "application/json"
        });
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => {
      jwksServer.listen(0, "127.0.0.1", resolve);
    });

    const address = jwksServer.address() as AddressInfo;
    issuer = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("reads Cf-Access-Jwt-Assertion case-insensitively through Fastify headers", () => {
    const token = getAccessToken({
      headers: {
        "cf-access-jwt-assertion": "header-token"
      }
    } as never);

    expect(token).toBe("header-token");
  });

  it("accepts the first configured Cloudflare Access AUD", async () => {
    const config = loadTestConfig({
      CLOUDFLARE_ACCESS_AUDS: " hub-aud, api-aud "
    });
    const token = await signAccessToken("hub-aud");

    const identity = await validateCloudflareAccessJwt(token, config.cloudflareAccess);

    expect(config.cloudflareAccess.audiences).toEqual(["hub-aud", "api-aud"]);
    expect(identity.email).toBe("operator@frank.fail");
    expect(identity.payload.aud).toBe("hub-aud");
  });

  it("accepts the second configured Cloudflare Access AUD", async () => {
    const config = loadTestConfig({
      CLOUDFLARE_ACCESS_AUDS: " hub-aud, api-aud "
    });
    const token = await signAccessToken("api-aud");

    const identity = await validateCloudflareAccessJwt(token, config.cloudflareAccess);

    expect(identity.email).toBe("operator@frank.fail");
    expect(identity.payload.aud).toBe("api-aud");
  });

  it("rejects an unknown Cloudflare Access AUD", async () => {
    const token = await signAccessToken("unknown-aud");

    await expect(
      validateCloudflareAccessJwt(token, {
        enabled: true,
        issuer,
        audiences: ["hub-aud", "api-aud"]
      })
    ).rejects.toThrow();
  });

  it("keeps the single-AUD fallback for existing configuration", async () => {
    const config = loadTestConfig({
      CLOUDFLARE_ACCESS_AUD: " legacy-aud "
    });
    const token = await signAccessToken("legacy-aud");

    const identity = await validateCloudflareAccessJwt(token, config.cloudflareAccess);

    expect(config.cloudflareAccess.issuer).toBe(issuer);
    expect(config.cloudflareAccess.audiences).toEqual(["legacy-aud"]);
    expect(identity.payload.aud).toBe("legacy-aud");
  });
});

function loadTestConfig(env: NodeJS.ProcessEnv) {
  return loadConfig({
    DATABASE_URL: "postgres://frank:test@postgres:5432/frank",
    REDIS_URL: "redis://redis:6379",
    CLOUDFLARE_ACCESS_ENABLED: "true",
    CLOUDFLARE_ACCESS_ISSUER: `${issuer}/`,
    ...env
  });
}

async function signAccessToken(audience: string): Promise<string> {
  return new SignJWT({
    email: "operator@frank.fail",
    name: "Frank Operator"
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: keyId
    })
    .setIssuer(issuer)
    .setSubject("operator")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}
