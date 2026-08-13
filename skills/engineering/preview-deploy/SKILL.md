---
name: preview-deploy
description: Deploy static builds to the hosted preview lane at preview.frank.fail. Use this for ALL buildable tasks — no local testing, no localhost, no PR review. The deliverable is always a live URL.
---

# Preview Deploy

Every buildable task deploys to the hosted preview lane. No exceptions.

## When to use

ANY time you are building something visual or testable — a page, a component,
a mockup, a dashboard, a tool. Deploy a skeleton FIRST, then iterate on the
live URL. The user reviews the link, not screenshots.

## How to deploy

```bash
# Deploy a directory (auto-versions: topic-v1, topic-v2, ...):
/frank/deployed/infra/preview-deploy.sh <topic> <source-dir>

# Deploy a single HTML file:
/frank/deployed/infra/preview-deploy.sh <topic> <file.html>

# Overwrite the latest version (rapid iteration, no version bump):
/frank/deployed/infra/preview-deploy.sh <topic> <source> --update

# Use an exact slug (no versioning):
/frank/deployed/infra/preview-deploy.sh <exact-slug> <source> --exact
```

The script prints the live URL. Hand that URL to the user.

## Rules

1. **Deploy first, build second.** Get a skeleton URL live before writing
   real feature code.
2. **Topic = what we're building.** Derive it from the task. Lowercase,
   hyphens. The script sanitizes automatically.
3. **Iterate with --update** for small tweaks. Bump versions (just re-run
   without --update) when the change is significant enough to keep the old
   one for comparison.
4. **The deliverable is the URL.** Not a branch, not a PR, not "run these
   commands." A clickable link.
5. **Previews are PUBLIC.** No secrets, no credentials, no private data.
6. **Previews are STATIC.** For things needing a backend, deploy the real
   service and point the preview's frontend at the live API.

## Workflow

1. User says "build X"
2. You create a skeleton and deploy: `preview-deploy.sh x-v1 /path/to/skeleton/`
3. You hand the user the link: `https://preview.frank.fail/x-v1/`
4. User reviews, gives feedback
5. You iterate, deploying updates to the same URL (--update) or new versions
6. User approves → promote to production
7. Done. The link was the whole review process.

## What this replaces

- `npm run dev` + localhost
- GitHub PRs for visual review
- Vercel preview deployments
- "I'll test it locally and push"
