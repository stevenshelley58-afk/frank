import { domainApiFetch } from '@/lib/domain-api';

export interface MissionDomainResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

export async function missionDomainJson(
  path: string,
  init: { method: string; body?: unknown },
): Promise<MissionDomainResult> {
  let result = await domainApiFetch(path, init);
  // domainApiFetch clears an expired cached token on 401. Re-run once so the
  // existing domainApiToken helper can mint its replacement.
  if (result.status === 401) result = await domainApiFetch(path, init);
  return result;
}

export function missionDomainProblem(result: MissionDomainResult): Response {
  const unavailable = result.status === 503 && result.body === null;
  return Response.json(
    result.body ?? {
      error: unavailable ? 'domain_api_unavailable' : 'domain_api_error',
      detail: unavailable
        ? 'The FRANK Domain API could not be authenticated or reached.'
        : `The FRANK Domain API returned HTTP ${result.status}.`,
    },
    { status: result.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function isSameOriginMissionMutation(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  return origin === null || origin === new URL(request.url).origin;
}
