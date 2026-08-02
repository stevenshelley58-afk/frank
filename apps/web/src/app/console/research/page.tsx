import type { Metadata } from 'next';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { ResearchConsole } from './research-console';

export const metadata: Metadata = {
  title: 'FRANK — Research Pipeline',
  description: 'Blockwise research pipeline stages, health, and jobs.',
};

export default function ResearchPage() {
  const module = moduleById('research')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ResearchConsole />
      </div>
    </div>
  );
}
