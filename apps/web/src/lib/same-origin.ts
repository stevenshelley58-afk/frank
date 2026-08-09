function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(',', 1)[0]?.trim();
  return first ? first : null;
}

/**
 * Resolve the browser-visible origin when Next.js is behind the production
 * reverse proxy. `request.url` contains the private container origin there,
 * while Caddy preserves the public scheme and host in forwarded headers.
 */
export function requestPublicOrigin(request: Request): string {
  const internalUrl = new URL(request.url);
  const host =
    firstForwardedValue(request.headers.get('x-forwarded-host')) ??
    firstForwardedValue(request.headers.get('host'));
  const forwardedProto = firstForwardedValue(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProto?.replace(/:$/, '') ?? internalUrl.protocol.replace(/:$/, '');

  if (host === null || (protocol !== 'http' && protocol !== 'https')) {
    return internalUrl.origin;
  }

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return internalUrl.origin;
  }
}

/** Reject browser cross-site mutations while allowing non-browser callers. */
export function isSameOriginMutation(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;

  const origin = request.headers.get('origin');
  if (origin === null) return true;

  try {
    return new URL(origin).origin === requestPublicOrigin(request);
  } catch {
    return false;
  }
}
