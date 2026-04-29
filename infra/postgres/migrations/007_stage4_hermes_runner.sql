create table if not exists runners (
  id text primary key,
  type text not null,
  display_name text not null,
  status text not null default 'disabled',
  config_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runners_status_check check (status in ('disabled', 'not_configured', 'available', 'unavailable'))
);

insert into runners (id, type, display_name, status, config_summary)
values ('hermes', 'hermes', 'Hermes Operator', 'disabled', '{}'::jsonb)
on conflict (id) do update
set
  type = excluded.type,
  display_name = excluded.display_name,
  updated_at = now()
where runners.type is distinct from excluded.type
  or runners.display_name is distinct from excluded.display_name;

create table if not exists runner_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  runner_id text not null references runners(id),
  hermes_run_id text,
  conversation_id text,
  workspace_path text,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  last_event_at timestamptz,
  exit_code integer,
  error_summary text,
  final_output text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runner_sessions_status_check check (
    status in ('queued', 'starting', 'running', 'stopping', 'completed', 'failed', 'cancelled', 'blocked')
  ),
  constraint runner_sessions_workspace_not_root_check check (
    workspace_path is null or (workspace_path <> '/' and workspace_path <> '/root')
  )
);

create unique index if not exists runner_sessions_one_active_hermes_per_task_idx
on runner_sessions (task_id)
where runner_id = 'hermes'
  and task_id is not null
  and status in ('queued', 'starting', 'running', 'stopping');

create index if not exists runner_sessions_task_idx on runner_sessions (task_id, created_at desc);
create index if not exists runner_sessions_status_idx on runner_sessions (runner_id, status, updated_at desc);
create index if not exists runner_sessions_hermes_run_idx on runner_sessions (hermes_run_id);

create table if not exists runner_events (
  id uuid primary key default gen_random_uuid(),
  runner_session_id uuid not null references runner_sessions(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  source text not null,
  event_type text not null,
  severity text not null,
  message text not null,
  raw_event jsonb,
  sequence bigint not null,
  created_at timestamptz not null default now(),
  constraint runner_events_source_check check (source in ('frank', 'hermes', 'system')),
  constraint runner_events_severity_check check (severity in ('info', 'warning', 'error', 'success')),
  constraint runner_events_sequence_check check (sequence > 0)
);

create unique index if not exists runner_events_session_sequence_idx
on runner_events (runner_session_id, sequence);

create index if not exists runner_events_task_idx on runner_events (task_id, created_at asc);
create index if not exists runner_events_session_created_idx on runner_events (runner_session_id, created_at asc);

create table if not exists runner_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  runner_session_id uuid references runner_sessions(id) on delete cascade,
  artifact_type text not null,
  name text not null,
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint runner_artifacts_size_check check (size_bytes >= 0)
);

create index if not exists runner_artifacts_task_idx on runner_artifacts (task_id, created_at desc);
create index if not exists runner_artifacts_session_idx on runner_artifacts (runner_session_id, created_at desc);

create table if not exists runner_stop_requests (
  id uuid primary key default gen_random_uuid(),
  runner_session_id uuid not null references runner_sessions(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  requested_by text,
  reason text not null,
  status text not null default 'requested',
  method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runner_stop_requests_status_check check (status in ('requested', 'attempted', 'succeeded', 'failed')),
  constraint runner_stop_requests_method_check check (
    method is null or method in ('api', 'process', 'container', 'frank_only', 'unavailable')
  )
);

create index if not exists runner_stop_requests_session_idx on runner_stop_requests (runner_session_id, created_at desc);

create table if not exists backup_runs (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null,
  status text not null,
  path text,
  size_bytes bigint,
  branch text,
  commit text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint backup_runs_type_check check (backup_type in ('postgres', 'files', 'preflight')),
  constraint backup_runs_status_check check (status in ('running', 'completed', 'failed')),
  constraint backup_runs_size_check check (size_bytes is null or size_bytes >= 0)
);

create index if not exists backup_runs_created_idx on backup_runs (created_at desc);
create index if not exists backup_runs_status_idx on backup_runs (backup_type, status, created_at desc);

create table if not exists kill_switch_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  reason text not null,
  affected_sessions jsonb not null default '[]'::jsonb,
  outcome text not null,
  created_at timestamptz not null default now()
);

create index if not exists kill_switch_events_created_idx on kill_switch_events (created_at desc);
