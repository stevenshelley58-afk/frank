import { describe, expect, it } from "vitest";
import { getAccessToken } from "../src/access.js";

describe("Cloudflare Access helper", () => {
  it("reads Cf-Access-Jwt-Assertion case-insensitively through Fastify headers", () => {
    const token = getAccessToken({
      headers: {
        "cf-access-jwt-assertion": "header-token"
      }
    } as never);

    expect(token).toBe("header-token");
  });
});
