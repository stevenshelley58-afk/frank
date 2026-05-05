import { Bot, Code2, Copy, Globe2, Monitor, PlugZap, RefreshCw, Square, TerminalSquare } from "lucide-react";
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
  KeyValueList,
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
  }

  async function openBrowser(target: "chatgpt" | "claude") {
    setMessage(null);
    const result = await startBrowser();
    setBrowser(result);
    setMessage(`${target === "chatgpt" ? "ChatGPT" : "Claude"} browser is ready.`);
  }

  async function closeBrowser() {
    setMessage(null);
    const result = await stopBrowser();
    setBrowser(result);
    setMessage("VPS browser stopped.");
  }

  async function stopSession(id: string) {
    const session = await stopAiSession(id);
    setActiveSession(session);
    load();
  }

  async function stopAllSessions() {
    const running = displayedSessions.filter((session) => session.status === "running");
    await Promise.all(running.map((session) => stopAiSession(session.id)));
    setActiveSession((current) => current ? { ...current, status: "stopped", stoppedAt: new Date().toISOString() } : current);
    setMessage(`Stopped ${running.length} ${running.length === 1 ? "session" : "sessions"}.`);
    load();
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
    await sendAiSessionInput(activeSession.id, input);
    setTerminalInput("");
    await refreshTerminal(activeSession);
  }

  async function copyHandoff() {
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
      <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
        <SectionCard
          title="AI Workstation"
          description="Subscription-backed tools running inside the VPS."
          icon={<Monitor aria-hidden="true" />}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ToolCard
                title="ChatGPT Browser"
                description="Use your ChatGPT web subscription in the VPS browser."
                icon={<Globe2 aria-hidden="true" />}
                actionLabel="Open ChatGPT Browser"
                onAction={() => void openBrowser("chatgpt")}
              />
              <ToolCard
                title="Claude Browser"
                description="Use Claude web inside the same VPS browser profile."
                icon={<Bot aria-hidden="true" />}
                actionLabel="Open Claude Browser"
                onAction={() => void openBrowser("claude")}
              />
              <ToolCard
                title="Codex"
                description="Launch Codex CLI in the selected VPS workspace."
                icon={<Code2 aria-hidden="true" />}
                actionLabel="Start Codex"
                onAction={() => void startTool("codex")}
              />
              <ToolCard
                title="Claude Code"
                description="Launch Claude Code in the selected VPS workspace."
                icon={<TerminalSquare aria-hidden="true" />}
                actionLabel="Start Claude Code"
                onAction={() => void startTool("claude_code")}
              />
            </div>

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
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
            </label>

            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </SectionCard>

        <SectionCard title="Host Agent" description="Install and runtime status from the VPS host." icon={<PlugZap aria-hidden="true" />}>
          <KeyValueList
            items={[
              { label: "Configured", value: host.configured ? "Yes" : "No" },
              { label: "Reachable", value: host.reachable ? "Yes" : "No" },
              { label: "Run wild", value: host.runWild ? "Enabled" : "Unknown" },
              { label: "tmux", value: installedLabel(host.tools.tmux) },
              { label: "Codex", value: installedLabel(host.tools.codex) },
              { label: "Claude Code", value: installedLabel(host.tools.claudeCode) },
              { label: "Docker", value: installedLabel(host.tools.docker) }
            ]}
          />
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <SectionCard
          title="VPS Browser"
          description="Embedded same-origin browser viewer."
          icon={<Globe2 aria-hidden="true" />}
          action={browser.running ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void closeBrowser()}>
              <Square aria-hidden="true" />
              Stop
            </Button>
          ) : null}
        >
          {browser.running ? (
            <iframe title="VPS browser" src={browser.url} className="h-[34rem] w-full rounded-md border border-border bg-black" />
          ) : (
            <EmptyState
              icon={<Globe2 aria-hidden="true" />}
              title="Browser is stopped"
              description="Open ChatGPT Browser or Claude Browser to start the VPS browser."
            />
          )}
        </SectionCard>

        <SectionCard title="Terminal" description="Attach to Codex or Claude Code running in tmux." icon={<TerminalSquare aria-hidden="true" />}>
          {activeSession ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{activeSession.sessionName ?? activeSession.id}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void refreshTerminal()}>
                  <RefreshCw aria-hidden="true" />
                  Refresh Output
                </Button>
              </div>
              <pre className="min-h-80 max-h-[32rem] overflow-auto rounded-md border border-border bg-black p-3 font-mono text-xs leading-5 text-white">
                {terminalOutput || "No terminal output captured yet."}
              </pre>
              {terminalError ? <p className="text-sm text-destructive">{terminalError}</p> : null}
              <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={submitTerminalInput}>
                <label className="grid gap-1 text-sm font-medium text-foreground">
                  Terminal input
                  <Input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} />
                </label>
                <Button type="submit" className="self-end">Send Input</Button>
              </form>
            </div>
          ) : (
            <EmptyState
              icon={<TerminalSquare aria-hidden="true" />}
              title="No terminal attached"
              description="Start or attach a Codex or Claude Code session."
            />
          )}
        </SectionCard>
      </section>

      <SectionCard
        title="Continue In Codex"
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
          emptyState={<EmptyState icon={<TerminalSquare aria-hidden="true" />} title="No AI sessions" description="Start Codex or Claude Code above." />}
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
  );
}

function ToolCard({
  title,
  description,
  icon,
  actionLabel,
  onAction
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-foreground">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}

function installedLabel(status: { installed?: boolean; path?: string | null } | undefined): string {
  if (!status) {
    return "Unknown";
  }
  return status.installed ? status.path ?? "Installed" : "Missing";
}

function toolLabel(tool: AiTool): string {
  return tool === "codex" ? "Codex" : "Claude Code";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load AI Console.";
}
