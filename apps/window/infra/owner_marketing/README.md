# Private owner marketing foundation

Pinned upstream Mautic 7.2 Apache with MySQL 8.4 stays exclusively on the
internal backend network, with no outbound network path. A separately pinned
Nginx reverse proxy is the only loopback listener on port 18106; it has no
credentials or provider runtime and proxies only to the fixed `mautic` backend.
Cron/workers are disabled and the native mailer uses deliberately unresolvable
`mail-sink.invalid:25`, so delivery fails closed rather than reporting false
success. Campaigns and provider transports remain unconfigured and unpublished.

`deploy.sh` creates only root-owned 0700/0600 external runtime secrets under
`/srv/frank/secrets/owner-marketing`. It refuses dirty or untracked source and
stamps the exact Git SHA and image digest into the running containers. Use
`./test.sh`, `./deploy.sh`, and `./check.sh` from the exact committed revision.
`deploy.sh` validates reachability for a fresh native setup; `check.sh` validates
the completed native login, unauthenticated denial, and empty contacts/campaigns.