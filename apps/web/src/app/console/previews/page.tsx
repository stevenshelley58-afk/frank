import type { Metadata } from 'next';

import { PreviewsBrowser } from './previews-browser';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const metadata: Metadata = {
  title: 'FRANK — Previews',
  description:
    'Every hosted preview, versioned by topic. The review surface for all builds.',
};

export default function PreviewsConsolePage() {
  const module = moduleById('previews');

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1">
        <PreviewsBrowser />
      </div>
    </div>
  );
}
