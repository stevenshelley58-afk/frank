import Link from 'next/link';

import { ConsoleIcon } from './console-icon';
import { consoleGroups, consoleModules, type ConsoleGroup } from '../registry';

/**
 * A route-only map of the Console. It intentionally exposes no synthetic
 * aggregate status: each destination remains responsible for its own truth.
 */
export function ConsoleNavigation({ activeId = 'overview' }: { activeId?: string }) {
  return (
    <nav aria-label="Console modules" className="border-b border-line bg-rail px-4 py-4 lg:w-[232px] lg:shrink-0 lg:border-b-0 lg:border-r lg:px-3">
      <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-5 lg:overflow-visible">
        <Link
          href="/console"
          aria-current={activeId === 'overview' ? 'page' : undefined}
          className={`flex h-fit items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors hover:bg-hover lg:mb-5 ${
            activeId === 'overview' ? 'bg-subtle text-ink' : 'text-ink2 hover:text-ink'
          }`}
        >
          <ConsoleIcon name="grid" size={14} className="shrink-0 text-accent" />
          Overview
        </Link>
        {consoleGroups.map((group) => <NavigationGroup key={group} activeId={activeId} group={group} />)}
      </div>
    </nav>
  );
}

function NavigationGroup({ activeId, group }: { activeId: string; group: ConsoleGroup }) {
  const modules = consoleModules.filter((module) => module.group === group);
  if (modules.length === 0) return null;

  return (
    <section className="min-w-max lg:min-w-0">
      <h2 className="mb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted/75">
        {group}
      </h2>
      <ul className="flex gap-1 lg:block lg:space-y-0.5">
        {modules.map((module) => (
          <li key={module.id}>
            <Link
              href={`/console/${module.id}`}
              aria-current={activeId === module.id ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors hover:bg-hover hover:text-ink ${
                activeId === module.id ? 'bg-subtle text-ink' : 'text-ink2'
              }`}
            >
              <ConsoleIcon name={module.icon} size={14} className="shrink-0 text-muted" />
              <span>{module.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
