FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY web /web
ENV FRANK_WEB=/web
ENV PORT=8080
EXPOSE 8080
CMD ["gunicorn", "-b", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "0", "server:app"]
