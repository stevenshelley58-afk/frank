"""Which document answers a Window page request: the owner shell or the vanilla Window.

The React owner shell built from ``apps/window/ui`` is Frank's front door and is
served at the owner routes themselves. The vanilla Window keeps every other
route until those views are converted, so exactly one place has to decide which
index document a page request gets.

The grammar here mirrors ``OWNER_SECTIONS``, ``OWNER_CUSTOMER_SEGMENT`` and
``validId`` in ``apps/window/web/js/view-routing.js``: a section is always one of
a fixed allowlist, and the only variable segment is an opaque customer
identifier. Keep the two in step, or a deep link resolves on one side only.

The split is not path-only: the vanilla Window still owns the technical view of
the Blockwise project at ``?technical=1``, which is the same address as the
owner home. ``isOwnerDashboardProject`` in ``view-routing.js`` reads that flag
the same way, so the two sides agree on which surface a link opens.

Everything in this module is pure and free of Flask, so the grammar is testable
on its own and the server keeps no second copy of it.
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import parse_qsl

OWNER_SHELL_PROJECT = "blockwise"
OWNER_SHELL_SECTIONS = frozenset({
    "mail", "crm", "support", "campaigns", "ads", "revenue", "results", "notifications",
})
OWNER_SHELL_CUSTOMER_SEGMENT = "customer"
OWNER_SHELL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._~-]{0,127}")

#: Query flag that keeps a request on the vanilla Window.
TECHNICAL_VIEW_PARAM = "technical"
TECHNICAL_VIEW_VALUE = "1"

#: Directory of the built owner shell, relative to the served web root.
OWNER_SHELL_DIR = "ui"
#: Index document filename used by both bundles.
INDEX_DOCUMENT = "index.html"


def owner_shell_route(path: str) -> bool:
    """Return True when this request path belongs to the owner shell.

    Leading and trailing slashes are tolerated so a caller may pass either the
    Flask catch-all variable or a full pathname. Everything outside the
    allowlist is False, including an unknown section, another project, and a
    customer path carrying more than one identifier, so the vanilla Window keeps
    every other route rather than losing one to a typo.
    """
    candidate = str(path or "").strip("/")
    if candidate == "":
        return True
    segments = candidate.split("/")
    if len(segments) < 2 or segments[0] != "project" or segments[1] != OWNER_SHELL_PROJECT:
        return False
    if len(segments) == 2:
        return True
    if len(segments) == 3:
        return segments[2] in OWNER_SHELL_SECTIONS
    if len(segments) == 4:
        return (
            segments[2] == OWNER_SHELL_CUSTOMER_SEGMENT
            and OWNER_SHELL_ID.fullmatch(segments[3]) is not None
        )
    return False


def technical_view(query: str | bytes | None) -> bool:
    """Return True when this query string asks for the vanilla technical view.

    Only the exact value "1" counts, and only the first ``technical`` parameter
    is read, so this matches what ``new URLSearchParams(search).get("technical")``
    gives ``isOwnerDashboardProject`` in ``view-routing.js``. A leading "?" is
    tolerated so a caller may pass either a raw query string or a full search.
    """
    if query is None:
        return False
    if isinstance(query, bytes):
        query = query.decode("utf-8", "replace")
    raw = str(query)
    if raw.startswith("?"):
        raw = raw[1:]
    for name, value in parse_qsl(raw, keep_blank_values=True):
        if name == TECHNICAL_VIEW_PARAM:
            return value == TECHNICAL_VIEW_VALUE
    return False


def owner_shell_index(web_root: Path) -> Path | None:
    """Return the built owner-shell index, or None when no bundle is present.

    A dev checkout without a built bundle still has to work, so the caller falls
    back to the vanilla Window index instead of failing the request.
    """
    candidate = Path(web_root).resolve() / OWNER_SHELL_DIR / INDEX_DOCUMENT
    return candidate if candidate.is_file() else None


def resolve_spa_document(web_root: Path, path: str, query: str | bytes = "") -> tuple[Path, str]:
    """Return the directory and filename to serve for a Window page request.

    A real file under ``web_root`` wins, so static assets keep being served as
    themselves. Otherwise an owner-shell route gets the React index when the
    bundle is built, and everything else gets the vanilla Window index.

    ``?technical=1`` keeps an owner-shell route on the vanilla Window, because
    the technical view of the Blockwise project shares its address with the
    owner home. That also means the classic hub stays reachable two ways: at
    "/hub", and at "/?technical=1".

    A path that escapes ``web_root``, by traversal or by an absolute segment,
    never names a file here: it falls through to the vanilla index, and the
    caller is free to reject it earlier with its own error.
    """
    root = Path(web_root).resolve()
    requested = str(path or "").strip("/")
    if requested:
        candidate = (root / requested).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return root, INDEX_DOCUMENT
        if candidate.is_file():
            return candidate.parent, candidate.name
    if owner_shell_route(requested) and not technical_view(query):
        shell = owner_shell_index(root)
        if shell is not None:
            return shell.parent, shell.name
    return root, INDEX_DOCUMENT
