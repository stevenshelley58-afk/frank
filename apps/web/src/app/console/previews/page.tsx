import type { Metadata } from 'next';

import { PreviewsBrowser } from './previews-browser';

export const metadata: Metadata = {
  title: 'FRANK — Previews',
  description:
    'Every hosted preview, versioned by topic. The review surface for all builds.',
};

export default function PreviewsConsolePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <PreviewsBrowser />
      </div>
    </div>
  );
}
