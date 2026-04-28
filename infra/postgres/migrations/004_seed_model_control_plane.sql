insert into capability_registry (id, description)
values
  ('chat', 'General chat and instruction following'),
  ('code', 'Code generation, editing, and review'),
  ('reasoning', 'Complex planning and multi-step reasoning'),
  ('research', 'Research synthesis and source-grounded analysis'),
  ('extraction', 'Structured extraction from text, pages, and documents'),
  ('vision', 'Image understanding'),
  ('image_generation', 'Image generation'),
  ('image_editing', 'Image editing'),
  ('embedding', 'Embedding generation'),
  ('rerank', 'Search/result reranking')
on conflict (id) do update set
  description = excluded.description;

insert into provider_registry (id, display_name, status, enabled, metadata)
values
  ('openrouter', 'OpenRouter', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('litellm', 'LiteLLM', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('openai', 'OpenAI', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('anthropic', 'Anthropic', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('google', 'Google', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('mistral', 'Mistral', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('groq', 'Groq', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('together', 'Together', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('replicate', 'Replicate', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('fal', 'fal', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('ollama', 'Ollama', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('vllm', 'vLLM', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('codex', 'Codex', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('claude-agent-sdk', 'Claude Agent SDK', 'stubbed', false, '{"adapter":"not_configured"}'),
  ('comfyui', 'ComfyUI', 'stubbed', false, '{"adapter":"not_configured"}')
on conflict (id) do update set
  display_name = excluded.display_name,
  status = excluded.status,
  enabled = excluded.enabled,
  metadata = excluded.metadata,
  updated_at = now();

insert into provider_health_checks (provider_id, status, message, metadata)
select id, 'not_configured', 'Provider adapter is scaffolded only. No credentials or outbound calls are configured.', metadata
from provider_registry
on conflict (provider_id) do update set
  status = excluded.status,
  checked_at = now(),
  message = excluded.message,
  metadata = excluded.metadata;

insert into model_roles (id, description, required_capabilities, default_budget_tier, metadata)
values
  ('router_fast', 'Fast routing and request classification role.', array['chat'], 'low', '{"foundation":true}'),
  ('memory_extractor', 'Extract durable memory candidates from conversations and documents.', array['extraction'], 'standard', '{"foundation":true}'),
  ('project_context_summarizer', 'Summarize project context for future agents and workers.', array['chat','extraction'], 'standard', '{"foundation":true}'),
  ('coding_fast', 'Fast coding edits and lightweight implementation help.', array['code'], 'standard', '{"foundation":true}'),
  ('coding_heavy', 'Complex coding, architecture, and high-effort implementation work.', array['code','reasoning'], 'high', '{"foundation":true}'),
  ('coding_review', 'Code review, regression analysis, and risk identification.', array['code','reasoning'], 'high', '{"foundation":true}'),
  ('research_fast', 'Fast research and lookup role.', array['research'], 'standard', '{"foundation":true}'),
  ('research_deep', 'Deep source-grounded research role.', array['research','reasoning'], 'high', '{"foundation":true}'),
  ('scraping_extraction', 'Extract data from scraped pages and semi-structured web content.', array['extraction'], 'standard', '{"foundation":true}'),
  ('structured_data_extraction', 'Extract typed records from documents and payloads.', array['extraction'], 'standard', '{"foundation":true}'),
  ('image_prompting', 'Create prompts and direction for image generation/editing workflows.', array['chat'], 'standard', '{"foundation":true}'),
  ('image_generation', 'Generate images through future provider adapters.', array['image_generation'], 'high', '{"foundation":true,"runtime":"placeholder"}'),
  ('image_editing', 'Edit images through future provider adapters.', array['image_editing'], 'high', '{"foundation":true,"runtime":"placeholder"}'),
  ('embedding', 'Create vector embeddings.', array['embedding'], 'standard', '{"foundation":true}'),
  ('rerank', 'Rerank search and retrieval candidates.', array['rerank'], 'standard', '{"foundation":true}'),
  ('notification_summarizer', 'Summarize notifications and operational updates.', array['chat'], 'low', '{"foundation":true}'),
  ('approval_reviewer', 'Review requested actions before approval gates.', array['reasoning'], 'high', '{"foundation":true}')
on conflict (id) do update set
  description = excluded.description,
  required_capabilities = excluded.required_capabilities,
  default_budget_tier = excluded.default_budget_tier,
  metadata = excluded.metadata,
  updated_at = now();

insert into model_budget_rules (role_id, period, max_requests, max_cost_usd, behavior, enabled, metadata)
select id, 'daily', null, null, 'require_approval', true, '{"foundation":"placeholder"}'
from model_roles
where not exists (
  select 1
  from model_budget_rules existing
  where existing.role_id = model_roles.id
    and existing.period = 'daily'
    and existing.metadata ->> 'foundation' = 'placeholder'
)
on conflict do nothing;

insert into permission_policies (id, description, default_decision, metadata)
values
  ('tool.read', 'Read-only dashboard and system inspection operations.', 'allow', '{"foundation":true}'),
  ('tool.write', 'Write operations require explicit dashboard approval.', 'approval_required', '{"foundation":true}'),
  ('tool.destructive', 'Destructive operations are denied by default.', 'deny', '{"foundation":true}'),
  ('tool.host', 'Unrestricted host command execution is denied.', 'deny', '{"foundation":true}')
on conflict (id) do update set
  description = excluded.description,
  default_decision = excluded.default_decision,
  metadata = excluded.metadata;
