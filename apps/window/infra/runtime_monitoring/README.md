# Runtime monitoring promotion

Beszel remains isolated and off by default behind the `step4b-isolated` Compose
profile. Promotion is an explicit operator action: set the reviewed release
SHA variables and run `promote.sh` on the VPS. The script creates its password
under `/srv/frank/secrets` (never in Git), applies the pinned images, and keeps
the hub/agent private with read-only, dropped-capability, resource-capped
containers. Run `rollback.sh` to stop and remove the isolated profile.
