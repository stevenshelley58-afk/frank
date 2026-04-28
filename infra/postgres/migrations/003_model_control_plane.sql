create table if not exists provider_registry (
  id text primary key,
  display_name text not null,
  status text not null default 'stubbed',
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_registry_status_check check (status in ('stubbed', 'not_configured', 'healthy', 'degraded', 'unavailable'))
);

create table if not exists capability_registry (
  id text primary key,
  description text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists model_catalog (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references provider_registry(id),
  model_key text not null,
  display_name text not null,
  capabilities text[] not null default '{}',
  status text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_key),
  constraint model_catalog_status_check check (status in ('unknown', 'available', 'disabled', 'deprecated'))
);

create table if not exists model_roles (
  id text primary key,
  description text not null,
  required_capabilities text[] not null default '{}',
  default_budget_tier text not null default 'standard',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_roles_budget_check check (default_budget_tier in ('low', 'standard', 'high'))
);

create table if not exists model_routing_rules (
  id uuid primary key default gen_random_uuid(),
  role_id text not null references model_roles(id),
  priority integer not null default 100,
  provider_id text references provider_registry(id),
  model_id uuid references model_catalog(id),
  routing_mode text not null default 'fallback',
  conditions jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint model_routing_rules_mode_check check (routing_mode in ('fallback', 'pin', 'budget', 'health'))
);

create table if not exists model_fallback_chain (
  id uuid primary key default gen_random_uuid(),
  role_id text not null references model_roles(id),
  chain_order integer not null,
  provider_id text not null references provider_registry(id),
  model_id uuid references model_catalog(id),
  reason text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (role_id, chain_order)
);

create table if not exists model_usage (
  id uuid primary key default gen_random_uuid(),
  role_id text references model_roles(id),
  provider_id text references provider_registry(id),
  model_id uuid references model_catalog(id),
  request_id text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists model_usage_occurred_at_idx on model_usage (occurred_at desc);
create index if not exists model_usage_role_idx on model_usage (role_id);

create table if not exists model_budget_rules (
  id uuid primary key default gen_random_uuid(),
  role_id text references model_roles(id),
  provider_id text references provider_registry(id),
  period text not null default 'daily',
  max_requests integer,
  max_cost_usd numeric(12, 2),
  behavior text not null default 'deny',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint model_budget_rules_period_check check (period in ('hourly', 'daily', 'weekly', 'monthly')),
  constraint model_budget_rules_behavior_check check (behavior in ('deny', 'require_approval', 'fallback'))
);

create table if not exists model_pins (
  id uuid primary key default gen_random_uuid(),
  role_id text not null references model_roles(id),
  provider_id text not null references provider_registry(id),
  model_id uuid references model_catalog(id),
  pinned_by text not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (role_id)
);

create table if not exists provider_health_checks (
  provider_id text primary key references provider_registry(id),
  status text not null default 'not_configured',
  checked_at timestamptz not null default now(),
  latency_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint provider_health_checks_status_check check (status in ('not_configured', 'healthy', 'degraded', 'unavailable'))
);

create table if not exists permission_policies (
  id text primary key,
  description text not null,
  default_decision text not null default 'deny',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint permission_policies_decision_check check (default_decision in ('allow', 'deny', 'approval_required'))
);
