import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("VPS browser runtime config", () => {
  it("uses a public noVNC Chromium image with persistent profile storage and a startup URL", async () => {
    const compose = await readFile(resolve(repoRoot, "docker-compose.browser.yml"), "utf8");

    expect(compose).toContain("image: ${FRANK_BROWSER_IMAGE:-jlesage/chromium:latest}");
    expect(compose).toContain("CHROMIUM_APP_URL: ${FRANK_BROWSER_APP_URL:-https://chatgpt.com}");
    expect(compose).toContain("KEEP_APP_RUNNING: \"1\"");
    expect(compose).toContain("./runtime/browser:/config");
    expect(compose).not.toContain("jlesage/chrome");
    expect(compose).not.toContain("APP_ARGS");
  });

  it("reuses the browser container so login cookies can live as long as the profile remains valid", async () => {
    const script = await readFile(resolve(repoRoot, "scripts/browser_up.sh"), "utf8");

    expect(script).toContain('FRANK_BROWSER_APP_URL="${target_url}"');
    expect(script).toContain("--no-recreate");
    expect(script).not.toContain("--force-recreate");
  });
});
