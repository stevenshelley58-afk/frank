import type { Metadata } from 'next';

import { MemoryConsole } from './memory-console';

export const metadata: Metadata = {
  title: 'FRANK — Memory',
  description:
    'Review, edit, expire, and delete what Frank remembers — the memory-control surface (BRAIN-006).',
};

export default function MemoryConsolePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <MemoryConsole />
      </div>
    </div>
  );
}
