# Docker retention
Installer activates hourly locked cleanup from committed immutable source.
BuildKit native unused-cache cleanup targets2GB without an age filter. Docker protects in-use cache. This is an hourly target, not a hard quota during builds.
Legacy preview expiry accepts only exact blockwise-homepage/process/email-preview-<hex> names, created at least24hours ago, full revision already merged in Blockwise main, no mounts and no extant source task worktree. Other preview families, unmerged work, younger reviews and all production services are excluded. Containers are stopped and removed without volume removal after fresh checks.
Image retention keeps all container images, runtime selectors, retained releases, plus2unused IDs per allowlisted repository. Upstream images untouched. Volumes never pruned.
Dry run: python3 docker-runtime-retention.py. Tests: python3 test-docker-retention.py.
