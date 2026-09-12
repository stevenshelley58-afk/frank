# Private owner marketing foundation

Pinned upstream Mautic 7.2 Apache with MySQL 8.4, loopback-only on port
18106. The dedicated Docker network is internal, so this draft-only stage has
no outbound network path. Cron/workers are disabled and the native mailer is
set to `null`; no email delivery is claimed. Campaigns and provider transports
remain unconfigured and unpublished.

`deploy.sh` creates only root-owned 0700/0600 external runtime secrets under
`/srv/frank/secrets/owner-marketing`. It refuses dirty or untracked source and
stamps the exact Git SHA and image digest into the running container. Use
`./test.sh`, `./deploy.sh`, and `./check.sh` from the exact committed revision.
