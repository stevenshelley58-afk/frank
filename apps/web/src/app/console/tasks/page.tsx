import type { Metadata } from 'next';
import { TasksConsole } from './tasks-console';

export const metadata: Metadata = {
  title: 'FRANK — Tasks',
  description: 'Plane projects and the Google Tasks phone mirror.',
};

export default function TasksPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TasksConsole />
      </div>
    </div>
  );
}
