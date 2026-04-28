import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { ApiConfig } from "./config.js";

export interface AccessIdentity {
  sub?: string;
  email?: string;
  name?: string;
  payload: JWTPayload;
}

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

const jwksCache = new Map<string, RemoteJwks>();

export function getAccessToken(request: FastifyRequest): string | undefined {
  const header = request.headers["cf-access-jwt-assertion"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

export function getJwksForIssuer(issuer: string): RemoteJwks {
  const normalizedIssuer = issuer.replace(/\/$/, "");
  const cached = jwksCache.get(normalizedIssuer);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(`${normalizedIssuer}/cdn-cgi/access/certs`));
  jwksCache.set(normalizedIssuer, jwks);
  return jwks;
}

export async function validateCloudflareAccessJwt(
  token: string,
  config: ApiConfig["cloudflareAccess"]
): Promise<AccessIdentity> {
  if (!config.issuer || config.audiences.length === 0) {
    throw new Error("cloudflare_access_not_configured");
  }

  const result = await jwtVerify(token, getJwksForIssuer(config.issuer), {
    issuer: config.issuer,
    audience: config.audiences
  });

  const identity: AccessIdentity = {
    payload: result.payload
  };

  if (result.payload.sub) {
    identity.sub = result.payload.sub;
  }
  if (typeof result.payload.email === "string") {
    identity.email = result.payload.email;
  }
  if (typeof result.payload.name === "string") {
    identity.name = result.payload.name;
  }

  return identity;
}

export async function requireCloudflareAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  config: ApiConfig
): Promise<void> {
  if (!config.cloudflareAccess.enabled) {
    request.accessIdentity = {
      sub: "local-dev",
      email: "local-dev@frank.fail",
      payload: {}
    };
    return;
  }

  const token = getAccessToken(request);
  if (!token) {
    await reply.code(401).send({
      error: "cloudflare_access_required",
      message: "Missing Cf-Access-Jwt-Assertion header."
    });
    return;
  }

  try {
    request.accessIdentity = await validateCloudflareAccessJwt(token, config.cloudflareAccess);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare Access validation failed.";
    const statusCode = message === "cloudflare_access_not_configured" ? 503 : 401;
    await reply.code(statusCode).send({
      error: statusCode === 503 ? "cloudflare_access_not_configured" : "cloudflare_access_invalid",
      message
    });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    accessIdentity?: AccessIdentity;
  }
}
