# No-terminal Ops Console

Frank Hub should make normal operations dashboard-first. The foundation supports
a high-power lab operator mode for the private VPS while keeping dashboard
visibility and audit history.

## Foundation Behavior

- Read-only status operations are allowed.
- In `FRANK_OPERATOR_MODE=lab`, broad write and host work is allowed outside
  protected paths.
- In `guarded` and `production`, writes are approval-gated and destructive/host
  work remains denied.
- Protected paths remain denied in every mode.
- Hermes-native WhatsApp is wired only for the lab slice; it stays private on
  the Compose network and uses allowlisted users.
- No production-destructive actions are wired.

## Future Direction

Later stages can add specific dashboard actions such as restart, deploy,
rollback, provider-key checks, job controls, and Frank Vault. Each action should
keep typed permission policy, audit logging, and backup/rollback behavior where
needed.
