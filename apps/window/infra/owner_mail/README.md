# Owner ordinary mailbox

Native Frappe Email Account configuration for hello@blockwise.sale, with the existing blockwise@purelymail.com login. Purelymail handles ordinary correspondence and support replies only, never marketing or cold outreach. Mautic/Resend own approved opt-in flows separately.

`python3 setup.py` previews. `--apply` prepares a disabled native account. `--apply --activate` requires Purelymail domain/routing verified and native container egress working. Existing IMAP UID state is preserved on reconfiguration. Secrets remain root-private in /srv/frank/secrets/owner-mail.env and native encrypted Password storage, never Git.

Uses TLS IMAP993 and SMTP465, native Sent-folder copies, no automatic contact import and no tracking pixel. It leaves site scheduler/mute settings untouched: queue review and native send/receive/reply acceptance precede site-wide activation. Initial native sync is UNSEEN with a bounded 100-message initial batch; review the existing mailbox before enabling.

After the user rotates the supplied login password, update the external mailbox secret and reapply without resetting UID state. Prefer a dedicated app password when the owner authorizes one. No password is printed by setup or its tests.

`python3 activate.py` is a read-only readiness check after native account activation. `--apply` enables only the native Frappe scheduler/mail from a clean main-reachable committed checkout, using the opt-in `owner-mail` scheduler profile. It refuses pending mail, unreviewed automatic email rules, or unexpected enabled accounts. Verify domain routing before account activation, then send/receive/reply and Sent-folder acceptance after scheduler activation. A failed activation re-mutes mail and disables scheduling without deleting messages.
