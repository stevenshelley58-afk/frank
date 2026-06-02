import { describe, expect, it } from "vitest";
import { buildAionUiCookieHeader } from "../src/server.js";

describe("buildAionUiCookieHeader", () => {
  it("prefers the JWT token returned in the AionUi login JSON body", () => {
    const header = buildAionUiCookieHeader({
      cookieName: "aionui-session",
      body: JSON.stringify({ success: true, token: "jwt.body.token", user: { username: "admin" } }),
      setCookieHeader: "aionui-session=stale-cookie-token; Path=/; HttpOnly"
    });
    expect(header).toBe("aionui-session=jwt.body.token");
  });

  it("falls back to the upstream Set-Cookie when the body has no token", () => {
    const header = buildAionUiCookieHeader({
      cookieName: "aionui-session",
      body: JSON.stringify({ success: true }),
      setCookieHeader: "aionui-session=cookie-only-token; Path=/; HttpOnly; SameSite=Strict"
    });
    expect(header).toBe("aionui-session=cookie-only-token");
  });

  it("falls back to Set-Cookie when the body is not JSON", () => {
    const header = buildAionUiCookieHeader({
      cookieName: "aionui-session",
      body: "<html>not json</html>",
      setCookieHeader: "aionui-session=abc; Path=/"
    });
    expect(header).toBe("aionui-session=abc");
  });

  it("respects a custom cookie name when minting from the body token", () => {
    const header = buildAionUiCookieHeader({
      cookieName: "custom-session",
      body: JSON.stringify({ success: true, token: "xyz" }),
      setCookieHeader: null
    });
    expect(header).toBe("custom-session=xyz");
  });

  it("throws a clear error when AionUi rejects the stored credentials", () => {
    expect(() =>
      buildAionUiCookieHeader({
        cookieName: "aionui-session",
        body: JSON.stringify({ success: false, message: "Invalid username or password" }),
        setCookieHeader: null
      })
    ).toThrow(/rejected the stored admin credentials/i);
  });

  it("throws when neither a token nor a usable cookie is present", () => {
    expect(() =>
      buildAionUiCookieHeader({
        cookieName: "aionui-session",
        body: JSON.stringify({ success: true }),
        setCookieHeader: null
      })
    ).toThrow(/did not return a session token or cookie/i);
  });
});
