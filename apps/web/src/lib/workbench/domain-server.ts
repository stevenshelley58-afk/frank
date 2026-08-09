/**
 * Server-only access to the FRANK Domain API for the same-origin Workbench
 * BFF. Browser code never receives the bearer token; JSON calls use the
 * existing domain client and SSE calls attach the token as an upstream
 * Authorization header.
 */

import {
  domainApiBase,
  domainApiFetch,
  domainApiToken,
  dropDomainApiToken,
} from '@/lib/domain-api';
import { isSameOriginMutation as validateSameOriginMutation } from '@/lib/same-origin';

export interface DomainJsonResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

export async function domainJson(
  path: string,
  init: { method: string; body?: unknown },
): Promise<DomainJsonResult> {
  let result = await domainApiFetch(path, init);
  // domainApiFetch drops the cached token on 401. Retry once so a BFF call
  // that straddles token expiry is transparent to the browser.
  if (result.status === 401) result = await domainApiFetch(path, init);
  return result;
}

export async function domainEventStream(
  path: string,
  input: {
    readonly lastEventId?: string;
    readonly signal?: AbortSignal;
  },
): Promise<Response | null> {
  const run = async (token: string): Promise<Response> => {
    const url = new URL(`${domainApiBase()}${path}`);
    if (input.lastEventId !== undefined) {
      url.searchParams.set('lastEventId', input.lastEventId);
    }
    return fetch(url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
        ...(input.lastEventId === undefined
          ? {}
          : { 'last-event-id': input.lastEventId }),
      },
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  };

  let token = await domainApiToken();
  if (token === null) return null;
  let response = await run(token);
  if (response.status !== 401) return response;

  await response.body?.cancel().catch(() => undefined);
  dropDomainApiToken();
  token = await domainApiToken();
  if (token === null) return null;
  response = await run(token);
  return response;
}

export function domainUnavailable(): Response {
  return Response.json(
    {
      error: 'domain_api_unavailable',
      detail: 'The FRANK Domain API could not be authenticated or reached.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function domainProblem(result: DomainJsonResult): Response {
  return Response.json(
    result.body ?? {
      error: 'domain_api_error',
      detail: `The FRANK Domain API returned HTTP ${result.status}.`,
    },
    { status: result.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Reject browser cross-site mutation attempts while allowing non-browser callers. */
export function isSameOriginMutation(request: Request): boolean {
  return validateSameOriginMutation(request);
}
