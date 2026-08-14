import { Suspense } from 'react';

import { SkillsPageClient } from './skills-client';

/**
 * /skills — every skill the running Hermes can see (W3-2).
 *
 * A read-only browser over the Hermes skill library: name + description per
 * skill, rendered markdown on selection. Standalone app-router page like
 * /chat; the frank-shell rail links here.
 */
export default function SkillsPage() {
  return (
    <Suspense fallback={<SkillsPageFallback />}>
      <SkillsPageClient />
    </Suspense>
  );
}

function SkillsPageFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-shell">
      <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
        F
      </span>
    </div>
  );
}
