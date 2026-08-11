import { Suspense } from 'react';

import { FrankShell } from '@/components/shell/frank-shell';

/**
 * FRANK — the chat-first shell.
 *
 * One conversation surface, a project rail beside it, and a living frame that
 * says what is blocked on you and what is running. Everything else the app can
 * do lives behind the console; this page is the thing you live in.
 */
export default function Home() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <FrankShell />
    </Suspense>
  );
}

function ShellFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-shell">
      <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
        F
      </span>
    </div>
  );
}
