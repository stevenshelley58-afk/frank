# frank-codegraph is a Graphify supervisor, not a parser implementation.
# The immutable official Python index is multi-architecture. Production uses
# its audited linux/amd64 child sha256:47f36929d95852c8aa959380eeeea761ba7411ebe793d090da4cd518ac3af237.
ARG PYTHON_BUILDER_IMAGE="python:3.14.6-alpine3.24@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92"
FROM ${PYTHON_BUILDER_IMAGE} AS dependencies

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app:/opt/frank-codegraph/site-packages \
    PYTHONNOUSERSITE=1 \
    PYTHONSAFEPATH=1 \
    HOME=/tmp

WORKDIR /build
COPY apps/codegraph/requirements.lock ./requirements.lock
COPY apps/codegraph/build-requirements.lock ./build-requirements.lock
COPY apps/codegraph/scripts/generate_inventory.py ./generate_inventory.py
COPY apps/codegraph/scripts/assemble_scratch_runtime.py ./assemble_scratch_runtime.py
COPY apps/codegraph/scripts/verify_scratch_runtime.py ./verify_scratch_runtime.py
COPY apps/codegraph/runtime/sitecustomize.py ./sitecustomize.py
COPY apps/codegraph/frank_codegraph ./frank_codegraph
COPY apps/codegraph/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY apps/codegraph/LICENSES ./LICENSES

RUN apk add --no-cache scanelf=1.3.9-r1 \
    && python3 -m venv /opt/frank-build-venv \
    && /opt/frank-build-venv/bin/pip install --require-hashes -r build-requirements.lock \
    && /opt/frank-build-venv/bin/pip install --no-build-isolation --require-hashes \
        --target /opt/frank-codegraph/site-packages -r requirements.lock \
    && rm -rf /opt/frank-codegraph/site-packages/bin \
        /opt/frank-codegraph/site-packages/pip \
        /opt/frank-codegraph/site-packages/pip-*.dist-info \
        /opt/frank-codegraph/site-packages/setuptools \
        /opt/frank-codegraph/site-packages/setuptools-*.dist-info \
        /opt/frank-codegraph/site-packages/wheel \
        /opt/frank-codegraph/site-packages/wheel-*.dist-info \
        /opt/frank-codegraph/site-packages/_distutils_hack \
        /opt/frank-codegraph/site-packages/distutils-precedence.pth \
    && python3 generate_inventory.py \
        /opt/frank-codegraph-metadata/dependencies.cdx.json \
        /opt/frank-codegraph/site-packages \
    && python3 assemble_scratch_runtime.py \
        /opt/frank-runtime-root /opt/frank-codegraph/site-packages \
    && cp -R frank_codegraph /opt/frank-runtime-root/app/frank_codegraph \
    && cp sitecustomize.py /opt/frank-runtime-root/app/sitecustomize.py \
    && cp THIRD_PARTY_NOTICES.md /opt/frank-runtime-root/app/THIRD_PARTY_NOTICES.md \
    && cp -R LICENSES /opt/frank-runtime-root/app/LICENSES \
    && cp /opt/frank-codegraph-metadata/dependencies.cdx.json \
        /opt/frank-runtime-root/app/sbom/dependencies.cdx.json \
    && cp verify_scratch_runtime.py /opt/frank-runtime-root/tmp/verify_scratch_runtime.py \
    && chroot /opt/frank-runtime-root /usr/local/bin/python3 -P -c \
        'import os, runpy; os.chdir("/tmp"); runpy.run_path("/tmp/verify_scratch_runtime.py", run_name="__main__")' \
    && rm -rf /opt/frank-runtime-root/tmp/frank-codegraph-acceptance \
        /opt/frank-runtime-root/tmp/verify_scratch_runtime.py \
    && find /opt/frank-runtime-root -type d -name __pycache__ -prune -exec rm -rf '{}' + \
    && find /opt/frank-runtime-root -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete \
    && test ! -e /opt/frank-runtime-root/usr/local/lib/python3.14/tarfile.py \
    && test ! -e /opt/frank-runtime-root/usr/local/lib/python3.14/html/parser.py \
    && test ! -e /opt/frank-runtime-root/usr/local/lib/python3.14/tkinter \
    && test ! -e /opt/frank-runtime-root/usr/local/lib/python3.14/idlelib \
    && test ! -e /opt/frank-runtime-root/usr/local/lib/python3.14/turtledemo \
    && test -z "$(find /opt/frank-runtime-root/usr/local/lib/python3.14 -type f -name '_tkinter*.so' -print -quit)" \
    && test -z "$(find /opt/frank-runtime-root -type d -name __pycache__ -print -quit)" \
    && test -z "$(find /opt/frank-runtime-root -type f \( -name '*.pyc' -o -name '*.pyo' \) -print -quit)" \
    && python3 assemble_scratch_runtime.py --finalize /opt/frank-runtime-root

FROM scratch AS runtime

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
      io.frank.graphify.license="Apache-2.0" \
      io.frank.runtime.base="scratch" \
      io.frank.builder.python.version="3.14.6-alpine3.24" \
      io.frank.builder.python.index-digest="sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92" \
      io.frank.builder.python.amd64-digest="sha256:47f36929d95852c8aa959380eeeea761ba7411ebe793d090da4cd518ac3af237"

ENV PYTHONPATH="/app:/opt/frank-codegraph/site-packages" \
    PYTHONNOUSERSITE=1 \
    PYTHONSAFEPATH=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    CODEGRAPH_OUTPUT=/data/codegraph \
    CODEGRAPH_REGISTRY=/etc/frank-codegraph/projects.json \
    CODEGRAPH_HOST=0.0.0.0 \
    CODEGRAPH_PORT=3002 \
    CODEGRAPH_DEBOUNCE_SECONDS=2

COPY --from=dependencies /opt/frank-runtime-root /

WORKDIR /app
USER 10001:10001
EXPOSE 3002
ENTRYPOINT ["/usr/local/bin/python3", "-P", "-m", "frank_codegraph"]
