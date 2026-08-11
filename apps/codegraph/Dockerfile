# frank-codegraph is a Graphify supervisor, not a parser implementation.
# The immutable, SHA-256-verified source archive is pinned to Graphify
# v0.9.39's reviewed upstream commit. The build also verifies package metadata.
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS dependencies

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build
COPY apps/codegraph/requirements.lock ./requirements.lock
COPY apps/codegraph/build-requirements.lock ./build-requirements.lock
COPY apps/codegraph/scripts/generate_inventory.py ./generate_inventory.py
RUN python -m venv /opt/frank-codegraph-venv \
    && /opt/frank-codegraph-venv/bin/pip install --require-hashes -r build-requirements.lock \
    && /opt/frank-codegraph-venv/bin/pip install --no-build-isolation --require-hashes -r requirements.lock \
    && /opt/frank-codegraph-venv/bin/python -c "from importlib.metadata import version; assert version('graphifyy') == '0.9.39'" \
    && /opt/frank-codegraph-venv/bin/python generate_inventory.py /opt/frank-codegraph-metadata/dependencies.cdx.json

FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS runtime

ARG FRANK_SOURCE_URL="https://github.com/stevenshelley58-afk/frank"
ARG FRANK_REVISION="unknown"

LABEL org.opencontainers.image.title="frank-codegraph" \
      org.opencontainers.image.description="Frank's internal Graphify AST-only code intelligence supervisor" \
      org.opencontainers.image.source="${FRANK_SOURCE_URL}" \
      org.opencontainers.image.revision="${FRANK_REVISION}" \
      io.frank.graphify.package="graphifyy" \
      io.frank.graphify.version="0.9.39" \
      io.frank.graphify.source="https://github.com/Graphify-Labs/graphify" \
      io.frank.graphify.revision="50556baaea803e191947fdfcc2e0c22e2d4eb74d" \
      io.frank.graphify.license="Apache-2.0"

ENV PATH="/opt/frank-codegraph-venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    CODEGRAPH_OUTPUT=/data/codegraph \
    CODEGRAPH_REGISTRY=/etc/frank-codegraph/projects.json \
    CODEGRAPH_HOST=0.0.0.0 \
    CODEGRAPH_PORT=3002 \
    CODEGRAPH_DEBOUNCE_SECONDS=2

WORKDIR /app
COPY --from=dependencies /opt/frank-codegraph-venv /opt/frank-codegraph-venv
COPY --from=dependencies /opt/frank-codegraph-metadata ./sbom
COPY apps/codegraph/frank_codegraph ./frank_codegraph
COPY apps/codegraph/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY apps/codegraph/LICENSES ./LICENSES

# Docker's named-volume copy-up preserves this ownership for a new volume. The
# service itself never needs root or a writable image layer.
RUN groupadd --gid 10001 frank \
    && useradd --uid 10001 --gid 10001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin frank \
    && install -d --owner=10001 --group=10001 --mode=0750 /data/codegraph /etc/frank-codegraph

USER 10001:10001
EXPOSE 3002
ENTRYPOINT ["python", "-m", "frank_codegraph"]
