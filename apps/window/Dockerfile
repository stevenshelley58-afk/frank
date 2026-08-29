FROM node:22-alpine AS graph-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY graph ./graph
COPY dashboard ./dashboard
COPY scripts ./scripts
COPY archify ./archify
COPY vendor/archify/archify ./vendor/archify/archify
RUN npm run build:dashboard
RUN npm run build:graph
RUN node vendor/archify/archify/bin/archify.mjs validate architecture archify/ad-template-process.json --json
RUN node vendor/archify/archify/bin/archify.mjs check archify/ad-template-process.html
RUN node --input-type=module -e 'import fs from "node:fs"; import { createHash } from "node:crypto"; const digest=(path)=>createHash("sha256").update(fs.readFileSync(path)).digest("hex"); fs.writeFileSync("archify/validation-receipt.json", JSON.stringify({schema:"frank.archify-build-validation.v1",validated:true,artifactSha256:digest("archify/ad-template-process.html"),specSha256:digest("archify/ad-template-process.json"),validatorSha256:digest("vendor/archify/archify/bin/archify.mjs")})+"\n");'

FROM node:22-alpine AS agenttrail-runtime
WORKDIR /agenttrail
COPY vendor/agenttrail/package.json ./package.json
COPY vendor/agenttrail/bin ./bin
COPY vendor/agenttrail/public ./public
RUN mkdir -p /home/node/.agenttrail && chown -R node:node /home/node/.agenttrail
USER node
CMD ["node", "/agenttrail/bin/agenttrail.mjs", "/workspace", "--port", "5340", "--no-open"]

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY project_store.py .
COPY home_platform.py .
COPY home_defaults.py .
COPY home_providers.py .
COPY memory_inspector.py .
COPY mini_frank.py .
COPY connections_agent.py .
COPY provider_adapters.py .
COPY vault_broker.py .
COPY tool_apps ./tool_apps
COPY tools ./tools
COPY graph ./graph
COPY web /web
COPY --from=graph-build /build/web/dashboard /web/dashboard
COPY --from=graph-build /build/web/graph /web/graph
COPY --from=graph-build /build/archify ./archify
COPY --from=graph-build /build/vendor/archify/archify ./vendor/archify/archify
ENV FRANK_WEB=/web
ENV PORT=8080
EXPOSE 8080
# Frank's JSON stores use process-local locks; keep one worker and use threads.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "0", "server:app"]
