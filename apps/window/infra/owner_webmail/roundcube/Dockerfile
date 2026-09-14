# Roundcube with the committed owner configuration and the frank_sso launch
# plugin baked into the upstream application tree.
#
# The base is the pinned upstream release image; the only things added are this
# repository's own config and plugin. They are copied into /usr/src/roundcubemail,
# which is where the image's entrypoint installs the application from, so the
# committed files land in the runtime tree on first start and are refreshed by
# the image's own installto.sh on later starts. config/config.inc.php is not in
# installto.sh's file list, so an operator's runtime edits could never be
# silently replaced by an image update.
FROM roundcube/roundcubemail:1.7.4-apache@sha256:8a4f88846145c6c8801654d9c3b330071e162f0110b64d08af8e94aca50ffb89

LABEL org.opencontainers.image.title="frank-owner-webmail" \
      org.opencontainers.image.description="Owner mailbox client: pinned Roundcube plus the Frank launch session plugin" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

COPY config.inc.php /usr/src/roundcubemail/config/config.inc.php
COPY plugins/frank_sso /usr/src/roundcubemail/plugins/frank_sso
COPY entrypoint/10-restore-committed-config.sh /entrypoint-tasks/post-setup/10-restore-committed-config.sh

# Fail the build rather than ship a broken plugin or config.
RUN php -l /usr/src/roundcubemail/config/config.inc.php \
 && php -l /usr/src/roundcubemail/plugins/frank_sso/frank_sso.php \
 && chmod 0755 /entrypoint-tasks/post-setup/10-restore-committed-config.sh
