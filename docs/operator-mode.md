# Frank Operator Mode

Frank Hub can run in a powerful VPS lab posture while keeping a few hard locks
around irreversible damage and secrets.

## Modes

- `lab`: broad write, shell, Git, install, build, and repo-edit work is allowed
  outside protected paths.
- `guarded`: write work is approval-gated; host/destructive work is denied.
- `production`: future conservative mode for locked-down operation.

Configure the mode in `/opt/frank-hub/.env`:

```env
FRANK_OPERATOR_MODE=lab
FRANK_REPO_WORKSPACE_PATH=/opt/frank-hub
FRANK_OPERATOR_ALLOWED_WORKSPACES=/opt/frank-hub,/opt/frank-hub/workspaces,/opt/frank-projects
FRANK_OPERATOR_PROTECTED_PATHS=/,/root,/etc,/boot,/var/lib/docker,/var/lib/postgresql,/opt/frank-backups,/opt/frank-hub/.env,/opt/frank-hub/runtime/access,/opt/frank-hub/runtime/hermes/.env,/opt/frank-hub/runtime/hermes/platforms/whatsapp/session
FRANK_ACCESS_ENV_FILE=./runtime/access/frank-access.env
FRANK_SECRET_WRITE_ENABLED=false
```

## Self-Reference

Hermes mounts the Frank repo at `/opt/frank-hub`. In lab mode, tasks may choose
that workspace explicitly so agents can inspect and change Frank itself.

Normal task workspaces remain under:

```text
/opt/frank-hub/workspaces/tasks/{task_id}
```

## Frank Access File

Create the VPS-only access file from the example:

```bash
mkdir -p /opt/frank-hub/runtime/access
cp /opt/frank-hub/operator-assets/frank-access.example.env /opt/frank-hub/runtime/access/frank-access.env
chmod 0600 /opt/frank-hub/runtime/access/frank-access.env
```

Put Frank's real email, mobile, WhatsApp, and API credentials in that file. The
file is ignored by Git and loaded by the API, worker, and Hermes containers.

The Settings page reports whether access is configured and lists API key names.
It does not display secret values.

If you want to edit Frank access values from the dashboard in the VPS lab, set:

```env
FRANK_SECRET_WRITE_ENABLED=true
```

The API will then write only allowlisted keys into
`/opt/frank-hub/runtime/access/frank-access.env`, record redacted audit events,
and return only fingerprints/configured state.

## WhatsApp Lab Runtime

Hermes-native WhatsApp is the only allowed WhatsApp runtime in this lab slice.
Configure the access file with:

```env
WHATSAPP_ENABLED=true
WHATSAPP_MODE=bot
WHATSAPP_ALLOWED_USERS=15550000000
WEBHOOK_ENABLED=true
WEBHOOK_SECRET=change-this
HERMES_WEBHOOK_SECRET=change-this
```

Run `hermes whatsapp` once against the persistent `runtime/hermes` volume and
scan the QR code from Frank's dedicated WhatsApp account. The session directory
is a protected credential path.

## Hard Locks

Even in lab mode, protect:

- production `.env` files, access credential files, and Hermes WhatsApp session
  files;
- `/opt/frank-backups`;
- `/`, `/root`;
- database volumes and backup roots;
- force-push or history rewrite workflows unless explicitly requested.

Mobile and email runtime integration remains a later stage. WhatsApp is wired
only through Hermes-native lab mode.
