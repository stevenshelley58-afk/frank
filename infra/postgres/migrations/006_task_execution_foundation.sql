alter table tasks
  add column if not exists execution_kind text,
  add column if not exists queued_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

alter table agent_sessions
  add column if not exists worker_id text,
  add column if not exists lease_token text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists attempt integer not null default 0;

alter table task_events
  add column if not exists severity text not null default 'info',
  add column if not exists message text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_attempt_count_check'
  ) then
    alter table tasks
      add constraint tasks_attempt_count_check check (attempt_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_execution_kind_nonempty_check'
  ) then
    alter table tasks
      add constraint tasks_execution_kind_nonempty_check check (
        execution_kind is null or length(trim(execution_kind)) > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_sessions_attempt_check'
  ) then
    alter table agent_sessions
      add constraint agent_sessions_attempt_check check (attempt >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_sessions_worker_id_nonempty_check'
  ) then
    alter table agent_sessions
      add constraint agent_sessions_worker_id_nonempty_check check (
        worker_id is null or length(trim(worker_id)) > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_sessions_lease_token_nonempty_check'
  ) then
    alter table agent_sessions
      add constraint agent_sessions_lease_token_nonempty_check check (
        lease_token is null or length(trim(lease_token)) > 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'task_events_severity_check'
  ) then
    alter table task_events
      add constraint task_events_severity_check check (severity in ('debug', 'info', 'warn', 'error'));
  end if;
end $$;

create index if not exists tasks_queue_claim_idx
  on tasks (priority asc, queued_at asc nulls last, created_at asc)
  where state = 'queued';

create index if not exists tasks_execution_kind_idx
  on tasks (execution_kind)
  where execution_kind is not null;

create unique index if not exists agent_sessions_one_active_task_idx
  on agent_sessions (task_id)
  where task_id is not null
    and status = 'running'
    and ended_at is null;

create index if not exists agent_sessions_lease_expiry_idx
  on agent_sessions (lease_expires_at asc)
  where status = 'running'
    and ended_at is null
    and lease_expires_at is not null;

create index if not exists agent_sessions_worker_idx
  on agent_sessions (worker_id)
  where worker_id is not null;

create index if not exists task_events_severity_idx
  on task_events (severity);
