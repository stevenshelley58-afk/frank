# No-terminal Ops Console

Frank Hub should make normal operations dashboard-first. The foundation includes
only a typed skeleton for future operations.

## Foundation Behavior

- Read-only status operations are allowed.
- Write operations require dashboard approval.
- Destructive actions are denied by default.
- Unrestricted host command execution is denied.
- No production-destructive actions are wired.

## Future Direction

Later stages can add specific approved actions such as restart requests, deploy
status previews, backup checks, and job controls. Each action should have a typed
permission policy, audit logging, and a dashboard confirmation path before it can
touch infrastructure.
