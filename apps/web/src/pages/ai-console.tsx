import { Bot, Code2, Copy, ExternalLink, Globe2, PlugZap, RefreshCw, Send, Square, TerminalSquare } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createAiHandoff,
  createAiSession,
  getAiSessionOutput,
  getAiHostStatus,
  getBrowserStatus,
  listAiSessions,
  listProjects,
  sendAiSessionInput,
  startBrowser,
  stopBrowser,
  stopAiSession,
  type AiHostStatusResponse,
  type AiTool,
  type AiToolSession,
  type BrowserStatusResponse,
  type Project
} from "../api.js";
import {
  DataTable,
  EmptyState,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button, Input, Textarea } from "../components/ui/index.js";
import { formatDateTime, titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: AiConsoleData }
  | { status: "error"; message: string };

interface AiConsoleData {
  host: AiHostStatusResponse;
  sessions: AiToolSession[];
  projects: Project[];
  browser: BrowserStatusResponse;
}

const CODEX_APP_URL = "https://chatgpt.com/codex";

export function AiConsolePage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [workspacePath, setWorkspacePath] = useState("/opt/frank-hub");
  const [prompt, setPrompt] = useState("Continue the Frank Hub build from the shared project instructions.");
  const [handoffSummary, setHandoffSummary] = useState("Continue the current Frank Hub implementation work.");
  const [browser, setBrowser] = useState<BrowserStatusResponse>({ running: false, url: "/vps-browser/" });
  const [activeSession, setActiveSession] = useState<AiToolSession | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      getAiHostStatus({ signal: controller.signal }),
      listAiSessions({ signal: controller.signal }),
      listProjects({ signal: controller.signal }),
      getBrowserStatus({ signal: controller.signal })
    ])
      .then(([host, sessions, projects, browserStatus]) => {
        setBrowser(browserStatus);
        setState({ status: "ready", data: { host, sessions, projects, browser: browserStatus } });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, []);

  const sessions = state.status === "ready" ? state.data.sessions : [];
  const displayedSessions = useMemo(() => {
    if (!activeSession || sessions.some((session) => session.id === activeSession.id)) {
      return sessions;
    }
    return [activeSession, ...sessions];
  }, [activeSession, sessions]);
  const projects = state.status === "ready" ? state.data.projects : [];
  const projectOptions = useMemo(() => [
    { label: "Frank Hub", value: "/opt/frank-hub" },
    ...projects.map((project) => ({ label: project.displayName, value: project.workspacePath }))
  ], [projects]);

  async function startTool(tool: AiTool) {
    setMessage(null);
    try {
      const session = await createAiSession({
        tool,
        workspacePath,
        prompt,
        metadata: {
          source: "ai_console"
        }
      });
      setActiveSession(session);
      setMessage(`${toolLabel(tool)} started in ${workspacePath}`);
      await refreshTerminal(session);
      load();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function openBrowser(target: "chatgpt" | "claude") {
    setMessage(null);
    try {
      const result = await startBrowser(target);
      setBrowser(result);
      setMessage(browserActionMessage(target, result));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function closeBrowser() {
    setMessage(null);
    try {
      const result = await stopBrowser();
      setBrowser(result);
      setMessage("VPS browser stopped.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function stopSession(id: string) {
    try {
      const session = await stopAiSession(id);
      setActiveSession(session);
      load();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function stopAllSessions() {
    const running = displayedSessions.filter((session) => session.status === "running");
    try {
      await Promise.all(running.map((session) => stopAiSession(session.id)));
      setActiveSession((current) => current ? { ...current, status: "stopped", stoppedAt: new Date().toISOString() } : current);
      setMessage(`Stopped ${running.length} ${running.length === 1 ? "session" : "sessions"}.`);
      load();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function attachSession(session: AiToolSession) {
    setActiveSession(session);
    await refreshTerminal(session);
  }

  async function refreshTerminal(session = activeSession) {
    if (!session) {
      return;
    }
    try {
      setTerminalError(null);
      setTerminalOutput(await getAiSessionOutput(session.id));
    } catch (error) {
      setTerminalError(errorMessage(error));
    }
  }

  async function submitTerminalInput(event: React.FormEvent) {
    event.preventDefault();
    const input = terminalInput.trim();
    if (!activeSession || !input) {
      return;
    }
    try {
      await sendAiSessionInput(activeSession.id, input);
      setTerminalInput("");
      await refreshTerminal(activeSession);
    } catch (error) {
      setTerminalError(errorMessage(error));
    }
  }

  async function copyHandoff() {
    try {
      const handoff = await createAiHandoff({
        targetTool: "codex",
        title: "Continue Frank Hub work",
        summary: handoffSummary,
        workspacePath,
        metadata: {
          source: "ai_console"
        }
      });
      await navigator.clipboard?.writeText(handoff.prompt).catch(() => undefined);
      const session = await createAiSession({
        tool: "codex",
        workspacePath,
        prompt: handoff.prompt,
        metadata: {
          source: "ai_console_handoff",
          handoffId: handoff.id
        }
      });
      setActiveSession(session);
      await refreshTerminal(session);
      load();
      setMessage("Codex handoff created, copied when clipboard access is available, and launched.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  const { host } = state.data;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="Codex Workstation"
        description="Open the official Codex app or run Codex CLI inside Frank's VPS workspace."
        icon={<Code2 aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        <div className="grid gap-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="grid content-start gap-3">
              <div className="grid gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ExternalLink aria-hidden="true" className="size-4" />
                  Codex App
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Open the official Codex app in a new tab.
                </p>
                <Button asChild size="lg" className="w-full sm:w-fit">
                  <a href={CODEX_APP_URL} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Open Codex App
                  </a>
                </Button>
              </div>

              <div className="grid gap-2 border-t border-border pt-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TerminalSquare aria-hidden="true" className="size-4" />
                  Codex CLI
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Start a VPS tmux session in the selected workspace and attach the terminal below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void startTool("codex")}>
                    <Code2 aria-hidden="true" />
                    Start Codex CLI
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void startTool("claude_code")}>
                    <TerminalSquare aria-hidden="true" />
                    Start Claude Code
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
                <label className="grid gap-1 text-sm font-medium text-foreground">
                  Project
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    value={workspacePath}
                    onChange={(event) => setWorkspacePath(event.target.value)}
                  >
                    {projectOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-foreground">
                  Workspace path
                  <Input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} />
                </label>
              </div>

              <label className="grid gap-1 text-sm font-medium text-foreground">
                Launch prompt
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
              </label>
            </div>
          </div>

          <HostStatusStrip host={host} />

          {message ? (
            <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm leading-6 text-foreground">
              {message}
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Terminal"
        description="Codex CLI and Claude Code attach here after launch."
        icon={<TerminalSquare aria-hidden="true" />}
        action={activeSession ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshTerminal()}>
              <RefreshCw aria-hidden="true" />
              Refresh Output
            </Button>
            {activeSession.status === "running" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void stopSession(activeSession.id)}>
                <Square aria-hidden="true" />
                Stop Session
              </Button>
            ) : null}
          </div>
        ) : null}
      >
        {activeSession ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={activeSession.status === "running" ? "checking" : "planned"}>{titleize(activeSession.status)}</StatusBadge>
                <span className="text-foreground">{toolLabel(activeSession.tool)}</span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{activeSession.sessionName ?? activeSession.id}</span>
            </div>
            <pre className="min-h-[28rem] max-h-[44rem] overflow-auto rounded-md border border-border bg-black p-4 font-mono text-xs leading-5 text-white">
              {terminalOutput || "No terminal output captured yet."}
            </pre>
            {terminalError ? <p className="text-sm text-destructive">{terminalError}</p> : null}
            <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={submitTerminalInput}>
              <label className="grid gap-1 text-sm font-medium text-foreground">
                Terminal input
                <Input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} />
              </label>
              <Button type="submit" className="self-end">
                <Send aria-hidden="true" />
                Send Input
              </Button>
            </form>
          </div>
        ) : (
          <div className="grid gap-3">
            <EmptyState
              icon={<TerminalSquare aria-hidden="true" />}
              title="No terminal attached"
              description="Start Codex CLI or attach a recent session."
            />
            <div className="flex justify-center">
              <Button type="button" aria-label="Start Codex CLI from terminal" onClick={() => void startTool("codex")}>
                <Code2 aria-hidden="true" />
                Start Codex CLI
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <SectionCard
          title="Browser Tools"
          description="Optional VPS browser for ChatGPT and Claude web sessions."
          icon={<Globe2 aria-hidden="true" />}
        >
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void openBrowser("chatgpt")}>
                <Globe2 aria-hidden="true" />
                Open ChatGPT
              </Button>
              <Button type="button" variant="outline" onClick={() => void openBrowser("claude")}>
                <Bot aria-hidden="true" />
                Open Claude
              </Button>
              {browser.running ? (
                <Button type="button" variant="outline" onClick={() => void closeBrowser()}>
                  <Square aria-hidden="true" />
                  Stop Browser
                </Button>
              ) : null}
            </div>
            {browser.running ? (
              <iframe title="VPS browser" src={browser.url} className="h-[32rem] w-full rounded-md border border-border bg-black" />
            ) : (
              <EmptyState
                icon={<Globe2 aria-hidden="true" />}
                title="Browser is stopped"
                description={browser.message ?? "Open ChatGPT or Claude when you need the web client."}
              />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Sessions"
          description="Running and recent VPS AI sessions."
          icon={<TerminalSquare aria-hidden="true" />}
          action={displayedSessions.some((session) => session.status === "running") ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void stopAllSessions()}>
              <Square aria-hidden="true" />
              Stop All
            </Button>
          ) : null}
        >
          <DataTable
            data={displayedSessions}
            getRowId={(session) => session.id}
            emptyState={<EmptyState icon={<TerminalSquare aria-hidden="true" />} title="No AI sessions" description="Start Codex CLI or Claude Code above." />}
            columns={[
              { id: "id", header: "Session", cell: (session) => <span className="font-mono text-xs">{session.id}</span> },
              { id: "tool", header: "Tool", cell: (session) => toolLabel(session.tool) },
              { id: "status", header: "Status", cell: (session) => <StatusBadge tone={session.status === "running" ? "checking" : "planned"}>{titleize(session.status)}</StatusBadge> },
              { id: "workspace", header: "Workspace", cell: (session) => <span className="text-muted-foreground">{session.workspacePath}</span> },
              { id: "updated", header: "Updated", cell: (session) => formatDateTime(session.updatedAt) },
              {
                id: "actions",
                header: "Actions",
                cell: (session) => (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void attachSession(session)}>
                      <TerminalSquare aria-hidden="true" />
                      Attach
                    </Button>
                    {session.status === "running" ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void stopSession(session.id)}>
                        <Square aria-hidden="true" />
                        Stop
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
          />
          {activeSession ? <p className="mt-3 text-sm text-muted-foreground">Selected session: {activeSession.id}</p> : null}
        </SectionCard>
      </section>

      <SectionCard
        title="Codex Handoff"
        description="Create a handoff prompt from current Frank context."
        icon={<Copy aria-hidden="true" />}
      >
        <form className="grid gap-3" onSubmit={(event: React.FormEvent) => { event.preventDefault(); void copyHandoff(); }}>
          <Textarea value={handoffSummary} onChange={(event) => setHandoffSummary(event.target.value)} rows={5} />
          <Button type="submit">
            <Copy aria-hidden="true" />
            Launch Codex Handoff
          </Button>
        </form>
      </SectionCard>
    </section>
  );
}

function browserActionMessage(target: "chatgpt" | "claude", browser: BrowserStatusResponse): string {
  const label = target === "chatgpt" ? "ChatGPT" : "Claude";
  if (browser.configured === false) {
    return "Frank's VPS browser is not connected yet. Run the host agent setup on the VPS, then redeploy.";
  }
  if (browser.running !== true) {
    return browser.message?.trim() || `Frank tried to open ${label}, but the VPS browser did not report ready.`;
  }
  if (!browser.url.trim()) {
    return `Frank opened ${label}, but did not receive a browser address.`;
  }
  return `${label} is ready in Frank.`;
}

type HostStatusTone = "ok" | "warning" | "bad";

interface HostStatusItem {
  label: string;
  value: string;
  tone: HostStatusTone;
  detail?: string;
}

function HostStatusStrip({ host }: { host: AiHostStatusResponse }) {
  const items = hostStatusItems(host);
  return (
    <div className="grid gap-2" aria-label="Host agent status">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs ${hostStatusToneClass(item.tone)}`}
            title={item.detail}
          >
            <span className={`size-2 rounded-full ${hostStatusDotClass(item.tone)}`} aria-hidden="true" />
            <span className="font-semibold">{item.label}</span>
            <span className="text-muted-foreground">{item.value}</span>
          </div>
        ))}
      </div>
      {host.message ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm leading-6 text-foreground">
          <PlugZap aria-hidden="true" className="mr-2 inline size-4 align-[-0.125em]" />
          {host.message}
        </p>
      ) : null}
    </div>
  );
}

function hostStatusItems(host: AiHostStatusResponse): HostStatusItem[] {
  const hostItem: HostStatusItem = !host.configured
    ? { label: "Host Agent", value: "Not connected", tone: "bad", detail: "Install the Frank Host Agent on the VPS." }
    : host.reachable
      ? {
          label: "Host Agent",
          value: "Reachable",
          tone: "ok",
          ...(host.version ? { detail: `Version ${host.version}` } : {})
        }
      : {
          label: "Host Agent",
          value: "Unreachable",
          tone: "bad",
          ...(host.message ? { detail: host.message } : {})
        };

  return [
    hostItem,
    hostToolStatusItem("tmux", host.tools.tmux),
    hostToolStatusItem("Codex CLI", host.tools.codex),
    hostToolStatusItem("Claude Code", host.tools.claudeCode),
    hostToolStatusItem("Docker", host.tools.docker)
  ].sort((left, right) => hostStatusToneRank(left.tone) - hostStatusToneRank(right.tone));
}

function hostToolStatusItem(
  label: string,
  status: { installed?: boolean; path?: string | null } | undefined
): HostStatusItem {
  if (!status) {
    return { label, value: "Unknown", tone: "warning" };
  }
  if (status.installed) {
    return {
      label,
      value: "Ready",
      tone: "ok",
      ...(status.path ? { detail: status.path } : {})
    };
  }
  return { label, value: "Missing", tone: "bad" };
}

function hostStatusToneRank(tone: HostStatusTone): number {
  return tone === "bad" ? 0 : tone === "warning" ? 1 : 2;
}

function hostStatusToneClass(tone: HostStatusTone): string {
  if (tone === "bad") {
    return "border-destructive/30 bg-destructive/10 text-foreground";
  }
  if (tone === "warning") {
    return "border-warning/30 bg-warning/10 text-foreground";
  }
  return "border-border bg-surface text-foreground";
}

function hostStatusDotClass(tone: HostStatusTone): string {
  if (tone === "bad") {
    return "bg-destructive";
  }
  if (tone === "warning") {
    return "bg-warning";
  }
  return "bg-success";
}

function toolLabel(tool: AiTool): string {
  return tool === "codex" ? "Codex" : "Claude Code";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Codex Workstation.";
}
