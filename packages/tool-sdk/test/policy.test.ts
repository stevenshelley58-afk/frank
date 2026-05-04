import { describe, expect, it } from "vitest";
import { createOperatorToolPolicy, foundationToolPolicy, noTerminalOpsConsoleSkeleton } from "../src/index.js";

describe("foundation tool policy", () => {
  it("allows read-only work", () => {
    expect(
      foundationToolPolicy.evaluate({
        toolName: "status.read",
        risk: "read",
        actorId: "test"
      }).decision
    ).toBe("allow");
  });

  it("requires approval for writes and denies host/destructive work", () => {
    expect(
      foundationToolPolicy.evaluate({
        toolName: "deploy.write",
        risk: "write",
        actorId: "test"
      }).decision
    ).toBe("approval_required");

    expect(
      foundationToolPolicy.evaluate({
        toolName: "host.exec",
        risk: "host",
        actorId: "test"
      }).decision
    ).toBe("deny");

    expect(noTerminalOpsConsoleSkeleton.every((action) => action.enabled === false)).toBe(true);
  });

  it("allows broad lab operator work while denying protected targets", () => {
    const policy = createOperatorToolPolicy({
      mode: "lab",
      protectedTargets: ["/", "/root", "/opt/frank-backups", "/opt/frank-hub/.env"]
    });

    expect(
      policy.evaluate({
        toolName: "shell.exec",
        risk: "host",
        actorId: "frank",
        target: "/opt/frank-hub"
      }).decision
    ).toBe("allow");

    expect(
      policy.evaluate({
        toolName: "file.delete",
        risk: "destructive",
        actorId: "frank",
        target: "/opt/frank-backups/postgres"
      }).decision
    ).toBe("deny");
  });
});
