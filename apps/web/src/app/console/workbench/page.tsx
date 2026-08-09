import type { Metadata } from 'next';

import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { WorkbenchConsole } from './workbench-console';

export const metadata: Metadata = {
  title: 'FRANK — Workbench',
  description: "Frank's delegated runs — progress, live events, artifacts, receipts.",
};

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams?: Promise<{
    roomId?: string | string[];
    workbenchId?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const module = moduleById('workbench')!;
  const roomParam = Array.isArray(resolvedSearchParams?.roomId)
    ? resolvedSearchParams.roomId[0]
    : resolvedSearchParams?.roomId;
  const workbenchParam = Array.isArray(resolvedSearchParams?.workbenchId)
    ? resolvedSearchParams.workbenchId[0]
    : resolvedSearchParams?.workbenchId;
  const initialRoomId = roomParam?.trim() || 'central';
  const initialWorkbenchId = workbenchParam?.trim() || null;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkbenchConsole
          initialRoomId={initialRoomId}
          initialWorkbenchId={initialWorkbenchId}
        />
      </div>
    </div>
  );
}
