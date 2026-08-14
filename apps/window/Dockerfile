FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY home_platform.py .
COPY home_defaults.py .
COPY home_providers.py .
COPY provider_adapters.py .
COPY vault_broker.py .
COPY web /web
ENV FRANK_WEB=/web
ENV PORT=8080
EXPOSE 8080
# Frank's JSON stores use process-local locks; keep one worker and use threads.
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "0", "server:app"]
