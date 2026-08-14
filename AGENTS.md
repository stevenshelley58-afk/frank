# Frank — Agent Rules

## RULE 0: Preview-first workflow (non-negotiable)

**No local testing. No localhost. No "it works on my machine."**

Every buildable task follows this loop:

1. **Create a hosted preview first.** Before writing feature code, deploy a
   skeleton to `https://preview.frank.fail/<topic>-v1/` so the user has a live
   URL from minute one.
2. **Iterate on the preview URL.** Push changes to the same version with
   `--update`, or bump to a new version when the change is significant enough
   to keep the old one around for comparison.
3. **When complete, hand over the link.** The deliverable is a URL the user
   can click. Not a branch. Not a PR. Not "run these commands." A link.
4. **Only then promote to production** (frank.fail / tasks.frank.fail / etc.)
   via the normal deploy path — but the user has already seen and approved it live.

### How to deploy a preview

```bash
# New topic → auto-creates <topic>-v1:
ssh vps '/frank/deployed/infra/preview-deploy.sh onboarding-flow /path/to/output/'
# → https://preview.frank.fail/onboarding-flow-v1/

# Same topic again → auto-bumps to -v2 (old versions preserved):
ssh vps '/frank/deployed/infra/preview-deploy.sh onboarding-flow /path/to/v2-output/'
# → https://preview.frank.fail/onboarding-flow-v2/

# Iterate in place (overwrite latest version, no bump):
ssh vps '/frank/deployed/infra/preview-deploy.sh onboarding-flow /path/to/output/ --update'
# → https://preview.frank.fail/onboarding-flow-v2/ (overwritten)

# Exact slug (no versioning — for one-offs, system pages):
ssh vps '/frank/deployed/infra/preview-deploy.sh my-exact-slug /path/to/thing/ --exact'
# → https://preview.frank.fail/my-exact-slug/
```

### Slug generation

The topic/slug is auto-generated from the conversation — the agent derives it
from what's being built. The user never names slugs manually. Topics are
sanitized to lowercase-hyphenated automatically.

### Versioning

- Same topic deployed multiple times → `-v1`, `-v2`, `-v3`... (auto-incremented)
- `--update` overwrites the latest version in place (for rapid iteration)
- Old versions are preserved so the user can compare v1 vs v2
- Each deployment writes a `.preview-meta.json` with topic, slug, timestamp

### Rules

- Topics auto-sanitized to `[a-z0-9-]` — no manual cleanup needed
- Previews are PUBLIC (no auth) — don't put secrets in them
- Previews are STATIC — for things needing a backend, deploy the real service
  and preview its frontend pointed at the live API
- Old previews can be deleted: `ssh vps 'rm -rf /frank/deployed/static/preview/<slug>'`
- `_`-prefixed slugs are reserved (e.g. `_system`)

### What this replaces

- No more `npm run dev` + localhost testing
- No more GitHub PRs for review
- No more Vercel preview deployments
- No more "I'll test it locally and push"

The VPS is the only dev environment. Preview lane is the only review surface.
