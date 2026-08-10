'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { useAuth, useData } from '@/components/providers';
import { DEFAULT_ROOMS, type Room } from '@/lib/rooms';
import { frankStream, StreamAbortedError } from '@/lib/frank';
import {
  appendMessage,
  createConversation,
  listConversations,
  listMessages,
  listPendingDecisions,
  patchConversation,
  resolveDecision,
  type ChatMessageRow,
  type Conversation,
  type PendingDecision,
  type ThinkingMode,
} from '@/lib/chat-api';
import { ChatThread } from './chat-thread';
import { ComposerBar } from './composer-bar';
import { LivingFrame } from './living-frame';

/* ------------------------------------------------------------------ */
/* Projects — the rooms model, read as the shell's project list        */
/* ------------------------------------------------------------------ */

const PROJECTS: Room[] = DEFAULT_ROOMS;

/**
 * The home room is `central` in the data model, but there is only one Frank and
 * the interface should say his name — "Central" is scaffolding language.
 */
const displayName = (room: Room): string => (room.isHome === true ? 'Frank' : room.name);
const projectOf = (id: string): Room => PROJECTS.find((p) => p.id === id) ?? PROJECTS[0]!;

/** A rough context gauge: real token accounting lands with the kernel's pack. */
const CONTEXT_BUDGET_CHARS = 180_000;

/* ------------------------------------------------------------------ */

export function FrankShell() {
  const { api, status } = useAuth();
  const { today } = useData();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [homeProject, setHomeProject] = useState<string>('central');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['central']));
  const [filter, setFilter] = useState('');
  const [frameOpen, setFrameOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState('auto');
  const [draftThinking, setDraftThinking] = useState<ThinkingMode>('off');
  const abortRef = useRef<AbortController | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const currentProjectId = active?.project_id ?? homeProject;
  const currentProject = projectOf(currentProjectId);

  /* ---------------- loading ---------------- */

  const refreshConversations = useCallback(async () => {
    if (!api) return;
    try {
      setConversations(await listConversations(api));
    } catch {
      // The shell still works unsaved; the error card in providers covers auth.
    }
  }, [api]);

  const refreshDecisions = useCallback(async () => {
    if (!api) return;
    try {
      setDecisions(await listPendingDecisions(api));
    } catch {
      /* quiet */
    }
  }, [api]);

  useEffect(() => {
    if (status !== 'ready') return;
    void refreshConversations();
    void refreshDecisions();
    const timer = window.setInterval(() => {
      void refreshConversations();
      void refreshDecisions();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [status, refreshConversations, refreshDecisions]);

  useEffect(() => {
    if (!api || activeId === null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void listMessages(api, activeId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, activeId]);

  /* ---------------- derived ---------------- */

  const projectConversations = useCallback(
    (projectId: string) =>
      conversations
        .filter((c) => c.project_id === projectId)
        .sort((a, b) => {
          if (a.running !== b.running) return a.running ? -1 : 1;
          return b.last_message_at.localeCompare(a.last_message_at);
        }),
    [conversations],
  );

  const running = useMemo(() => conversations.filter((c) => c.running), [conversations]);

  const receipts = useMemo(
    () =>
      messages
        .filter((m) => m.kind === 'receipt')
        .slice(-4)
        .map((m) => ({
          id: m.id,
          title: m.body.slice(0, 80),
          sub: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          conversationId: m.conversation_id,
        })),
    [messages],
  );

  const contextUsed = useMemo(() => {
    const chars = messages.reduce((n, m) => n + m.body.length, 0);
    return Math.min(1, chars / CONTEXT_BUDGET_CHARS);
  }, [messages]);

  const projectName = useCallback((id: string) => displayName(projectOf(id)), []);

  /* ---------------- actions ---------------- */

  const openConversation = (id: string) => {
    setActiveId(id);
    const convo = conversations.find((c) => c.id === id);
    if (convo) {
      setExpanded((prev) => new Set(prev).add(convo.project_id));
      setDraftModel(convo.model);
      setDraftThinking((convo.thinking as ThinkingMode) ?? 'off');
    }
    setRailOpen(false);
  };

  const openHome = (projectId: string) => {
    setHomeProject(projectId);
    setActiveId(null);
    setExpanded((prev) => new Set(prev).add(projectId));
    setRailOpen(false);
  };

  const startChat = async (projectId: string, firstMessage?: string) => {
    if (!api) return null;
    const project = projectOf(projectId);
    const created = await createConversation(api, {
      projectId,
      agent: project.agent,
      title: firstMessage
        ? firstMessage.length > 48
          ? `${firstMessage.slice(0, 48).trimEnd()}…`
          : firstMessage
        : 'New chat',
      model: draftModel,
      thinking: draftThinking,
    });
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    setMessages([]);
    return created;
  };

  const send = async (text: string) => {
    if (!api) return;
    const conversation = active ?? (await startChat(currentProjectId, text));
    if (!conversation) return;

    const userRow = await appendMessage(api, conversation.id, { kind: 'user', body: text });
    setMessages((prev) => [...prev, userRow]);
    await patchConversation(api, conversation.id, { running: true });
    setConversations((prev) =>
      prev.map((c) => (c.id === conversation.id ? { ...c, running: true } : c)),
    );

    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText('');
    let accumulated = '';

    await frankStream(
      text,
      conversation.project_id,
      {
        onChunk: (chunk) => {
          accumulated += chunk;
          setStreamingText(accumulated);
        },
        onDone: () => {
          /* handled below */
        },
        onError: (err) => {
          accumulated = accumulated || `I couldn't reach my brain just then — ${err}`;
        },
      },
      currentProject.name,
      currentProject.agent,
      controller.signal,
    ).catch((err: unknown) => {
      if (!(err instanceof StreamAbortedError)) {
        accumulated = accumulated || 'The stream dropped before I could answer.';
      }
    });

    setStreamingText(null);
    abortRef.current = null;

    const body = accumulated.trim() || 'Acknowledged.';
    const agentRow = await appendMessage(api, conversation.id, { kind: 'agent', body });
    setMessages((prev) => [...prev, agentRow]);
    await patchConversation(api, conversation.id, { running: false });
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversation.id
          ? { ...c, running: false, last_message_at: agentRow.created_at }
          : c,
      ),
    );
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const changeModel = async (model: string) => {
    setDraftModel(model);
    if (api && active) {
      await patchConversation(api, active.id, { model });
      setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, model } : c)));
    }
  };

  const changeThinking = async (thinking: ThinkingMode) => {
    setDraftThinking(thinking);
    if (api && active) {
      await patchConversation(api, active.id, { thinking });
      setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, thinking } : c)));
    }
  };

  /**
   * Approve or decline. The row leaves the list immediately — a decision you
   * have made should not sit there looking undecided — and comes back if the
   * command was refused (a stale `expected_version`, say).
   */
  const onResolveDecision = async (decision: PendingDecision, outcome: 'ready' | 'cancel') => {
    if (!api) return;
    setDecisions((prev) => prev.filter((d) => d.id !== decision.id));
    try {
      await resolveDecision(api, decision, outcome);
    } catch {
      void refreshDecisions();
    }
    void refreshDecisions();
  };

  /* ---------------- render ---------------- */

  const filtered = filter
    ? conversations.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
    : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-shell">
      {/* sidebar */}
      <nav
        className={`fixed inset-y-0 left-0 z-50 flex w-[284px] shrink-0 flex-col border-r border-line bg-rail transition-transform duration-200 lg:static lg:translate-x-0 ${
          railOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-4">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-ink text-[16px] font-bold text-shell">
            F
          </span>
          <span className="text-[15px] font-bold tracking-[0.22em]">FRANK</span>
        </div>

        <button
          onClick={() => openHome('central')}
          className="mx-3 mb-1 mt-1.5 flex h-[38px] items-center justify-center gap-2 rounded-[10px] bg-accent text-[13px] font-semibold text-white transition-[filter] hover:brightness-105"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>

        <div className="relative mx-3 mb-1 mt-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4" />
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats…"
            className="h-[34px] w-full rounded-[9px] border border-line bg-shell pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5">
          {filtered !== null ? (
            <>
              <SideLabel>Results</SideLabel>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-hover"
                >
                  <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: projectOf(c.project_id).tint }} />
                  <span className="flex-1 truncate">{c.title}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2.5 py-2 text-[12px] text-muted/80">No chats match.</p>
              )}
            </>
          ) : (
            <>
              <SideLabel>Projects</SideLabel>
              {PROJECTS.map((project) => {
                const convos = projectConversations(project.id);
                const open = expanded.has(project.id);
                const isCurrent = currentProjectId === project.id;
                return (
                  <div key={project.id} className="mb-px">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openHome(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') openHome(project.id);
                      }}
                      className={`relative flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors hover:bg-hover ${
                        isCurrent ? 'bg-hover' : ''
                      }`}
                    >
                      {isCurrent && (
                        <span
                          className="absolute -left-0.5 bottom-2 top-2 w-[3px] rounded-[3px]"
                          style={{ background: project.tint }}
                        />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          });
                        }}
                        aria-label={open ? 'Collapse chats' : 'Expand chats'}
                        className="-ml-1 shrink-0 rounded-md p-0.5 text-muted/70 transition-colors hover:bg-hover hover:text-ink"
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          className={`block transition-transform ${open ? 'rotate-90' : ''}`}
                        >
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                      </button>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: project.tint }} />
                      <span className="flex-1 truncate text-[13px] font-semibold">{displayName(project)}</span>
                      {convos.some((c) => c.running) && (
                        <span className="animate-pip h-2 w-2 shrink-0 rounded-full bg-running" />
                      )}
                    </div>

                    {open && (
                      <div className="pb-1 pt-px">
                        {convos.slice(0, 4).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => openConversation(c.id)}
                            className={`flex w-full items-center gap-2 rounded-lg py-[5px] pl-8 pr-2.5 text-left text-[12px] transition-colors hover:bg-hover ${
                              c.id === activeId ? 'bg-hover font-medium text-ink' : 'text-ink2'
                            }`}
                          >
                            <span className="flex-1 truncate">{c.title}</span>
                            {c.running && <span className="animate-pip h-2 w-2 shrink-0 rounded-full bg-running" />}
                          </button>
                        ))}
                        {convos.length > 4 && (
                          <button
                            onClick={() => openHome(project.id)}
                            className="flex w-full items-center rounded-lg py-[5px] pl-8 pr-2.5 text-left text-[11.5px] text-muted/80 transition-colors hover:text-accent"
                          >
                            All {convos.length} chats →
                          </button>
                        )}
                        <button
                          onClick={() => void startChat(project.id)}
                          className="flex w-full items-center rounded-lg py-[5px] pl-8 pr-2.5 text-left text-[11.5px] text-muted/80 transition-colors hover:text-accent"
                        >
                          ＋ New chat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-ink text-[11px] font-bold text-shell">
            SF
          </span>
          <span className="flex-1 leading-tight">
            <b className="block text-[12.5px]">Steve</b>
            <span className="text-[10.5px] text-muted">Owner · full autonomy</span>
          </span>
          <Link
            href="/console"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Console"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m4 17 6-6-6-6M12 19h8" />
            </svg>
          </Link>
        </div>
      </nav>

      {railOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px] lg:hidden"
          onClick={() => setRailOpen(false)}
          aria-hidden
        />
      )}

      {/* workspace */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-shell">
        <header className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line px-4">
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open chats"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover lg:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: currentProject.tint }} />
          <b className="min-w-0 truncate text-[14px]">
            {active ? active.title : currentProject.isHome ? 'Frank' : currentProject.name}
          </b>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/80">
            · {active ? displayName(currentProject) : 'Home'}
          </span>
          <span className="flex-1" />
          <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/80 sm:inline">
            {currentProject.agent}
          </span>
          <button
            onClick={() => setFrameOpen((v) => !v)}
            className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink lg:hidden"
          >
            Frame
          </button>
        </header>

        {active ? (
          <ChatThread
            messages={messages}
            streamingText={streamingText}
            agentLabel={currentProject.isHome ? 'Frank' : currentProject.agent}
            tint={currentProject.tint}
            projectName={projectName}
            onFollowDelegation={(projectId) => openHome(projectId)}
          />
        ) : (
          <ProjectHome
            project={currentProject}
            conversations={projectConversations(currentProjectId)}
            onOpen={openConversation}
            onNew={() => void startChat(currentProjectId)}
          />
        )}

        <ComposerBar
          scopeLabel={currentProject.isHome ? 'Frank' : currentProject.name}
          tint={currentProject.isHome ? null : currentProject.tint}
          rgb={currentProject.isHome ? null : currentProject.rgb}
          streaming={streamingText !== null}
          disabled={status !== 'ready'}
          model={active?.model ?? draftModel}
          thinking={(active?.thinking as ThinkingMode) ?? draftThinking}
          contextUsed={contextUsed}
          onSend={(text) => void send(text)}
          onStop={stop}
          onModelChange={(m) => void changeModel(m)}
          onThinkingChange={(t) => void changeThinking(t)}
          onCompact={() => void startChat(currentProjectId)}
          onNewChat={() => void startChat(currentProjectId)}
        />
      </main>

      <LivingFrame
        open={frameOpen}
        decisions={decisions}
        running={running}
        today={today}
        receipts={receipts}
        projectName={projectName}
        onToggle={() => setFrameOpen((v) => !v)}
        onOpenConversation={openConversation}
        onResolve={(d, outcome) => void onResolveDecision(d, outcome)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 pt-3.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted/80">
      {children}
    </div>
  );
}

function ProjectHome({
  project,
  conversations,
  onOpen,
  onNew,
}: {
  project: Room;
  conversations: Conversation[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const running = conversations.filter((c) => c.running);
  const rest = conversations.filter((c) => !c.running);

  // Frank's own home stays bare: the signals live in the frame, and the
  // conversation is the interface.
  if (project.isHome && conversations.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <span className="animate-pip grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
          F
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-3.5 px-6 pb-4 pt-8">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 rounded-[4px]" style={{ background: project.tint }} />
          <div>
            <h1 className="text-[21px] font-semibold tracking-[-0.02em]">{displayName(project)}</h1>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted/80">
              {project.agent}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-accent transition-colors hover:border-accent"
          >
            ＋ New chat
          </button>
        </div>

        {running.length > 0 && (
          <HomeCard title="Running" count={running.length}>
            {running.map((c) => (
              <HomeRow key={c.id} onClick={() => onOpen(c.id)} title={c.title} sub="working · tap to watch" running />
            ))}
          </HomeCard>
        )}

        <HomeCard title="Chats" count={rest.length}>
          {rest.length === 0 ? (
            <p className="py-2 text-[12px] text-muted/80">No chats yet — start one below.</p>
          ) : (
            rest.map((c) => (
              <HomeRow
                key={c.id}
                onClick={() => onOpen(c.id)}
                title={c.title}
                sub={new Date(c.last_message_at).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                tint={project.tint}
              />
            ))
          )}
        </HomeCard>
      </div>
    </div>
  );
}

function HomeCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-line bg-card px-3.5 pb-2.5 pt-3">
      <h2 className="mb-1 flex items-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted/80">
        {title}
        <span className="ml-auto text-muted">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function HomeRow({
  title,
  sub,
  running = false,
  tint,
  onClick,
}: {
  title: string;
  sub: string;
  running?: boolean;
  tint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left last:border-b-0"
    >
      {running ? (
        <span className="animate-pip h-2 w-2 shrink-0 rounded-full bg-running" />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: tint ?? 'var(--color-border)' }} />
      )}
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[12.5px] font-semibold text-ink">{title}</b>
        <span className="mt-px block font-mono text-[9.5px] text-muted">{sub}</span>
      </span>
    </button>
  );
}
