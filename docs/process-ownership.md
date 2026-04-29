# Process Ownership

Frank Hub and Hermes have separate responsibilities.

## Frank Owns

- Dashboard and user-facing workflow
- Task queue and task state
- Runner sessions
- Runner events and task events
- Artifacts and artifact metadata
- Audit log
- Backup preflight and backup records
- Kill switch records
- Model/provider policy summary
- Final results shown to the user

Frank API and workers are the only services that call Hermes. The browser never
calls Hermes directly.

## Hermes Owns

- Operator execution
- Terminal/file/web tools
- Coding and ops work
- Hermes memory
- Hermes skills
- Hermes sessions and conversation history
- Subagents exposed by Hermes

Frank does not reimplement Hermes memory, skills, scheduler, messaging gateway,
or terminal runtime in Stage 4.

## Private API Boundary

Hermes API is a privileged local control surface. It must not be routed through
Cloudflare, exposed to the public internet, or called from frontend JavaScript.

Allowed path:

```text
Frank web -> Frank API -> Frank worker -> Hermes API
```

Forbidden paths:

```text
Browser -> Hermes API
Cloudflare public hostname -> Hermes API
External client -> Hermes API
```

## State Ownership

Hermes can execute and produce output, but Frank persists what the operator needs
to manage work over time:

- who/what started a run
- task status
- event log
- stop requests
- final output
- artifacts
- backup status
- audit trail

If Hermes is unavailable, Frank must stay healthy and report a clean disabled,
unconfigured, or unavailable state.
