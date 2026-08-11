import Link from 'next/link';

import { ConsoleIcon } from './console-icon';
import type { ConsoleModule } from '../registry';

/**
 * Console chrome — slim top bar shared by the launcher and every module.
 * On a module page it shows a breadcrumb back to the launcher; on the
 * launcher it shows the console identity.
 */
export function ConsoleHeader({ module }: { module?: ConsoleModule }) {
  const backHref = module ? '/console' : '/';
  const backLabel = module ? 'Back to Console' : 'Back to Frank';

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-rail px-4">
      <Link
        href={backHref}
        className="grid h-7 w-7 place-items-center rounded-[8px] text-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label={backLabel}
      >
        <ConsoleIcon name="arrow" size={16} />
      </Link>

      <span className="font-display text-[13px] font-bold tracking-[0.16em] text-ink">
        CONSOLE
      </span>

      {module && (
        <>
          <span className="text-muted/50">/</span>
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink2">
            <ConsoleIcon name={module.icon} size={14} className="text-accent" />
            {module.title}
          </span>
          <span className="ml-auto rounded-full border border-line bg-subtle px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
            {module.system}
          </span>
        </>
      )}
    </header>
  );
}
