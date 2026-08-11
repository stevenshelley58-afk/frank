/**
 * Frank Console — module registry.
 *
 * The Console is the modular home for every "look inside / configure / debug"
 * flow. Each module is a folder under `app/console/<id>/`; this registry is
 * the single discovery map used by the launcher and navigation.
 */

export type ModuleStatus = 'live' | 'wip' | 'planned';

/** The Console's operator-facing map. These are discovery groupings, not health claims. */
export const consoleGroups = ['Operate', 'Knowledge', 'Runtime', 'Delivery', 'Project tools'] as const;
export type ConsoleGroup = (typeof consoleGroups)[number];

export type ConsoleModule = {
  id: string;
  title: string;
  description: string;
  /** icon key resolved by <ConsoleIcon /> */
  icon: 'grid' | 'chart' | 'bot' | 'brain' | 'tasks' | 'folder' | 'terminal' | 'channels' | 'skill' | 'plug';
  status: ModuleStatus;
  /** Discovery grouping used by the Console launcher and navigation. */
  group: ConsoleGroup;
  /** owning system, shown as a muted tag */
  system: string;
};

export const consoleModules: ConsoleModule[] = [
  {
    id: 'explorer',
    title: 'Repository Explorer',
    description: 'Browse the Frank monorepo like a file explorer — skills, flows, projects, agents, prompts, docs, contracts, config. Read-only; pin what matters.',
    icon: 'folder', status: 'live', group: 'Knowledge', system: 'Frank',
  },
  {
    id: 'adstudio',
    title: 'Ad Template Anatomy',
    description: 'Inspect every measured text and image region on a real template, simulate an edit, and see exactly why the layout never moves.',
    icon: 'grid', status: 'live', group: 'Project tools', system: 'Blockwise',
  },
  {
    id: 'research',
    title: 'Research Pipeline',
    description: 'Watch the Blockwise research pipeline run — stages, sources, and where a job stalls.',
    icon: 'chart', status: 'live', group: 'Operate', system: 'Blockwise',
  },
  {
    id: 'agent',
    title: 'Harness & Gateway',
    description: 'Live harness health, room routes, model drift, and gateway timing across every room.',
    icon: 'bot', status: 'live', group: 'Runtime', system: 'Frank',
  },
  {
    id: 'memory', title: 'Memory',
    description: 'Review, edit, expire, and delete what Frank remembers — the memory-control surface (BRAIN-006).',
    icon: 'brain', status: 'live', group: 'Knowledge', system: 'Frank',
  },
  {
    id: 'tasks', title: 'Tasks', description: 'Plane projects and the Google Tasks phone mirror, side by side.',
    icon: 'tasks', status: 'live', group: 'Operate', system: 'Frank',
  },
  {
    id: 'workbench', title: 'Workbench',
    description: 'Frank’s delegated runs — step-by-step progress, live event log, artifacts, receipts, and the leash stop.',
    icon: 'terminal', status: 'live', group: 'Operate', system: 'Frank',
  },
  {
    id: 'channels', title: 'Channels',
    description: 'Bind a room to its Telegram conversation and see the truthful binding health — active, revoked, or not bound. Frank stays authoritative if the channel is down.',
    icon: 'channels', status: 'live', group: 'Runtime', system: 'Frank',
  },
  {
    id: 'files', title: 'Room Files',
    description: 'A room’s folders and artifacts — folder bindings, sync direction, mount mode, write-back state, and every artifact with its preview.',
    icon: 'folder', status: 'live', group: 'Knowledge', system: 'Frank',
  },
  {
    id: 'graph', title: 'Code Graph', description: 'Explore the live structural graph for each registered codebase.',
    icon: 'chart', status: 'live', group: 'Knowledge', system: 'Frank',
  },
  {
    id: 'previews', title: 'Previews', description: 'Browse every hosted preview, grouped by topic and version.',
    icon: 'grid', status: 'live', group: 'Delivery', system: 'Frank',
  },
  {
    id: 'skills', title: 'Skills', description: 'Read the installed skill registry, its lifecycle, instructions, and linked references.',
    icon: 'skill', status: 'live', group: 'Knowledge', system: 'Frank',
  },
  {
    id: 'tools', title: 'Tools & Connectors', description: 'Inspect the real web-facing connectors and hand off to the owning Console modules.',
    icon: 'plug', status: 'live', group: 'Runtime', system: 'Frank',
  },
];

export function moduleById(id: string): ConsoleModule | undefined {
  return consoleModules.find((module) => module.id === id);
}
