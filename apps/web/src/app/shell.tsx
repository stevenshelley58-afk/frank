'use client';

import type { ReactNode } from 'react';
import { AuthProvider, DataProvider, ToastProvider } from '@/components/providers';

/**
 * App shell — providers and the full-height stage. Light, minimal, no grain.
 * The room renders immediately; auth failures surface inline (see
 * AuthErrorCard in the room view).
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <DataProvider>
          <div className="relative h-dvh bg-shell">{children}</div>
        </DataProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
