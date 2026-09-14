# Docker retention
The installer replaces the existing daily docker-prune service with committed immutable source.
It keeps every running/stopped container image, runtime selectors, retained Blockwise release tags, and two newest unused image IDs per explicitly owned repository. Upstream and unknown repositories stay untouched.
Docker removes exact tags without force. BuildKit native prune targets 2GB of cache, excludes cache used in the last 24 hours and never removes active cache. This is a target, not a hard disk quota.
Volumes and runtime releases are excluded from automatic removal: ownership and dependencies require individual verification. Run the Python script without --apply for a dry run. Tests: python3 test-docker-retention.py.
