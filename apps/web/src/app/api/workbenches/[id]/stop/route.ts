import { randomUUID } from 'node:crypto';

import {
  domainJson,
  domainProblem,
  domainUnavailable,
  isSameOriginMutation,
} from '@/lib/workbench/domain-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return Response.json(
      { error: 'forbidden', detail: 'Workbench mutations must be same-origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { reason?: unknown; command_id?: unknown }
    | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return Response.json(
      { error: 'validation_failed', detail: 'A stop reason is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const commandId =
    typeof body?.command_id === 'string' && body.command_id.trim() !== ''
      ? body.command_id.trim()
      : randomUUID();

  try {
    const { id } = await context.params;
    const result = await domainJson(
      `/v1/workbenches/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: { reason, command_id: commandId } },
    );
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return result.status === 503 && result.body === null
        ? domainUnavailable()
        : domainProblem(result);
    }
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error: 'domain_api_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
