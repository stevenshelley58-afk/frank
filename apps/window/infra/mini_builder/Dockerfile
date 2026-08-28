FROM nikolaik/python-nodejs:python3.11-nodejs20@sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038

# Mini Frank builds run without a network. Everything needed to inspect common
# customer files, create finished office/PDF/image/web artifacts, and perform a
# headless browser check is baked into this operator-built image.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        chromium \
        file \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-core \
        libreoffice-calc \
        libreoffice-writer \
        poppler-utils \
        unzip \
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir \
        beautifulsoup4==4.13.5 \
        openpyxl==3.1.5 \
        Pillow==12.3.0 \
        pypdf==6.16.1 \
        pytest==9.1.1 \
        python-docx==1.2.0 \
        reportlab==4.4.4 \
        XlsxWriter==3.2.5

WORKDIR /workspace
