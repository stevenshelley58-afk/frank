create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_log_outcome_check check (outcome in ('success', 'failure', 'denied'))
);

create index if not exists audit_log_occurred_at_idx on audit_log (occurred_at desc);
create index if not exists audit_log_action_idx on audit_log (action);
create index if not exists audit_log_actor_idx on audit_log (actor_type, actor_id);
