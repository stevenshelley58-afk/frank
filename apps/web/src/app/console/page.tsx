import type { Metadata } from 'next';
import Link from 'next/link';

import { ConsoleIcon } from './components/console-icon';
import { consoleGroups, consoleModules, type ConsoleGroup, type ConsoleModule } from './registry';

export const metadata: Metadata = {
  title: 'FRANK — Console',
  description: 'Look inside, configure, and debug every system Frank drives.',
};

const statusMeta: Record<ConsoleModule['status'], { label: string; dot: string; text: string }> = {
  live: { label: 'available', dot: 'bg-muted/60', text: 'text-muted' },
  wip: { label: 'in progress', dot: 'bg-accent', text: 'text-accent' },
  planned: { label: 'planned', dot: 'bg-muted/40', text: 'text-muted' },
};

function ModuleCard({ module }: { module: ConsoleModule }) {
  const status = statusMeta[module.status];
  const clickable = module.status !== 'planned';
  const contents = (
    <>
      <div className="flex items-start justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-subtle text-ink2">
          <ConsoleIcon name={module.icon} size={18} />
        </span>
        <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide ${status.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
      <div className="mt-3">
        <h3 className="text-[15px] font-semibold leading-tight text-ink">{module.title}</h3>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{module.description}</p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
          {module.system}
        </span>
        {clickable && <span className="ml-auto text-[12px] font-medium text-accent">Open →</span>}
      </div>
    </>
  );
  const className = 'group flex flex-col rounded-2xl border bg-card p-4 text-left transition-all duration-200';

  if (!clickable) return <div className={`${className} border-line opacity-60`}>{contents}</div>;
  return <Link href={`/console/${module.id}`} className={`${className} border-line hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_6px_20px_-12px_rgba(28,25,23,0.35)]`}>{contents}</Link>;
}

function ModuleGroup({ group }: { group: ConsoleGroup }) {
  const modules = consoleModules.filter((module) => module.group === group);
  const headingId = `console-group-${group.replaceAll(' ', '-').toLowerCase()}`;
  if (modules.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/80">
        {group}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => <ModuleCard key={module.id} module={module} />)}
      </div>
    </section>
  );
}

export default function ConsoleHome() {
  return (
    <div id="console-main" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6 lg:px-10 lg:py-10">
            <div className="mb-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Operations</p>
              <h1 className="mt-1 font-display text-2xl font-bold text-ink">Console</h1>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-muted">
                The engines do their work and hand back results. This is where you look inside,
                configure, and intervene — one module per system.
              </p>
            </div>
            <div className="space-y-9">
              {consoleGroups.map((group) => <ModuleGroup key={group} group={group} />)}
            </div>
      </div>
      </div>
  );
}
