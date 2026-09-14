# The launch broker is stdlib-only Python, so the image is the pinned
# interpreter and one file. No package manager runs at build time.
FROM python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a

LABEL org.opencontainers.image.title="owner-webmail-launch" \
      org.opencontainers.image.description="Single-use launch broker for the owner webmail session" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /opt/owner-webmail-launch

COPY launch_server.py /opt/owner-webmail-launch/launch_server.py

# A dedicated unprivileged account owns the token store and nothing else.
RUN addgroup -g 11002 -S launch \
 && adduser -u 11002 -S -G launch -H -s /sbin/nologin launch \
 && install -d -m 0700 -o launch -g launch /var/lib/owner-webmail-launch

USER 11002:11002

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=10 \
  CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["python3", "-u", "/opt/owner-webmail-launch/launch_server.py"]
