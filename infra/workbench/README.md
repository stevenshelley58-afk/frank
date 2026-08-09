# FRANK workbench image

This directory defines the credential-free execution base used by an isolated
FRANK workbench. It is Debian/glibc based so the host-installed Goose binary
can be bind-mounted into the container instead of being downloaded or
configured during the image build.

## Reproducibility

- The Node 22 Debian base is pinned by exact version and its `linux/amd64`
  image digest, matching the x86_64 VPS and host-mounted Goose binary.
- Debian package resolution is frozen at the `20260806T000000Z` Debian and
  Debian Security snapshots.
- The image installs no package from an unpinned third-party repository.
- Production must address the built image by its registry digest, for example
  `registry.example/frank-workbench@sha256:<digest>`, never `:latest`.

When deliberately refreshing the image, update the base version, base digest,
and Debian snapshot together, then record the resulting image digest in the
runtime configuration.

## Runtime contract

The image runs as `frank` (`uid=10001`, `gid=10001`) with `/workspace` as its
working directory. The runtime is responsible for mounting:

- one workbench-owned writable volume at `/workspace`;
- the host's glibc Goose executable at `/opt/frank/bin/goose`, read-only; and
- only the task-specific files and credential handles allowed by policy.

`/opt/frank/bin` is already on `PATH`. The image does not contain Goose, Goose
configuration, model credentials, tokens, repository credentials, or user
data. If a run needs Goose configuration, inject the minimum run-specific
configuration at runtime under `/home/frank/.config/goose`; do not derive a
new image containing it.

The runtime should additionally apply its per-task limits and containment:
drop all capabilities, set `no-new-privileges`, use an explicit network
policy, mount only declared paths, and keep the host Docker socket outside the
container.
