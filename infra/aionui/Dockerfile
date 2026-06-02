# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim

ARG TARGETARCH=amd64
ARG AIONUI_VERSION=2.1.9

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar gzip \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) aion_arch="x86_64" ;; \
    arm64) aion_arch="arm64" ;; \
    *) echo "Unsupported TARGETARCH ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  tarball="aionui-web-${AIONUI_VERSION}-linux-${aion_arch}.tar.gz"; \
  base_url="https://github.com/iOfficeAI/AionUi/releases/download/v${AIONUI_VERSION}"; \
  curl -fsSL "${base_url}/${tarball}" -o "/tmp/${tarball}"; \
  curl -fsSL "${base_url}/${tarball}.sha256" -o "/tmp/${tarball}.sha256"; \
  cd /tmp; \
  sha256sum -c "${tarball}.sha256"; \
  mkdir -p /opt; \
  tar -xzf "/tmp/${tarball}" -C /opt; \
  chmod +x /opt/aionui-web/aionui-web; \
  rm -rf /tmp/*

COPY entrypoint.sh /usr/local/bin/frank-aionui-entrypoint
RUN chmod +x /usr/local/bin/frank-aionui-entrypoint

ENV AIONUI_PORT=25808 \
  AIONUI_HOST=0.0.0.0 \
  AIONUI_ALLOW_REMOTE=true \
  AIONUI_DATA_DIR=/data \
  AIONUI_LOG_DIR=/data/logs \
  AIONUI_OPEN_BROWSER=0 \
  AIONUI_NO_BUILD=1

EXPOSE 25808
ENTRYPOINT ["/usr/local/bin/frank-aionui-entrypoint"]
