import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Server-runtime flags only. No credentials or configuration values cross this boundary. */
export function GET() {
  return NextResponse.json(
    { attachments: process.env.FRANK_ATTACHMENT_RUNTIME_ENABLED === 'true' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
