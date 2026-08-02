import type { Metadata } from 'next';

import { MemoryConsole } from './memory-console';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const metadata: Metadata = {
  title: 'FRANK — Memory',
  description:
    'Review, edit, expire, and delete what Frank remembers — the memory-control surface (BRAIN-006).',
};

export default function MemoryConsolePage() {
  const module = moduleById('memory');

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1">
        <MemoryConsole />
      </div>
    </div>
  );
}
