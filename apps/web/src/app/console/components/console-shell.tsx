'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { ConsoleHeader } from './console-header';
import { ConsoleNavigation } from './console-navigation';
import { moduleById } from '../registry';

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routeId = pathname.split('/')[2] ?? 'overview';
  const module = routeId === 'overview' ? undefined : moduleById(routeId);
  const activeId = module?.id ?? 'overview';

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ConsoleNavigation activeId={activeId} />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
