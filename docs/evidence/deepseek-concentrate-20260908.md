# DeepSeek routing change, 8 September 2026

Steven requested no direct DeepSeek provider; any required DeepSeek use goes
through Concentrate. This is dated operational evidence, not a new runtime.

The shared default Hermes profile still held DEEPSEEK_API_KEY and an env-seeded
DeepSeek credential-pool entry. Its global selection was an OrcaRouter DeepSeek
Flash free route. Historical browser sessions also pinned direct DeepSeek.

Changes used Hermes's supported configuration, credential-lifecycle and session
model-lock interfaces. Direct DeepSeek is disabled in providers.deepseek.enabled;
the key was removed, its pool/cache references purged and env source suppressed.
The global model is concentrate/deepseek-v4-flash at api.concentrate.ai. Thirty-two
non-ended, non-archived DeepSeek session selections were migrated using the
authenticated session-model API, preserving Flash/Pro/experimental-vision variants
and reasoning options. Ended historical sessions and transcripts were not rewritten.

Exact config, auth and environment backups plus an online SQLite backup are
retained root-only at /srv/hermes/backups/deepseek-concentrate-20260908. Do not
restore the whole database over newer session history. Unrelated settings and
credentials were compared and preserved. Gateway restart completed at 04:53 UTC;
its existing Hermes source 502fafe9f8 and template renderer were not changed.
The shared-profile hermes-serve service was also restarted after its status
reported zero active agents/sessions, clearing any old in-memory credential.
Both service health endpoints passed. A comparison against the backup verified
all 32 migrated sessions kept their message counts and ended/archive status;
no existing session was deleted.

Verification: the resolver rejects direct DeepSeek as disabled; Concentrate and
Meta resolve to their own endpoints and matching named credentials. Authenticated
gateway health is healthy and its model catalogue reports DeepSeek direct as
unauthenticated. No eligible unmigrated session selection remains. One bounded
Concentrate Responses request completed with novita/deepseek-v4-flash-0731,
9 input tokens and 2 output tokens. This is not a template-generator acceptance.
