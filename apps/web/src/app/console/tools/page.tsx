import type { Metadata } from 'next';

import { ToolsConsole } from './tools-console';

export const metadata: Metadata = { title: 'FRANK — Tools & Connectors', description: 'The real web-facing connector and tool surfaces available to Frank.' };

export default function ToolsPage() {
  return <div className="flex h-full flex-col"><div className="min-h-0 flex-1 overflow-y-auto"><ToolsConsole /></div></div>;
}
