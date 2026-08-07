/**
 * Frank Console — module registry.
 *
 * The Console is the modular home for every "look inside / configure / debug
 * one of my systems" flow. Each module is a folder under `app/console/<id>/`
 * with its own `page.tsx`; this registry is the single list the launcher reads.
 *
 * Adding a module:
 *   1. create `app/console/<id>/page.tsx`
 *   2. add one entry here.
 * That's it — the launcher grid and breadcrumbs pick it up automatically.
 *
 * Boundary this surface enforces: the engines (Blockwise, research, Goose…)
 * do their work and hand back results; everything that lets a human
 * understand, configure, or intervene lives HERE, as modules.
 */

export type ModuleStatus = 'live' | 'wip' | 'planned';

export type ConsoleModule = {
  id: string;
  title: string;
  description: string;
  /** icon key resolved by <ConsoleIcon /> */
  icon: 'grid' | 'chart' | 'bot' | 'brain' | 'tasks' | 'folder' | 'terminal' | 'channels';
  status: ModuleStatus;
  /** owning system, shown as a muted tag */
  system: string;
};

export const consoleModules: ConsoleModule[] = [
  {
    id: 'explorer',
    title: 'Files',
    description:
      'Browse the Frank monorepo like a file explorer — skills, flows, projects, agents, prompts, docs, contracts, config. Read-only; pin what matters.',
    icon: 'folder',
    status: 'live',
    system: 'Frank',
  },
  {
    id: 'adstudio',
    title: 'Ad Template Anatomy',
    description:
      'Inspect every measured text and image region on a real template, simulate an edit, and see exactly why the layout never moves.',
    icon: 'grid',
    status: 'live',
    system: 'Blockwise',
  },
  {
    id: 'research',
    title: 'Research Pipeline',
    description:
      'Watch the Blockwise research pipeline run — stages, sources, and where a job stalls.',
    icon: 'chart',
    status: 'live',
    system: 'Blockwise',
  },
  {
    id: 'agent',
    title: 'Agent Runtime',
    description:
      'Goose run-state, sessions, and provider/model swaps across central and mini-Franks.',
    icon: 'bot',
    status: 'live',
    system: 'Frank',
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'Review, edit, expire, and delete what Frank remembers — the memory-control surface (BRAIN-006).',
    icon: 'brain',
    status: 'live',
    system: 'Frank',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Plane projects and the Google Tasks phone mirror, side by side.',
    icon: 'tasks',
    status: 'live',
    system: 'Frank',
  },
  {
    id: 'workbench',
    title: 'Workbench',
    description:
      'Frank’s delegated runs — step-by-step progress, live event log, artifacts, receipts, and the leash stop.',
    icon: 'terminal',
    status: 'live',
    system: 'Frank',
  },
  {
    id: 'channels',
    title: 'Channels',
    description:
      'Bind a room to its Telegram conversation and see the truthful binding health — active, revoked, or not bound. Frank stays authoritative if the channel is down.',
    icon: 'channels',
    status: 'live',
    system: 'Frank',
  },
];

export function moduleById(id: string): ConsoleModule | undefined {
  return consoleModules.find((m) => m.id === id);
}
