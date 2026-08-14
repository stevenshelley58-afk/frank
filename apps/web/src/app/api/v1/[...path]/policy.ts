import { requestPublicOrigin } from '@/lib/same-origin';

type AllowedOperation = { method: string; path: RegExp };

const CODEGRAPH_PROJECT_SEGMENT = '[a-z][a-z0-9-]{0,62}';
const CODEGRAPH_JOB_SEGMENT = '[a-f0-9]{32}';
const CODEGRAPH_PROJECT_READ = new RegExp(
  `^/v1/codegraph/${CODEGRAPH_PROJECT_SEGMENT}/(?:spec|status|overview)$`,
);
const CODEGRAPH_JOB_READ = new RegExp(
  `^/v1/codegraph/${CODEGRAPH_PROJECT_SEGMENT}/jobs/${CODEGRAPH_JOB_SEGMENT}$`,
);
const CODEGRAPH_REFRESH = new RegExp(
  `^/v1/codegraph/${CODEGRAPH_PROJECT_SEGMENT}/refresh$`,
);

// The service token is intentionally never a general browser credential.
const ALLOWED_OPERATIONS: readonly AllowedOperation[] = [
  { method: 'GET', path: /^\/v1\/(?:today|work|frame|chats)$/ },
  { method: 'GET', path: /^\/v1\/chats\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/chats$/ },
  { method: 'PATCH', path: /^\/v1\/chats\/[^/]+$/ },
  { method: 'GET', path: /^\/v1\/chats\/[^/]+\/messages$/ },
  { method: 'POST', path: /^\/v1\/chats\/[^/]+\/messages$/ },
  { method: 'POST', path: /^\/v1\/chat\/turns$/ },
  { method: 'GET', path: /^\/v1\/chat\/turns\/[^/]+(?:\/events)?$/ },
  { method: 'POST', path: /^\/v1\/chat\/turns\/[^/]+\/cancel$/ },
  { method: 'POST', path: /^\/v1\/attachments\/uploads$/ },
  { method: 'GET', path: /^\/v1\/attachments\/uploads\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/attachments\/uploads\/[^/]+\/capability$/ },
  { method: 'DELETE', path: /^\/v1\/attachments\/uploads\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/work\/[^/]+\/commands\/(?:start|pause|resume|ready|complete|cancel|approve|decline)$/ },
  { method: 'GET', path: /^\/v1\/codegraph\/projects$/ },
  { method: 'GET', path: CODEGRAPH_PROJECT_READ },
  { method: 'GET', path: CODEGRAPH_JOB_READ },
  { method: 'POST', path: CODEGRAPH_REFRESH },
  // W3-1: read-only project file browser.
  { method: 'GET', path: /^\/v1\/files$/ },
  // W3-2: skills page (list + detail).
  { method: 'GET', path: /^\/v1\/skills$/ },
  { method: 'GET', path: /^\/v1\/skills\/[^/]+$/ },
];

export function isAllowedBrowserOperation(method: string, pathname: string): boolean {
  return ALLOWED_OPERATIONS.some((operation) => operation.method === method && operation.path.test(pathname));
}

/** Strict provenance for service-token mutations; absent browser headers fail. */
export function hasStrictBrowserMutationProvenance(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    try {
      if (new URL(origin).origin === requestPublicOrigin(request)) return true;
    } catch {
      // An invalid Origin cannot establish provenance; Sec-Fetch may still.
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
