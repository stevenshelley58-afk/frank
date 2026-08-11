import type { Metadata } from 'next';

import { FilesExplorer } from './files-explorer';

export const metadata: Metadata = {
  title: 'FRANK — Files',
  description:
    'Browse the Frank monorepo — skills, flows, projects, agents, prompts, docs, contracts, config. Read-only.',
};

export default function FilesConsolePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <FilesExplorer />
      </div>
    </div>
  );
}
