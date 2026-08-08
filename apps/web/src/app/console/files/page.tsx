import type { Metadata } from 'next';

import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { FilesConsole } from './files-console';

export const metadata: Metadata = {
  title: 'FRANK — Files',
  description:
    'A room’s folders and artifacts — folder bindings, sync direction, mount mode, write-back state, previews.',
};

export default function FilesPage() {
  const module = moduleById('files')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FilesConsole />
      </div>
    </div>
  );
}
