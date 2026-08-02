import type { Metadata } from 'next';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { AgentConsole } from './agent-console';

export const metadata: Metadata = {
  title: 'FRANK — Agent Runtime',
  description: 'Goose run-state, sessions, and provider/model swaps.',
};

export default function AgentPage() {
  const module = moduleById('agent')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentConsole />
      </div>
    </div>
  );
}
