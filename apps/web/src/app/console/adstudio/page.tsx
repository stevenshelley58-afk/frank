import type { Metadata } from 'next';

import { AdStudioConsole } from './adstudio-console';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const metadata: Metadata = {
  title: 'FRANK — AdStudio Pipeline',
  description:
    'Trace how a Blockwise ad template goes from source ad to customer-editable regions — and drill into any stage.',
};

export default function AdstudioConsolePage() {
  const module = moduleById('adstudio');

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1">
        <AdStudioConsole />
      </div>
    </div>
  );
}
