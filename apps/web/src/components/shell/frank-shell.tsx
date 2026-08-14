'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth, useData } from '@/components/providers';
import { useCommandPalette } from '@/components/command-palette';
import { DEFAULT_ROOMS, type Room } from '@/lib/rooms';
// Chat streaming now goes through FrankChat → POST /v1/chat/turns SSE (W2-2).
// The legacy frankStream() → /api/chat SSE path has been removed.
import {
  createConversation,
  listConversations,
  patchConversation,
  profileForProject,
  resolveDecision,
  type Conversation,
  type PendingDecision,
} from '@/lib/chat-api';
import { getFrame, type FrameResponse } from '@/lib/frame';
import { FrankChat, type FrankChatHandle } from '@/components/chat/frank-chat';
import type { ModelOption } from './composer-bar';
import { LivingFrame } from './living-frame';
import { useHarnesses } from '@/lib/use-harnesses';
import { useCalendar } from '@/lib/use-calendar';

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

/* ------------------------------------------------------------------ */

export function FrankShell() {
  const { api, status } = useAuth();
  const { today, todayError, refresh: refreshToday } = useData();
  const { events: calendarEvents, status: calendarStatus, loading: calendarLoading, error: calendarError, refresh: refreshCalendar } = useCalendar(24);
  const { registerRooms } = useCommandPalette();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [homeProject, setHomeProject] = useState<string>('central');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['central']));
  const [filter, setFilter] = useState('');
  // Desktop and mobile represent the frame differently: the desktop rail can
  // be expanded/collapsed, while mobile uses a modal Sheet. Keeping these
  // states independent prevents a breakpoint change from opening the Sheet.
  const [desktopFrameOpen, setDesktopFrameOpen] = useState(true);
  const [mobileFrameOpen, setMobileFrameOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [chatRunning, setChatRunning] = useState(false);
  const [draftModel, setDraftModel] = useState('auto');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [frame, setFrame] = useState<FrameResponse | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const frameEtag = useRef<string | null>(null);
  const frankChatRef = useRef<FrankChatHandle | null>(null);
  const freshChatRef = useRef(false);
  const wasMobile = useRef<boolean | null>(null);
  const { providers: harnessProviders } = useHarnesses();

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const currentProjectId = active?.project_id ?? homeProject;
  const currentProject = projectOf(currentProjectId);
  const selectedModel = active?.model ?? draftModel;
  const effectiveModel = availableModels.some((option) => option.id === selectedModel) ? selectedModel : 'auto';

  /* ---------------- loading ---------------- */

  const refreshConversations = useCallback(async () => {
    if (!api) return;
    try {
      setConversations(await listConversations(api));
    } catch {
      // The shell still works unsaved; the error card in providers covers auth.
    }
  }, [api]);

  // Shares the Console's 20-second live provider snapshot, so recovered
  // models appear and unhealthy selections disappear without a page reload.
  useEffect(() => {
    setAvailableModels(
      harnessProviders.flatMap((provider) => provider.healthy ? (provider.models ?? []) : []),
    );
  }, [harnessProviders]);

  const refreshFrame = useCallback(async () => {
    if (!api) return;
    try {
      const result = await getFrame(api, frameEtag.current);
      frameEtag.current = result.etag;
      if (result.kind === 'data') {
        setFrame(result.frame);
        setDecisions(result.frame.waiting
          .filter((item) => item.kind === 'decision')
          .map((item) => ({ id: item.id, title: item.title, whyNow: item.guidance?.why_now ?? '', version: item.version, updatedAt: item.updated_at })));
      }
      setFrameError(null);
    } catch (error) {
      setFrameError(error instanceof Error ? error.message : 'The Living Frame could not be refreshed.');
    }
  }, [api]);

  useEffect(() => {
    if (status !== 'ready') return;
    void refreshConversations();
    void refreshFrame();
    const timer = window.setInterval(() => {
      void refreshConversations();
      void refreshFrame();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [status, refreshConversations, refreshFrame]);

  useEffect(() => {
    if (!api || activeId === null) return;
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

  const projectName = useCallback((id: string) => displayName(projectOf(id)), []);

  /* ---------------- actions ---------------- */

  const openConversation = (id: string) => {
    setActiveId(id);
    freshChatRef.current = false;
    const convo = conversations.find((c) => c.id === id);
    if (convo) {
      setExpanded((prev) => new Set(prev).add(convo.project_id));
      setDraftModel(convo.model);
    }
    setRailOpen(false);
  };

  const openHome = useCallback((projectId: string) => {
    setHomeProject(projectId);
    setActiveId(null);
    setExpanded((prev) => new Set(prev).add(projectId));
    setRailOpen(false);
  }, []);

  useEffect(() => registerRooms(openHome), [openHome, registerRooms]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => {
      const leavingMobile = wasMobile.current === true && !query.matches;
      wasMobile.current = query.matches;
      if (leavingMobile) {
        setMobileFrameOpen((wasOpen) => {
          // The mobile trigger is display:none after this breakpoint change,
          // so return focus to the workspace rather than a hidden control.
          if (wasOpen) window.setTimeout(() => document.getElementById('frank-workspace')?.focus(), 0);
          return false;
        });
      }
    };
    syncViewport();
    query.addEventListener('change', syncViewport);
    return () => query.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    const roomId = searchParams.get('room');
    if (roomId && DEFAULT_ROOMS.some((room) => room.id === roomId)) openHome(roomId);
  }, [openHome, searchParams]);

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
      model: effectiveModel,
      thinking: 'off',
    });
    setConversations((prev) => [created, ...prev]);
    setActiveId(created.id);
    freshChatRef.current = true;
    return created;
  };

  const stop = () => {
    void frankChatRef.current?.cancel();
    void refreshFrame();
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
      void refreshFrame();
    }
    void refreshFrame();
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

        <div className="border-t border-line px-2 pb-1.5 pt-2">
          <SideLabel>Workspace</SideLabel>
          <a
            href="/files"
            className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-ink2 transition-colors hover:bg-hover hover:text-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            Files
          </a>
          <a
            href="/skills"
            className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[12.5px] font-medium text-ink2 transition-colors hover:bg-hover hover:text-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            Skills
          </a>
        </div>

        <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-ink text-[11px] font-bold text-shell">
            SF
          </span>
          <span className="flex-1 leading-tight">
            <b className="block text-[12.5px]">Steve</b>
            <span className="text-[10.5px] text-muted">Owner · full autonomy</span>
          </span>
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
      <main id="frank-workspace" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-shell">
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
            onClick={() => setMobileFrameOpen((v) => !v)}
            id="living-frame-trigger"
            aria-controls="living-frame-sheet"
            aria-expanded={mobileFrameOpen}
            className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink lg:hidden"
          >
            Frame
          </button>
        </header>

        {active && api ? (
          <FrankChat
            ref={frankChatRef}
            api={api}
            conversationId={active.id}
            profile={profileForProject(currentProjectId)}
            restored={active !== null && !freshChatRef.current}
            agentLabel={currentProject.isHome ? 'Frank' : currentProject.agent}
            tint={currentProject.tint}
            onRunningChange={setChatRunning}
            onTitleChange={(title) => {
              if (active) void patchConversation(api, active.id, { title });
            }}
          />
        ) : (
          <ProjectHome
            project={currentProject}
            conversations={projectConversations(currentProjectId)}
            onOpen={openConversation}
            onNew={() => void startChat(currentProjectId)}
          />
        )}
      </main>

        <LivingFrame
          desktopOpen={desktopFrameOpen}
          mobileOpen={mobileFrameOpen}
          decisions={decisions}
          frame={frame}
          frameError={frameError}
          today={today}
          todayError={todayError}
          calendarEvents={calendarEvents}
          calendarStatus={calendarStatus}
          calendarLoading={calendarLoading}
          calendarError={calendarError}
          projectName={projectName}
        onDesktopToggle={() => setDesktopFrameOpen((v) => !v)}
        onMobileOpenChange={setMobileFrameOpen}
        onOpenConversation={openConversation}
          onResolve={(d, outcome) => void onResolveDecision(d, outcome)}
          onRetry={() => void refreshFrame()}
          onRetryToday={() => { void refreshToday(); void refreshCalendar(); }}
          onStopActiveChat={stop}
          activeChatId={activeId}
          activeChatStreaming={chatRunning}
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
