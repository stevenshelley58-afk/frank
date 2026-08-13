import { Suspense } from 'react';

import { ChatPageClient } from './chat-client';

/**
 * /chat — the Hermes-backed chat surface (W2-2).
 *
 * A self-contained assistant-ui chat pointed at POST /v1/chat/turns,
 * independent of the frank-shell on the home page. Defaults to the `hub`
 * profile; pass ?project=<id> to talk to that project's profile.
 */
export default function ChatPage() {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <ChatPageClient />
    </Suspense>
  );
}

function ChatPageFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-shell">
      <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
        F
      </span>
    </div>
  );
}
