---
name: verify-preview
description: Chrome-verify a preview URL before handing it over. After EVERY preview-deploy.sh run, open the URL in real Chrome, exercise the click-path, capture console/network/screenshot evidence, and only then deliver the link. Broken → fix-and-redeploy loop.
---

# Verify Preview

RULE 0 says the deliverable is a link. This skill is RULE 0's second half:
a **tested** link, not an unverified one. Never hand over a preview URL
that hasn't been opened and exercised in a real browser.

## When to use

Every time `preview-deploy.sh` runs. No exceptions. The deploy-and-verify
is one motion — see `skills/engineering/preview-deploy` for the deploy half.

## Protocol (C1)

1. **Open the URL in Chrome.** Headless is fine when the harness is
   available; what matters is a real Chromium engine, real console, real
   network stack — not curl.
2. **Execute the click-path the change is about.** Loading the page is not
   verification. If the change is a data table, sort it. If it's a dialog,
   open it, escape out of it, tab through it. If it's a deploy flow, click
   deploy.
3. **Read console errors + failed network requests.** Both must be empty
   (or every entry explicitly accounted for — e.g. a known 404 from an
   unrelated old preview).
4. **Screenshot key states.** Dark theme too, if the app themes. GIF the
   flow when it's interactive and worth showing.
5. **Only then deliver the link — with the evidence attached.**
   Screenshot(s) + console excerpt travel with the handover message.

## Evidence harness

`~/.frank-cdp/verify-preview.js` drives real Chrome over CDP:

```bash
node ~/.frank-cdp/verify-preview.js <url> <outdir> [options]
# --wait <ms>         settle time after load (default 2500)
# --click <selector>  click, repeatable
# --key <keys>        e.g. "Control+k", "Escape" (repeatable)
# --type <sel>=<text> focus + type
# --js <expr>         evaluate in page, result logged
# --theme-dark        re-screenshot under data-frank-theme="dark"
# --viewport 390x844  mobile-width check
# --name <basename>   evidence basename
```

Outputs `<name>.png` screenshots, `<name>.console.txt`, `<name>.report.json`.
Exit codes: `0` clean · `1` console errors or failed requests · `2` harness failure.

## What counts as evidence

- Screenshot(s) of the actual state being delivered (both themes if themed)
- Console excerpt showing zero errors (or the accounted-for ones)
- For interactive flows: the interaction captured (click sequence, key
  presses, resulting state)

## Failure handling

- **Broken → fix and redeploy before handover.** Iterate on the preview
  URL (`--update` for same-version fixes) until clean.
- **Max 3 fix-and-redeploy cycles.** If it's still broken after three,
  stop and escalate to Steven with the evidence — don't grind in a loop.

## Evidence conventions (C3)

Store per-preview evidence next to the deployment record:
`evidence/<slug>/` in the session or repo, named by slug/version mirroring
`.preview-meta.json` — e.g. `evidence/shadcn-bridge-v1/light.png`,
`console.txt`. Registry evidence links point at these files.

## Rules

1. Previews are PUBLIC — evidence screenshots must not capture secrets.
   Evidence stays in the repo/session, never on the preview lane.
2. A link delivered without evidence gets sent back. Standing rule.
3. Headless-Chrome verification is the floor. When the change is subtle
   (focus behavior, animation feel), a human pass on the URL still wins.
