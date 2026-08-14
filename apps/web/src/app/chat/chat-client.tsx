'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/components/providers';
import { FrankChat } from '@/components/chat/frank-chat';
import { createConversation, profileForProject } from '@/lib/chat-api';
import { DEFAULT_ROOMS, roomById, type Room } from '@/lib/rooms';

/**
 * Client host for /chat. Resolves the profile from ?project= (hub by
 * default), creates or reuses a conversation, and renders FrankChat —
 * the assistant-ui surface that streams turns from Hermes.
 */
export function ChatPageClient() {
  const { api, status } = useAuth();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project') ?? 'central';
  const project: Room = roomById(DEFAULT_ROOMS, projectParam);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [title, setTitle] = useState<string>('New chat');
  const [error, setError] = useState<string | null>(null);

  // A ?conversation= deep-link reopens an existing conversation; otherwise
  // create one on mount. The conversation id doubles as the Hermes session
  // key, so a reload with the same id chains the same Hermes conversation.
  useEffect(() => {
    if (!api || conversationId !== null) return;
    const fromUrl = searchParams.get('conversation');
    if (fromUrl) {
      setConversationId(fromUrl);
      setRestored(true);
      return;
    }
    let cancelled = false;
    createConversation(api, { projectId: project.id, agent: project.agent, title })
      .then((conversation) => {
        if (!cancelled) {
          setConversationId(conversation.id);
          setTitle(conversation.title);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not start a conversation.');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, conversationId, project.id, searchParams]);

  const profile = useMemo(() => profileForProject(project.id), [project.id]);

  if (status !== 'ready') {
    return (
      <div className="flex h-dvh items-center justify-center bg-shell">
        <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
          F
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-shell">
      <header className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: project.tint }} aria-hidden />
        <b className="min-w-0 truncate text-[14px]">{title}</b>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/80">
          · profile {profile}
        </span>
        <span className="flex-1" />
        <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/80 sm:inline">
          {project.agent}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center px-6">
            <p className="max-w-[420px] rounded-xl border border-line bg-card px-4 py-3 text-[12.5px] leading-snug text-ink2">
              {error}
            </p>
          </div>
        ) : conversationId && api ? (
          <FrankChat
            api={api}
            conversationId={conversationId}
            profile={profile}
            restored={restored}
            agentLabel={project.isHome ? 'Frank' : project.agent}
            tint={project.tint}
            onTitleChange={setTitle}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="animate-pip h-4 w-4 rounded-full bg-running" aria-label="Starting chat" />
          </div>
        )}
      </div>
    </div>
  );
}
