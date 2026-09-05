# Frank development and extension guide

All project work runs on the VPS in `/projects/frank`. Frank is a Window and
Hub; Hermes owns reasoning, model selection, tools, skills, memory, sessions,
and execution. Do not add a second agent loop, transcript store, or provider
runtime to Frank.

## Verification

Use the system Python that has the Window requirements installed, normally
`/usr/local/bin/python` on the VPS. To use an isolated environment, create it
outside the repository, for example `/srv/frank/venvs/window`, and install the
declared requirements there:

```bash
cd /projects/frank/apps/window
PYTHON_BIN=/usr/local/bin/python
$PYTHON_BIN -m venv /srv/frank/venvs/window
/srv/frank/venvs/window/bin/python -m pip install -r requirements.txt
npm ci --ignore-scripts
PATH=/srv/frank/venvs/window/bin:$PATH npm run verify
```

The acceptance Playwright environment is browser-only and is not a substitute
for the Python unit-test environment. The runner creates temporary chat and
Mini roots, compiles Python, checks every non-vendored JavaScript/MJS file, and
runs non-browser JavaScript tests. Browser checks and the container build remain
separate release checks.

## Add a Tool

A Tool is a data-defined package at `apps/window/tools/<tool-id>/`. Start by
copying the shape of an existing Tool, then add both:

- `manifest.json`: the versioned
  `schema://frank.tool-app-manifest/v1` declaration, including allowed scopes,
  settings, and declarative pipelines.
- `home.json`: the tool-owned, declarative Home record. It may only reference
  widget IDs already registered by the shared Window catalog.

Discovery is file-based and fail-closed: `tool_apps/contracts.py`,
`tool_apps/home_manifest.py`, and `tool_apps/discovery_adapter.py` read and
validate those JSON files without importing or executing the Tool. A Tool
cannot register arbitrary browser code, credentials, provider calls, or
callbacks through a manifest.

A standard Home card needs no new browser JavaScript: add its canonical catalog
record in `home_platform.py` and a read-only snapshot provider registered with
`@register(...)` in `home_providers.py`; `homes.js` renders the generic
snapshot contract. Add a special renderer to `web/js/homes.js` only when the
standard snapshot cannot represent it. Static shell tiles are optional and use
`define(...)` in `web/js/widgets.js` plus the shared fail-isolated
`web/js/registry.js`; they are separate from dashboard cards and must not
bypass Hermes. Every card renders explicit ready, empty, attention,
unavailable, or error states. It must not fabricate data, execute Tool work, or
bypass Hermes. Graph views use maxGraph, G6, Sigma, or Mermaid only as
read-only renderers for authoritative projections.

Focused validation while developing a Tool or Home:

```bash
cd /projects/frank/apps/window
/usr/local/bin/python -m unittest tests.test_tool_app_contract tests.test_tool_discovery tests.test_home_platform
node --check web/js/widgets.js
```

## Add a project

Use the existing New Project UI and Hermes session boundary. Frank records safe
project metadata, asks Hermes to create the one authoritative session in the
`default` profile, and binds it to `/projects/<project-id>`. Hermes owns the
workspace, session lifecycle, transcript history, and execution; Frank keeps
only the navigation association.

Project metadata editing and project archive are not implemented yet. Do not
document, simulate, or add those operations as though they exist; their policy
and lifecycle need a separate product change.
