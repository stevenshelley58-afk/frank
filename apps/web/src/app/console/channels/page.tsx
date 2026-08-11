import type { Metadata } from 'next';

import { ChannelsConsole } from './channels-console';

export const metadata: Metadata = {
  title: 'FRANK — Channels',
  description:
    'Room↔platform bindings — bind or inspect a room’s Telegram conversation with truthful health.',
};

export default function ChannelsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChannelsConsole />
      </div>
    </div>
  );
}
