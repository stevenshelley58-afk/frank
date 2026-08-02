import type { Metadata } from 'next';
import { ConsoleHeader } from '../components/console-header';
import { moduleById } from '../registry';
import { TasksConsole } from './tasks-console';

export const metadata: Metadata = {
  title: 'FRANK — Tasks',
  description: 'Plane projects and the Google Tasks phone mirror.',
};

export default function TasksPage() {
  const module = moduleById('tasks')!;
  return (
    <div className="flex h-full flex-col">
      <ConsoleHeader module={module} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TasksConsole />
      </div>
    </div>
  );
}
