'use client';

/**
 * Stable import point for frank-shell: the assistant-ui host moved to
 * `components/chat/thread.tsx`, this file just re-exports it so the shell's
 * `import { ChatThread } from './chat-thread'` keeps working untouched.
 */
export { ChatThread } from '@/components/chat/thread';
export type { ChatThreadProps } from '@/components/chat/thread';
