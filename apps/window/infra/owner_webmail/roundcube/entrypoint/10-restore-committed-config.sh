#!/bin/sh
# Roundcube's own update path (bin/installto.sh -> bin/update.sh) rewrites
# config/config.inc.php from its sample as soon as it sees an option the
# installed version no longer recognises. That would silently discard the
# committed owner configuration on the next container start, so the committed
# file is put back after that path has run and before the web server starts.
#
# This is the image's documented post-setup extension point
# (/entrypoint-tasks/post-setup), not a patch to the application.
set -eu

src=/usr/src/roundcubemail/config/config.inc.php
dst=/var/www/html/config/config.inc.php

[ -f "$src" ] || exit 0
[ -d /var/www/html/config ] || exit 0

if ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    chown root:root "$dst"
    chmod 0644 "$dst"
    echo "owner-webmail: restored the committed Roundcube configuration"
fi

exit 0
