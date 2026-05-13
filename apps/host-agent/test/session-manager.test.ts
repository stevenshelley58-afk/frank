import { describe, expect, it } from "vitest";
import {
  buildToolCommand,
  createHostSessionManager,
  isProtectedWorkspace,
  normalizeWorkspacePath,
  TmuxRunner,
  type HostRunner
} from "../src/session-manager.js";

describe("Frank host agent session manager", () => {
  it("builds interactive subscription-backed tool commands in the selected workspace", () => {
    expect(buildToolCommand({ tool: "codex", prompt: "continue this work" })).toEqual(["codex"]);
    expect(buildToolCommand({ tool: "claude_code", prompt: "inspect the repo" })).toEqual(["claude"]);
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
      command: ["codex"]
    });
    expect(runner.sentInput).toEqual([{ sessionName: session.sessionName, input: "resume the Frank build" }]);

    await manager.sendInput(session.id, "run pnpm test");
    expect(runner.sentInput).toEqual([
      { sessionName: session.sessionName, input: "resume the Frank build" },
      { sessionName: session.sessionName, input: "run pnpm test" }
    ]);

    runner.output.set(session.sessionName, "tests passed");
    await expect(manager.captureOutput(session.id)).resolves.toBe("tests passed");
    expect(await manager.listSessions()).toHaveLength(1);

    await manager.stopSession(session.id);
    expect(runner.stopped).toEqual([session.sessionName]);
    expect((await manager.getSession(session.id)).status).toBe("stopped");
  });

  it("starts tmux sessions as persistent shells before sending the AI tool command", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner = new TmuxRunner(async (file, args) => {
      calls.push({ file, args: [...args] });
      return { stdout: "" };
    });

    await runner.startSession({
      sessionName: "frank-codex-test",
      workspacePath: "/opt/frank-hub",
      command: ["codex"]
    });

    expect(calls).toEqual([
      {
        file: "tmux",
        args: ["new-session", "-d", "-s", "frank-codex-test", "-c", "/opt/frank-hub"]
      },
      {
        file: "tmux",
        args: ["send-keys", "-t", "frank-codex-test", "codex", "Enter"]
      }
    ]);
  });

  it("can attach to existing frank tmux sessions after host-agent memory is reset", async () => {
    const runner = new FakeRunner();
    const manager = createHostSessionManager({
      runner,
      protectedPaths: ["/", "/root"]
    });

    runner.output.set("frank-codex-existing", "existing Codex output");

    await expect(manager.captureOutput("frank-codex-existing")).resolves.toBe("existing Codex output");
    await manager.sendInput("frank-codex-existing", "continue");
    await manager.stopSession("frank-codex-existing");

    expect(runner.sentInput).toEqual([{ sessionName: "frank-codex-existing", input: "continue" }]);
    expect(runner.stopped).toEqual(["frank-codex-existing"]);
    await expect(manager.captureOutput("unrelated-session")).rejects.toThrow("AI session was not found.");
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
