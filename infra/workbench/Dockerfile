# syntax=docker/dockerfile:1.7

# Node 22 on Debian/glibc so the host-supplied Goose binary can execute.
# Both the immutable version tag and the linux/amd64 image digest are pinned.
# The target VPS is x86_64 and supplies an amd64 Goose binary, so an image built
# for another architecture must fail instead of accepting an incompatible
# binary. Update the tag and digest together after reviewing provenance.
FROM node:22.23.2-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066

LABEL org.opencontainers.image.title="FRANK workbench"
LABEL org.opencontainers.image.description="Credential-free Debian execution base for isolated FRANK workbenches"
LABEL org.opencontainers.image.base.name="docker.io/library/node:22.23.2-bookworm-slim"

ARG DEBIAN_FRONTEND=noninteractive

# Freeze Debian package resolution to a dated snapshot. This avoids a rebuild
# silently selecting different package versions after the base image has been
# reviewed. Snapshot Release files are historical, so Valid-Until is disabled;
# package signatures remain mandatory.
RUN set -eux; \
    printf '%s\n' \
      'Types: deb' \
      'URIs: https://snapshot.debian.org/archive/debian/20260806T000000Z' \
      'Suites: bookworm bookworm-updates' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      'URIs: https://snapshot.debian.org/archive/debian-security/20260806T000000Z' \
      'Suites: bookworm-security' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' 'Acquire::Check-Valid-Until "false";' \
      > /etc/apt/apt.conf.d/99frank-snapshot; \
    # The pinned slim base intentionally contains no CA bundle. Bootstrap the
    # CA package from the signed snapshot index, then immediately restore TLS
    # verification before resolving any of the workbench toolchain.
    printf '%s\n' 'Acquire::https::Verify-Peer "false";' \
      > /etc/apt/apt.conf.d/98frank-ca-bootstrap; \
    apt-get update; \
    apt-get install --yes --no-install-recommends ca-certificates; \
    rm /etc/apt/apt.conf.d/98frank-ca-bootstrap; \
    apt-get update; \
    apt-get install --yes --no-install-recommends \
      build-essential \
      curl \
      git \
      jq \
      libgcc-s1 \
      libstdc++6 \
      pkg-config \
      python3 \
      python3-pip \
      python3-venv \
      ripgrep; \
    rm -rf /var/lib/apt/lists/*

# Goose and task processes always run as this explicit unprivileged identity.
# /opt/frank/bin is the read-only runtime mount point for the host's glibc
# Goose binary; neither the binary, its configuration, nor credentials are
# copied into this image.
RUN set -eux; \
    groupadd --gid 10001 frank; \
    useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash frank; \
    install -d --owner=10001 --group=10001 --mode=0750 \
      /workspace \
      /home/frank/.cache \
      /home/frank/.config; \
    install -d --owner=0 --group=0 --mode=0755 /opt/frank/bin

ENV HOME=/home/frank \
    XDG_CACHE_HOME=/home/frank/.cache \
    XDG_CONFIG_HOME=/home/frank/.config \
    PATH=/opt/frank/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /workspace
USER 10001:10001

# Confirms the runtime identity, Node, and the writable workbench boundary.
# Goose is intentionally not required here because it is mounted per run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const fs=require('node:fs');if(process.getuid?.()!==10001)process.exit(1);fs.accessSync('/workspace',fs.constants.R_OK|fs.constants.W_OK)"]

CMD ["sleep", "infinity"]
