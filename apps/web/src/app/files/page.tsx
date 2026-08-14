import { Suspense } from 'react';

import { FilesPageClient } from './files-page-client';

/**
 * /files — a read-only browser for the projects root (W3-1).
 *
 * The owner cannot use a terminal; this page is how he reads project files.
 * One GET /v1/files endpoint backs both halves of the UI: the tree lists
 * directories and the viewer shows file contents. Nothing here writes.
 */
export default function FilesPage() {
  return (
    <Suspense fallback={<FilesPageFallback />}>
      <FilesPageClient />
    </Suspense>
  );
}

function FilesPageFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-shell">
      <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
        F
      </span>
    </div>
  );
}
