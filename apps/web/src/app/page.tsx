'use client';

import { FrankShell } from '@/components/shell/frank-shell';

/**
 * FRANK — the chat-first shell.
 *
 * One conversation surface, a project rail beside it, and a living frame that
 * says what is blocked on you and what is running. Everything else the app can
 * do lives behind the console; this page is the thing you live in.
 */
export default function Home() {
  return <FrankShell />;
}
