import type { Metadata } from 'next';

import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { ChannelsConsole } from './channels-console';

export const metadata: Metadata = {
  title: 'FRANK — Channels',
  description:
    'Room↔platform bindings — bind or inspect a room’s Telegram conversation with truthful health.',
};

export default function ChannelsPage() {
  const module = moduleById('channels')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChannelsConsole />
      </div>
    </div>
  );
}
