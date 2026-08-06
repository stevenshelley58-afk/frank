import type { Metadata } from 'next';

import { WorkbenchPreview } from './workbench-preview';

export const metadata: Metadata = {
  title: 'FRANK — Workbench preview (fixtures)',
  description: 'Workbench Running/detail surfaces against fixture data (no backend).',
};

export default function WorkbenchPreviewPage() {
  return (
    <div className="min-h-screen">
      <WorkbenchPreview />
    </div>
  );
}
