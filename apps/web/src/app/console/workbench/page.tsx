import type { Metadata } from 'next';

import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { WorkbenchConsole } from './workbench-console';

export const metadata: Metadata = {
  title: 'FRANK — Workbench',
  description: "Frank's delegated runs — progress, live events, artifacts, receipts.",
};

export default function WorkbenchPage() {
  const module = moduleById('workbench')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkbenchConsole />
      </div>
    </div>
  );
}
