FROM mautic/mautic:7.2-apache@sha256:39e967af9f154d50d1a7cbc12e6cfd5a847939c8abdcace98ab20e30570bdfda

# Mautic's 7.2 image omits DomCrawler, although its native HTML email link
# validator instantiates it. The official PHP image also leaves IMAP optional.
# Build both into a new immutable image instead of changing a running vendor tree.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libc-client-dev libkrb5-dev \
    && docker-php-ext-configure imap --with-kerberos --with-imap-ssl \
    && docker-php-ext-install -j"$(nproc)" imap \
    && cd /var/www/html && composer require --no-interaction --no-scripts --update-no-dev symfony/dom-crawler:7.4.17 \
    && test -f vendor/symfony/dom-crawler/Crawler.php \
    && php -m | grep -Fx imap \
    && rm -rf /var/lib/apt/lists/*
