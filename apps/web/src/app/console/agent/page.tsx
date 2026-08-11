import type { Metadata } from 'next';

import { AgentConsole } from './agent-console';

export const metadata: Metadata = {
  title: 'FRANK — Harness & Gateway',
  description: 'Live harness health, canonical room routes, and provider/model drift.',
};

export default function AgentPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentConsole />
      </div>
    </div>
  );
}
