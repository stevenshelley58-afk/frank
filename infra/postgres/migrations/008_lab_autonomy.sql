create table if not exists self_upgrade_runs (
  id uuid primary key default gen_random_uuid(),
  goal text not null,
  status text not null,
  auto_deploy boolean not null default true,
  branch text not null,
  base_commit text,
  task_id uuid references tasks(id) on delete set null,
  runner_session_id uuid references runner_sessions(id) on delete set null,
  workspace_path text not null,
  backup_ids jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  validation_results jsonb not null default '{}'::jsonb,
  deploy_result jsonb not null default '{}'::jsonb,
  rollback_target jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint self_upgrade_runs_status_check check (
    status in ('queued', 'running', 'waiting_approval', 'deploying', 'completed', 'failed', 'cancelled', 'rolled_back')
  ),
  constraint self_upgrade_runs_workspace_not_root_check check (
    workspace_path <> '/' and workspace_path <> '/root'
  )
);

create index if not exists self_upgrade_runs_created_idx on self_upgrade_runs (created_at desc);
create index if not exists self_upgrade_runs_status_idx on self_upgrade_runs (status, created_at desc);
create index if not exists self_upgrade_runs_task_idx on self_upgrade_runs (task_id);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  workspace_path text not null,
  repo_remote text,
  backup_policy text not null default 'local_vps',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (status in ('active', 'paused', 'archived')),
  constraint projects_workspace_not_root_check check (
    workspace_path <> '/' and workspace_path <> '/root'
  )
);

create index if not exists projects_status_idx on projects (status, updated_at desc);
