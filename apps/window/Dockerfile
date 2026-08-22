FROM node:22-alpine AS graph-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY graph ./graph
COPY dashboard ./dashboard
COPY scripts ./scripts
RUN npm run build:dashboard
RUN npm run build:graph

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
COPY connections_agent.py .
COPY provider_adapters.py .
COPY vault_broker.py .
COPY tool_apps ./tool_apps
COPY tools ./tools
COPY graph ./graph
COPY web /web
COPY --from=graph-build /build/web/dashboard /web/dashboard
COPY --from=graph-build /build/web/graph /web/graph
ENV FRANK_WEB=/web
ENV PORT=8080
EXPOSE 8080
# Frank's JSON stores use process-local locks; keep one worker and use threads.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "0", "server:app"]
