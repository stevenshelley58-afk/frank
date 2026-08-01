import type { Metadata } from 'next';

import { AdAnatomy } from './AdAnatomy';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const metadata: Metadata = {
  title: 'FRANK — Ad Template Anatomy',
  description:
    'Inspect measured regions on a real Blockwise ad template and simulate an edit.',
};

export default function AdstudioConsolePage() {
  const module = moduleById('adstudio');

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1">
        <AdAnatomy />
      </div>
    </div>
  );
}
