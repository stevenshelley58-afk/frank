# Private owner marketing foundation

Pinned upstream Mautic 7.2 Apache with MySQL 8.4 keeps the database on the
internal backend network. Mautic web, and only the explicit native cron and
worker profiles, also join a dedicated egress bridge for the configured SMTP
transport. The Nginx reverse proxy is the only loopback listener on port 18106.

The default remains fail-closed and inactive: MAUTIC_MAILER_DSN falls back to
the deliberately unresolvable mail-sink.invalid:25, and cron/worker services
are disabled unless explicitly selected. No custom mail sender, cron executor,
provider account, or campaign is introduced.

MAUTIC_PUBLIC_URL is read from the root-owned private environment file and is
mapped into MAUTIC_URL. configure_site.sh synchronizes Mautic's native
config/local.php site_url after restart without printing configuration
secrets. Fresh installation uses the same URL.

The pinned upstream image roles are used for opt-in background execution:

    MAUTIC_RUNTIME_PROFILES=owner-marketing-cron,owner-marketing-worker ./deploy.sh

Leave MAUTIC_RUNTIME_PROFILES unset for the safe default. The cron profile
runs the image's native mautic_cron role. The worker profile runs the native
mautic_worker role with one email and hit consumer; failed-consumer retries remain off. Both profiles
remain attached to the dedicated egress network. The deploy script validates
profile names and removes previously running profile containers when unset.

deploy.sh creates root-owned 0700/0600 external runtime secrets under
/srv/frank/secrets/owner-marketing, preserves any explicitly provisioned
SMTP DSN, and stamps the exact Git SHA and image digest into the running
containers. install.sh runs Mautic's own installer once only after proving
the database has no tables. Use ./test.sh, ./deploy.sh, ./install.sh, and
./check.sh from the exact committed revision.

check.sh verifies the private loopback ingress, native site URL, protected
admin route, empty contacts/campaigns, profile/network policy, and native mail
configuration. With the default sink it confirms fail-closed behavior. With
an explicitly provisioned SMTP DSN it opens a TCP connection from the Mautic
container only; it does not authenticate, send, or enqueue mail.
