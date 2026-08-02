/**
 * GET /api/research-health — proxy to Blockwise's research health endpoint.
 * The Console reads pipeline status read-only; this keeps the browser
 * same-origin and avoids CORS / credential leakage.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = process.env.BLOCKWISE_URL ?? 'https://blockwise.vercel.app';

export async function GET() {
  try {
    const res = await fetch(`${UPSTREAM}/api/health/research`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'frank-console/1.0' },
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(
      body ?? { app: 'blockwise', service: 'research', status: 'unknown' },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { app: 'blockwise', service: 'research', status: 'unreachable', error: String(err) },
      { status: 502 },
    );
  }
}
