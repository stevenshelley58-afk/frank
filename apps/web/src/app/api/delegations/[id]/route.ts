import { NextRequest } from 'next/server';
import { approve, reject, get } from '@/lib/delegation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { action: 'approve' | 'reject' } */
export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  const id = ctx.params.id;
  const body = await req.json().catch(() => null);
  const action = (body as { action?: string })?.action;

  if (!get(id)) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }

  const d = action === 'approve' ? approve(id) : action === 'reject' ? reject(id) : undefined;
  if (!d) {
    return new Response(JSON.stringify({ error: 'action must be approve or reject' }), {
      status: 400,
    });
  }
  return new Response(JSON.stringify({ id: d.id, status: d.status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
