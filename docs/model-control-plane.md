# Model Control Plane

Frank Hub routes work by model role, not by hardcoded model names. Agents request
roles such as `coding_fast` or `research_deep`; the control plane decides which
provider and model should satisfy the request.

## Foundation Tables

- `provider_registry`: provider adapter inventory and enabled state.
- `model_catalog`: provider models discovered or registered later.
- `capability_registry`: shared capability labels.
- `model_roles`: role definitions requested by agents.
- `model_routing_rules`: future routing rules by role, health, budget, and pins.
- `model_fallback_chain`: ordered fallback design.
- `model_usage`: usage and cost tracking.
- `model_budget_rules`: request/cost guardrails.
- `model_pins`: temporary role-to-provider/model pins.
- `provider_health_checks`: provider health snapshots.

## Required Roles

The initial migration seeds exactly these roles:

- `router_fast`
- `memory_extractor`
- `project_context_summarizer`
- `coding_fast`
- `coding_heavy`
- `coding_review`
- `research_fast`
- `research_deep`
- `scraping_extraction`
- `structured_data_extraction`
- `image_prompting`
- `image_generation`
- `image_editing`
- `embedding`
- `rerank`
- `notification_summarizer`
- `approval_reviewer`

## Provider Scaffolds

Provider adapters are typed placeholders only:

- OpenRouter
- LiteLLM
- OpenAI
- Anthropic
- Google
- Mistral
- Groq
- Together
- Replicate
- fal
- Ollama
- vLLM
- Codex
- Claude Agent SDK
- ComfyUI

Every adapter reports `not_configured` and throws before making any external
provider call. Real provider wiring belongs in a later stage.
