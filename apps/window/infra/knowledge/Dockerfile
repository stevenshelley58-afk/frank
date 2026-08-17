FROM python:3.11-slim
WORKDIR /app
COPY requirements-provider.txt provider_contract.py knowledge_projection.py provider_server.py projection_server.py ./
RUN pip install --no-cache-dir -r requirements-provider.txt
USER 65532:65532
ENTRYPOINT ["python", "provider_server.py"]
