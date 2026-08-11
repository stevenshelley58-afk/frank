import { requestPublicOrigin } from '@/lib/same-origin';

type AllowedOperation = { method: string; path: RegExp };

// The service token is intentionally never a general browser credential.
const ALLOWED_OPERATIONS: readonly AllowedOperation[] = [
  { method: 'GET', path: /^\/v1\/(?:today|work|frame|missions|chats)$/ },
  { method: 'GET', path: /^\/v1\/(?:missions|chats)\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/chats$/ },
  { method: 'PATCH', path: /^\/v1\/chats\/[^/]+$/ },
  { method: 'GET', path: /^\/v1\/chats\/[^/]+\/messages$/ },
  { method: 'POST', path: /^\/v1\/chats\/[^/]+\/messages$/ },
  { method: 'POST', path: /^\/v1\/work\/[^/]+\/commands\/(?:start|pause|resume|ready|complete|cancel|approve|decline)$/ },
  { method: 'GET', path: /^\/v1\/rooms\/[^/]+\/(?:folder-bindings|files|channel-bindings)$/ },
  { method: 'POST', path: /^\/v1\/rooms\/[^/]+\/(?:folder-bindings|channel-bindings)$/ },
  { method: 'DELETE', path: /^\/v1\/rooms\/[^/]+\/(?:folder-bindings|channel-bindings)\/[^/]+$/ },
  { method: 'POST', path: /^\/v1\/workbenches\/[^/]+\/artifacts\/[^/]+\/preview$/ },
  { method: 'GET', path: /^\/v1\/codegraph\/projects$/ },
  { method: 'GET', path: /^\/v1\/codegraph\/[^/]+\/(?:spec|status)$/ },
  { method: 'POST', path: /^\/v1\/codegraph\/[^/]+\/refresh$/ },
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
