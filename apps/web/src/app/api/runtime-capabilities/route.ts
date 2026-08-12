import { NextResponse } from 'next/server';
import { domainApiBase } from '@/lib/domain-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Server-runtime flags only. No credentials or configuration values cross this boundary. */
export async function GET() {
  let attachments = false;
  try {
    const response = await fetch(`${domainApiBase()}/v1/openapi.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const document = (await response.json()) as { paths?: Record<string, unknown> };
      attachments = Object.hasOwn(document.paths ?? {}, '/v1/attachments/uploads');
    }
  } catch {
    // A capability that cannot be proven stays hidden.
  }
  return NextResponse.json({ attachments }, { headers: { 'cache-control': 'no-store' } });
}
