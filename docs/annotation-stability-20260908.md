# Annotation stability, 2026-09-08

Dated task evidence, not an alternative release policy.

The review toolbar could scroll out of view. The action footer also extended
outside the review pane and could cover artwork. The toolbar now remains
reachable while reviewing the image; actions remain below the artwork.
Mobile image sizing accounts for the available review space.

A local `revision_requested` marker survived after the authoritative run became
`ready_for_review`. Queue/actions and annotation controls consequently disagreed.
A polling completion also needed to update the selected review, not just its
queue. Regression coverage includes completion without refreshing the page.

Isolated browser evidence is stored in
`/srv/frank/data/window/evidence/annotation-stability-20260908/browser.json`.
The fixture uses no provider calls and publishes nothing. Real ad artwork and
approval state are not changed by this UI release.

Pre-release verification: 1,077 Python tests (11 skipped) and 168 JavaScript
tests passed. Isolated browser journeys passed at 1280x900, 390x900 and
2560x1366, including click/drag annotations, placement switching, removal,
draft preservation, safe correction payloads, processing locks, history,
undo and automatic return to review after both correction and undo.

## Live acceptance

Deployed `c9a581829c5dcf4d651010f69c5ae4f169a57bef` through the canonical
immutable-revision release command. Window health and post-deploy reconciliation
passed. Image digest:
`sha256:853171a85796d5073ed4a27672277bb55d0b3a1997b68b9fdac25b7f78c1d206`.
Rollback remains `1a2e59e269fa4a364a4ce70713ea7e41a0bae41b`.

On the signed-in Chrome review at `https://frank.fail/ad-template-generator`,
verified the v3 assets, ready queue, enabled Annotate control, creation of one
unsent marked area and focus in its correction field. Removed that temporary
test mark and exited annotation mode. No correction was submitted or published.
The existing run remained ready with its unchanged update timestamp.
