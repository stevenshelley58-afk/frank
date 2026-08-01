import type { Metadata } from 'next';

import { FilesExplorer } from './files-explorer';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';

export const metadata: Metadata = {
  title: 'FRANK — Files',
  description:
    'Browse the Frank monorepo — skills, flows, projects, agents, prompts, docs, contracts, config. Read-only.',
};

export default function FilesConsolePage() {
  const module = moduleById('explorer');

  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1">
        <FilesExplorer />
      </div>
    </div>
  );
}
