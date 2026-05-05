import { describe, expect, it } from "vitest";
import {
  buildToolCommand,
  createHostSessionManager,
  isProtectedWorkspace,
  normalizeWorkspacePath,
  type HostRunner
} from "../src/session-manager.js";

describe("Frank host agent session manager", () => {
  it("builds subscription-backed tool commands in the selected workspace", () => {
    expect(buildToolCommand({ tool: "codex", prompt: "continue this work" })).toEqual([
      "codex",
      "continue this work"
    ]);
    expect(buildToolCommand({ tool: "claude_code", prompt: "inspect the repo" })).toEqual([
      "claude",
      "inspect the repo"
    ]);
  });

  it("denies protected host paths even when run-wild lab mode is enabled", () => {
    expect(normalizeWorkspacePath("/opt/frank-hub/")).toBe("/opt/frank-hub");
    expect(isProtectedWorkspace("/opt/frank-hub", ["/opt/frank-hub/runtime/access"])).toBe(false);
    expect(isProtectedWorkspace("/opt/frank-hub/runtime/access/frank-access.env", ["/opt/frank-hub/runtime/access"])).toBe(true);
    expect(isProtectedWorkspace("/root", ["/root"])).toBe(true);
    expect(isProtectedWorkspace("/", ["/"])).toBe(true);
  });

  it("starts, lists, writes to, captures, and stops tmux-backed sessions through a runner", async () => {
    const runner = new FakeRunner();
    const manager = createHostSessionManager({
      runner,
      protectedPaths: ["/", "/root", "/etc", "/opt/frank-hub/runtime/access"]
    });

    const session = await manager.createSession({
      tool: "codex",
      workspacePath: "/opt/frank-hub",
      prompt: "resume the Frank build"
    });

    expect(session).toMatchObject({
      tool: "codex",
      workspacePath: "/opt/frank-hub",
      status: "running"
    });
    expect(runner.started[0]).toMatchObject({
      workspacePath: "/opt/frank-hub",
      command: ["codex", "resume the Frank build"]
    });

    await manager.sendInput(session.id, "run pnpm test");
    expect(runner.sentInput).toEqual([{ sessionName: session.sessionName, input: "run pnpm test" }]);

    runner.output.set(session.sessionName, "tests passed");
    await expect(manager.captureOutput(session.id)).resolves.toBe("tests passed");
    expect(await manager.listSessions()).toHaveLength(1);

    await manager.stopSession(session.id);
    expect(runner.stopped).toEqual([session.sessionName]);
    expect((await manager.getSession(session.id)).status).toBe("stopped");
  });
});

class FakeRunner implements HostRunner {
  readonly started: Array<{ sessionName: string; workspacePath: string; command: string[] }> = [];
  readonly sentInput: Array<{ sessionName: string; input: string }> = [];
  readonly stopped: string[] = [];
  readonly output = new Map<string, string>();

  async startSession(input: { sessionName: string; workspacePath: string; command: string[] }): Promise<void> {
    this.started.push(input);
  }

  async sendInput(sessionName: string, input: string): Promise<void> {
    this.sentInput.push({ sessionName, input });
  }

  async captureOutput(sessionName: string): Promise<string> {
    return this.output.get(sessionName) ?? "";
  }

  async stopSession(sessionName: string): Promise<void> {
    this.stopped.push(sessionName);
  }
}
