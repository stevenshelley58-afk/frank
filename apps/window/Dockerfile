FROM node:22-alpine AS graph-build
WORKDIR /build
COPY apps/window/package.json apps/window/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/window/graph ./graph
COPY apps/window/dashboard ./dashboard
COPY apps/window/scripts ./scripts
COPY apps/window/archify ./archify
COPY apps/window/vendor/archify/archify ./vendor/archify/archify
RUN npm run build:dashboard
RUN npm run build:graph
RUN node vendor/archify/archify/bin/archify.mjs validate architecture archify/ad-template-process.json --json
RUN node vendor/archify/archify/bin/archify.mjs check archify/ad-template-process.html
RUN node --input-type=module -e 'import fs from "node:fs"; import { createHash } from "node:crypto"; const digest=(path)=>createHash("sha256").update(fs.readFileSync(path)).digest("hex"); fs.writeFileSync("archify/validation-receipt.json", JSON.stringify({schema:"frank.archify-build-validation.v1",validated:true,artifactSha256:digest("archify/ad-template-process.html"),specSha256:digest("archify/ad-template-process.json"),validatorSha256:digest("vendor/archify/archify/bin/archify.mjs")})+"\n");'

FROM node:22-alpine AS agenttrail-runtime
WORKDIR /agenttrail
COPY apps/window/vendor/agenttrail/package.json ./package.json
COPY apps/window/vendor/agenttrail/bin ./bin
COPY apps/window/vendor/agenttrail/public ./public
RUN mkdir -p /home/node/.agenttrail && chown -R node:node /home/node/.agenttrail
USER node
CMD ["node", "/agenttrail/bin/agenttrail.mjs", "/workspace", "--port", "5340", "--no-open"]

FROM python:3.12-slim
WORKDIR /app
COPY apps/window/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/window/server.py .
COPY apps/window/ad_radar.py .
COPY apps/window/control_plane_view.py .
COPY apps/window/action_dispatcher.py .
COPY apps/window/scripts/run_scheduled_control_job.py ./scripts/run_scheduled_control_job.py
COPY apps/window/runtime_evidence.py .
COPY apps/window/project_store.py .
COPY apps/window/home_platform.py .
COPY apps/window/home_defaults.py .
COPY apps/window/home_providers.py .
COPY apps/window/memory_inspector.py .
COPY apps/window/mini_frank.py .
COPY apps/window/mini ./mini
COPY apps/window/connections_agent.py .
COPY apps/window/provider_adapters.py .
COPY apps/window/vault_broker.py .
COPY apps/window/tool_apps ./tool_apps
COPY apps/window/tools ./tools
COPY apps/window/graph ./graph
COPY apps/window/scripts ./scripts
COPY apps/window/web /web
COPY governance/control-plane/feature-flags.yaml ./governance/control-plane/feature-flags.yaml
COPY governance/control-plane/actions.yaml ./governance/control-plane/actions.yaml
COPY governance/control-plane/build-context.yaml ./governance/control-plane/build-context.yaml
COPY governance/control-plane/cleanup-reporters.yaml ./governance/control-plane/cleanup-reporters.yaml
COPY governance/control-plane/discovery.yaml ./governance/control-plane/discovery.yaml
COPY governance/control-plane/projections.yaml ./governance/control-plane/projections.yaml
COPY governance/control-plane/aliases.yaml ./governance/control-plane/aliases.yaml
COPY governance/control-plane/capabilities ./governance/control-plane/capabilities
COPY governance/control-plane/schema ./governance/control-plane/schema
COPY --from=graph-build /build/web/dashboard /web/dashboard
COPY --from=graph-build /build/web/graph /web/graph
COPY --from=graph-build /build/archify ./archify
COPY --from=graph-build /build/vendor/archify/archify ./vendor/archify/archify
ENV FRANK_WEB=/web
ENV FRANK_REPOSITORY_ROOT=/app
ENV PORT=8080
EXPOSE 8080
# Frank's JSON stores use process-local locks; keep one worker and use threads.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "0", "server:app"]
