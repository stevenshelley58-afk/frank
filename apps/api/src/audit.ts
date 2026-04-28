export interface AuditQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface AuditEvent {
  actorType: "system" | "user" | "worker" | "agent";
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  outcome?: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(db: AuditQueryable, event: AuditEvent): Promise<void> {
  await db.query(
    `
      insert into audit_log (
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        outcome,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      event.actorType,
      event.actorId ?? null,
      event.action,
      event.targetType,
      event.targetId ?? null,
      event.outcome ?? "success",
      JSON.stringify(event.metadata ?? {})
    ]
  );
}
