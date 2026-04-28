create table if not exists agents (
  id text primary key,
  display_name text not null,
  description text not null default '',
  status text not null default 'available',
  model_role_id text references model_roles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_status_check check (status in ('available', 'disabled', 'planned'))
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  state text not null default 'draft',
  priority integer not null default 100,
  created_by text,
  assigned_agent_id text references agents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_state_check check (state in (
    'draft',
    'queued',
    'running',
    'blocked',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled'
  ))
);

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id text,
  from_state text,
  to_state text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_events_actor_type_check check (actor_type in ('system', 'user', 'worker', 'agent')),
  constraint task_events_from_state_check check (
    from_state is null or from_state in (
      'draft',
      'queued',
      'running',
      'blocked',
      'waiting_approval',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  constraint task_events_to_state_check check (
    to_state is null or to_state in (
      'draft',
      'queued',
      'running',
      'blocked',
      'waiting_approval',
      'completed',
      'failed',
      'cancelled'
    )
  )
);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  status text not null default 'idle',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint agent_sessions_status_check check (status in ('idle', 'running', 'blocked', 'completed', 'failed', 'cancelled'))
);

create table if not exists agent_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id) on delete cascade,
  permission_id text not null references permission_policies(id),
  level text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, permission_id),
  constraint agent_permissions_level_check check (level in ('denied', 'auto', 'auto_review', 'manual'))
);

create table if not exists tool_registry (
  id text primary key,
  display_name text not null,
  description text not null default '',
  risk text not null default 'read',
  permission_id text references permission_policies(id),
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_registry_risk_check check (risk in ('read', 'write', 'destructive', 'host'))
);

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  agent_id text references agents(id) on delete set null,
  tool_id text references tool_registry(id) on delete set null,
  status text not null default 'queued',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint tool_calls_status_check check (status in (
    'queued',
    'running',
    'blocked',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled'
  ))
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  tool_call_id uuid references tool_calls(id) on delete set null,
  requested_by_agent_id text references agents(id) on delete set null,
  status text not null default 'pending',
  requested_action text not null,
  reason text,
  decided_by text,
  decided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approvals_status_check check (status in ('pending', 'approved', 'denied', 'cancelled', 'expired'))
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  type text not null,
  title text not null,
  body text,
  status text not null default 'unread',
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_status_check check (status in ('unread', 'read', 'archived'))
);

create index if not exists agents_status_idx on agents (status);
create index if not exists agents_model_role_idx on agents (model_role_id);
create index if not exists tasks_state_idx on tasks (state);
create index if not exists tasks_assigned_agent_idx on tasks (assigned_agent_id);
create index if not exists tasks_created_at_idx on tasks (created_at desc);
create index if not exists task_events_task_idx on task_events (task_id, created_at desc);
create index if not exists task_events_type_idx on task_events (event_type);
create index if not exists agent_sessions_agent_idx on agent_sessions (agent_id);
create index if not exists agent_sessions_task_idx on agent_sessions (task_id);
create index if not exists agent_permissions_agent_idx on agent_permissions (agent_id);
create index if not exists tool_registry_permission_idx on tool_registry (permission_id);
create index if not exists tool_calls_task_idx on tool_calls (task_id);
create index if not exists tool_calls_agent_idx on tool_calls (agent_id);
create index if not exists tool_calls_status_idx on tool_calls (status);
create index if not exists approvals_status_idx on approvals (status);
create index if not exists approvals_task_idx on approvals (task_id);
create index if not exists notifications_status_idx on notifications (status);
create index if not exists notifications_task_idx on notifications (task_id);

with seed_agents (id, display_name, description, model_role_id, metadata) as (
  values
    ('frank', 'Frank', 'Primary Frank Hub coordinator for dashboard-first work.', 'router_fast', '{"foundation":true,"stage":2}'::jsonb),
    ('coding', 'Coding', 'Coding and code review task agent surface.', 'coding_heavy', '{"foundation":true,"stage":2}'::jsonb),
    ('research', 'Research', 'Research synthesis and source-grounded analysis agent surface.', 'research_deep', '{"foundation":true,"stage":2}'::jsonb),
    ('ops', 'Ops', 'Operational review agent surface for approval-gated actions.', 'approval_reviewer', '{"foundation":true,"stage":2}'::jsonb),
    ('memory', 'Memory', 'Durable memory extraction and project context agent surface.', 'memory_extractor', '{"foundation":true,"stage":2}'::jsonb),
    ('content', 'Content', 'Content drafting and project-context summarization agent surface.', 'project_context_summarizer', '{"foundation":true,"stage":2}'::jsonb),
    ('image', 'Image', 'Image workflow planning surface without image-generation runtime wiring.', 'image_prompting', '{"foundation":true,"stage":2,"runtime":"disabled"}'::jsonb),
    ('scraping', 'Scraping', 'Scraping extraction planning surface without crawler runtime wiring.', 'scraping_extraction', '{"foundation":true,"stage":2,"runtime":"disabled"}'::jsonb)
),
upserted as (
  insert into agents (id, display_name, description, model_role_id, metadata)
  select id, display_name, description, model_role_id, metadata
  from seed_agents
  on conflict (id) do update set
    display_name = excluded.display_name,
    description = excluded.description,
    model_role_id = excluded.model_role_id,
    metadata = agents.metadata || excluded.metadata,
    updated_at = now()
  where agents.display_name is distinct from excluded.display_name
    or agents.description is distinct from excluded.description
    or agents.model_role_id is distinct from excluded.model_role_id
    or agents.metadata is distinct from agents.metadata || excluded.metadata
  returning id
)
insert into audit_log (
  actor_type,
  actor_id,
  action,
  target_type,
  target_id,
  outcome,
  metadata
)
select
  'system',
  'migration',
  'agent.seed',
  'agent',
  'foundation',
  'success',
  jsonb_build_object('agent_ids', jsonb_agg(id order by id), 'count', count(*))
from upserted
having count(*) > 0;
