# Frank client surface mockups

These are isolated, fixture-backed mockups for design approval. They do not call
the Frank or Hermes APIs and are not a production application.

## Open locally

From the worktree root, serve the repository with any static file server and
open `/mockups/client-surfaces/`.

Useful views:

- `?view=hub`
- `?view=hub&alerts=1`
- `?view=project`
- `?view=files`
- `?view=alerts` (mobile)
- `?view=more` (mobile)
- append `&offline=1` to preview cached read-only mode
- append `&attach=1` to show the attachment picker
- append `&tree=1` to show the mobile Explorer folder sheet

The canonical attachment picker and Windows-style VPS Explorer are represented
intentionally. No production source under `apps/window` is changed by this
mockup package.

`capture.ps1` exports an exact viewport through Edge's browser protocol. It is
used only to create the PNG review images in `exports/`.
