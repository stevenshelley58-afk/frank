create table if not exists ai_tool_sessions (
  id uuid primary key default gen_random_uuid(),
  tool text not null,
  host_session_id text not null,
  session_name text not null,
  workspace_path text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stopped_at timestamptz,
  constraint ai_tool_sessions_tool_check check (tool in ('codex', 'claude_code')),
  constraint ai_tool_sessions_status_check check (status in ('running', 'stopped', 'failed')),
  constraint ai_tool_sessions_workspace_not_root_check check (workspace_path <> '/' and workspace_path <> '/root')
);

create index if not exists ai_tool_sessions_status_idx on ai_tool_sessions (status, updated_at desc);
create index if not exists ai_tool_sessions_tool_idx on ai_tool_sessions (tool, updated_at desc);

create table if not exists ai_session_events (
  id uuid primary key default gen_random_uuid(),
  ai_session_id uuid references ai_tool_sessions(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_session_events_severity_check check (severity in ('info', 'warning', 'error', 'success'))
);

create index if not exists ai_session_events_session_idx on ai_session_events (ai_session_id, created_at asc);

create table if not exists ai_handoffs (
  id uuid primary key default gen_random_uuid(),
  target_tool text not null,
  title text not null,
  summary text not null,
  workspace_path text not null,
  prompt text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_handoffs_target_tool_check check (target_tool in ('codex', 'claude_code')),
  constraint ai_handoffs_workspace_not_root_check check (workspace_path <> '/' and workspace_path <> '/root')
);

create index if not exists ai_handoffs_created_idx on ai_handoffs (created_at desc);
