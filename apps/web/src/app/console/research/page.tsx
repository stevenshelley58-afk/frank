import type { Metadata } from 'next';
import { ResearchConsole } from './research-console';

export const metadata: Metadata = {
  title: 'FRANK — Research Pipeline',
  description: 'Blockwise research pipeline stages, health, and jobs.',
};

export default function ResearchPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ResearchConsole />
      </div>
    </div>
  );
}
