"""Owner Ads reader contract.

The Ads workspace is a **reader**: it renders rows an earlier sync saved and
never calls the provider. This module owns the server half of that contract —
the reader names, their paths, and what each one needs before it can answer — so
the two halves cannot drift. The browser half is ``READER_PATHS`` and
``READER_REQUIREMENTS`` in ``web/js/ads/ads-source.js``, and the parity test in
``tests/test_owner_ads.py`` fails if the two lists diverge.

Why a stub is better than no route
----------------------------------

Without a route, ``/api/owner/ads/context`` falls through to the single-page
application's catch-all, which answers every unknown path with ``index.html``
and status 200. The browser is then left to guess what a page of HTML means: a
reader that has not been built, an expired owner session, or a deployment that
lost its API. A 501 with a JSON body says which one it is, and the workspace
renders "Not connected" naming the thing that is missing instead of an error it
cannot explain.

Nothing here reads the provider, holds a credential, or writes anything. The
rows arrive in a later phase, when the reporting import exists; these route
names and requirement sentences are the interface those imports will fill, and
the front-end is already rendering them.
"""

from __future__ import annotations

from typing import Any

# Frozen reader vocabulary. Order matches READER_PATHS in ads-source.js.
READERS: tuple[str, ...] = (
    "context",
    "overview",
    "entities",
    "creatives",
    "blogs",
    "tracking",
    "queue",
)

# Shown verbatim in the workspace's not-connected state, so a screen explains
# itself instead of only failing. Kept word-for-word in step with the browser.
READER_REQUIREMENTS: dict[str, str] = {
    "context": "the connected ad account, its currency, time zone and the reporting sync schedule",
    "overview": "a completed reporting sync for the selected window",
    "entities": "saved daily rows for campaigns, ad sets and ads",
    "creatives": "saved creative rows joined to their ad and generation prompt",
    "blogs": "the site's own analytics joined to this account's tracking parameters",
    "tracking": "the account's UTM templates and the destination history",
    "queue": "the publishing queue and its attempt history",
}

# The status the browser maps to "Not connected". 501 is the honest code for
# "this route exists in the contract and is not implemented in this build".
NOT_IMPLEMENTED = 501


def envelope(reader: str) -> dict[str, Any]:
    """The typed answer for a reader that has no rows yet.

    The shape matches the reporting envelope the workspace already unpacks, so a
    future implementation replaces the body rather than the contract.
    """
    return {
        "status": "not_connected",
        "reader": reader,
        "detail": READER_REQUIREMENTS.get(reader, "a completed reporting sync"),
        "data": None,
        "fetchedAt": None,
        "origin": "live",
        "cached": False,
    }


def create_blueprint():
    """The unauthenticated-by-design, read-only reader routes.

    The owner session boundary is enforced by the edge in front of this
    application, exactly as it is for every other owner route.
    """
    from flask import Blueprint, jsonify

    api = Blueprint("owner_ads", __name__)

    @api.get("/api/owner/ads/<reader>")
    def owner_ads_reader(reader: str):
        if reader not in READERS:
            return jsonify({"status": "error", "detail": f"unknown ads reader: {reader}"}), 404
        response = jsonify(envelope(reader))
        # A missing reader is a fact about this build, not something to cache.
        response.headers["Cache-Control"] = "no-store"
        return response, NOT_IMPLEMENTED

    return api
