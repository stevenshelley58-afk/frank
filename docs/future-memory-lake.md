# Future Memory Lake

Stage 4 does not implement a Frank-native memory runtime or skill registry.

For Stage 4:

- Hermes memory is the execution-time memory system.
- Hermes skills are the execution-time skill system.
- Frank records task history, runner events, artifacts, and audit entries.
- Frank may display high-level Hermes status, but it does not duplicate or own
  Hermes memory/skills.

A later Frank Memory Lake can become a canonical cross-agent memory layer. That
future layer should index durable Frank-owned facts and selectively promote
useful Hermes outputs, without saving secrets, raw `.env` files, private keys, or
provider tokens.
