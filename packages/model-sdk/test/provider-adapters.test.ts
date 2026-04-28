import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "@frank/shared";
import { providerAdapters, routeByRoleSkeleton } from "../src/index.js";

describe("provider adapter scaffolds", () => {
  it("creates one no-op adapter per required provider", async () => {
    expect(providerAdapters.map((adapter) => adapter.id)).toEqual(PROVIDER_IDS);

    const health = await providerAdapters[0]?.health();
    expect(health?.status).toBe("not_configured");
    expect(health?.ok).toBe(false);
  });

  it("routes by role without hardcoding model names", () => {
    const decision = routeByRoleSkeleton({
      role: "coding_fast",
      inputKind: "code"
    });

    expect(decision.role).toBe("coding_fast");
    expect(decision.providerId).toBe("openrouter");
    expect(decision.modelCatalogId).toBeUndefined();
  });
});
