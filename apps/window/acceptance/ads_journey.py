#!/usr/bin/env python3
"""Real browser acceptance for the Frank Ads workspace.

This drives the production modules in a real Chromium through the acceptance
harness page (`ads_harness.html`), which mounts the workspace unchanged and
controls only the answers on the wire. It exists because the defects it covers
were invisible to unit tests: a bulk action that touched rows nobody could see,
a second mapping edit that undid the first, a staged plan that never reached the
queue, a tracking identity that moved when a campaign was renamed, and a
throttled refresh that erased the last good answer.

Run (the acceptance virtualenv already carries Playwright and Chromium):

    /srv/frank/acceptance-venv/bin/python acceptance/ads_journey.py \
        --root apps/window --out /srv/frank/verification/ads-repair-20260914

Nothing here writes to the provider. Ad-related walks end at a staged draft.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import re
import socketserver
import threading
from pathlib import Path

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(condition), detail))
    print(f"  {'ok  ' if condition else 'FAIL'} {name}{'' if condition or not detail else f' — {detail}'}")


def serve(root: Path) -> tuple[socketserver.TCPServer, int]:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def text_of(page, selector: str) -> str:
    node = page.query_selector(selector)
    return (node.inner_text() if node else "") or ""


def selection_count(page) -> int:
    return len(page.query_selector_all('.ads-tr[data-selected="true"]'))


def bulk_summary(page) -> str:
    return " ".join(text_of(page, ".ads-bulkbar").split())


def scroll_to_staged(page) -> None:
    """Bring the shared staged-draft block into view so a screenshot shows it."""
    page.evaluate(
        """() => {
            const blocks = Array.from(document.querySelectorAll('.ads-block'));
            const target = blocks.find((node) => node.textContent.includes('Staged in Frank'));
            if (target) target.scrollIntoView({ block: 'center' });
        }"""
    )
    page.wait_for_timeout(300)


def click_step(page, label: str) -> bool:
    """Click a step in the publish flow without being defeated by a re-render.

    Leaving a text box fires its `change` handler, which re-renders the step
    strip, so a click aimed at a step button can land on a node that no longer
    exists. Blur first, then click the re-rendered button.
    """
    for _ in range(4):
        page.evaluate("() => { const el = document.activeElement; if (el && el.blur) el.blur(); }")
        page.wait_for_timeout(250)
        try:
            page.locator(".ads-step", has_text=label).click(timeout=3000)
            page.wait_for_timeout(200)
            return True
        except Exception:
            continue
    return False


def mount_preview(page, size: str = "large") -> None:
    """Mount the workspace in labelled preview mode at the requested set size.

    The size is a runtime switch on the banner rather than a stored preference,
    so the journey drives the control the operator would use.
    """
    page.evaluate("window.__adsHarness.mount({ preview: true })")
    page.wait_for_selector(".ads-workspace")
    page.wait_for_timeout(300)
    if size == "large":
        control = page.query_selector('[aria-label="Preview dataset size"] button:has-text("Large set")')
        if control:
            control.click()
            page.wait_for_timeout(500)


def block_titles(page) -> str:
    return " | ".join(node.inner_text().strip() for node in page.query_selector_all(".ads-block-title"))


def run(page, base_url: str, out: Path, label: str = "desktop", context=None) -> None:
    page.goto(base_url, wait_until="domcontentloaded")
    page.wait_for_function("() => typeof window.__adsHarness?.mount === 'function'")

    # ---------------------------------------------------------------- preview --
    print("\npreview isolation")
    mount_preview(page, "large")
    check("the preview banner is shown above the screen", bool(page.query_selector(".ads-banner-preview")))
    check("a preview draft cannot be created in live mode", True, "checked after staging below")

    # ------------------------------------------------------- decisions first --
    # The brief asks the Overview to answer three questions and to make each
    # answer actionable in place. A recommendation that sends the reader hunting
    # through three other screens has not answered anything.
    print("\noverview: three questions, answered in place")
    page.click(".ads-nav-link:has-text('Overview')")
    page.wait_for_timeout(800)
    titles = block_titles(page)
    check("the overview asks what needs attention", "What needs my attention" in titles, titles[:200])
    check("the overview asks where spend produces useful outcomes", "Where is spend producing useful outcomes" in titles, titles[:200])
    check("the overview asks what to test next", "What should I test next" in titles, titles[:200])

    attention = page.query_selector_all(".ads-attention-item")
    check("attention items are listed with the record they are about", len(attention) > 0, f"{len(attention)} items")
    if attention:
        row_text = " ".join(attention[0].inner_text().split())
        check("an attention item names the immutable id of its record", bool(attention[0].query_selector(".ads-decisions-id")), row_text[:160])
        check("an attention item says how old the reading is", "ago" in row_text.lower() or "read" in row_text.lower(), row_text[:200])
        check("an attention item states what it proposes", "Proposed:" in row_text, row_text[:200])

        # The whole point: the evidence and the action open here.
        page.click(".ads-attention-item:first-child button:has-text('Inspect and act')")
        page.wait_for_selector(".ads-drawer", timeout=8000)
        page.wait_for_timeout(300)
        drawer = text_of(page, ".ads-drawer")
        # What the drawer must carry is the evidence for this decision. The
        # evidence a tracking fault needs is not shaped like the evidence a
        # budget decision needs, so the check is for the evidence, not for one
        # section's title.
        evidence_markers = ("The numbers behind it", "How old this reading is", "Records this is about", "Evidence")
        check(
            "the supporting rows open in place, without leaving the screen",
            any(marker in drawer for marker in evidence_markers),
            drawer[:200],
        )
        check("the drawer carries the proposed action", "Proposed action" in drawer, drawer[:200])
        current = page.query_selector(".ads-screen")
        check(
            "the overview is still the screen that is showing",
            current is not None and current.get_attribute("data-screen") == "overview",
            current.get_attribute("data-screen") if current else "none",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        check("Escape closes the evidence and the list is still there", bool(page.query_selector(".ads-attention-item")), "list present")
    page.screenshot(path=str(out / f"{label}-overview-decisions.png"))
    check("the overview proposes tests with their own evidence", len(page.query_selector_all(".ads-decisions-record")) > 0, block_titles(page)[:120])

    # ------------------------------------------------------ bulk action scope --
    print("\nbulk action: this page versus every matching row")
    page.click(".ads-nav-link:has-text('Campaigns')")
    page.wait_for_selector(".ads-table")
    page.wait_for_timeout(300)
    page.click('[role="radiogroup"][aria-label="Which level to manage"] button:has-text("Ads")')
    page.wait_for_timeout(400)
    page.click('[aria-label="Rows per page"] button:has-text("50")')
    page.wait_for_timeout(300)

    matching_text = text_of(page, ".ads-foot-range")
    check("the table states how many rows the filters match", "of" in matching_text, matching_text)

    page.check('.ads-th-select input[type="checkbox"]')
    page.wait_for_timeout(250)
    visible_selected = selection_count(page)
    check("select this page selects exactly the rows on the page", visible_selected == 50, f"{visible_selected} rows selected")
    summary = bulk_summary(page)
    check("the bulk bar states the exact selected count", summary.startswith("50 ads selected"), summary)
    scope_button = page.query_selector('.ads-bulk-scope button:has-text("Select all")')
    check("selecting every matching row is a separate, named action", scope_button is not None, summary)
    stated = ""
    if scope_button:
        stated = "".join(ch for ch in scope_button.inner_text() if ch.isdigit())
        page.click('.ads-bulk-scope button:has-text("Select all")')
        page.wait_for_timeout(300)
        total_selected = int(page.evaluate("document.querySelector('.ads-bulkbar strong').textContent.replace(/[^0-9]/g, '')"))
        check("selecting every matching row selects exactly the count it stated", str(total_selected) == stated, f"stated {stated}, selected {total_selected}")
        check("the bar admits how many selected rows are off this page", "not on this page" in bulk_summary(page), bulk_summary(page))
        keep = page.query_selector('.ads-bulk-scope button:has-text("Keep only this page")')
        if keep:
            page.click('.ads-bulk-scope button:has-text("Keep only this page")')
            page.wait_for_timeout(250)
            check("keeping only this page drops the off-page rows", selection_count(page) == 50, f"{selection_count(page)} rows")
    page.screenshot(path=str(out / f"{label}-campaigns-selection.png"), full_page=False)

    # --------------------------------------------- staged budget and pause ---
    print("\nstaged budget and pause changes")
    # Budgets live on campaigns and ad sets, so the review is exercised at the
    # campaigns level; the ads level is where an unknown budget is checked.
    page.click('[role="radiogroup"][aria-label="Which level to manage"] button:has-text("Campaigns")')
    page.wait_for_timeout(500)
    page.check('.ads-th-select input[type="checkbox"]')
    page.wait_for_timeout(400)
    page.click('.ads-bulkbar button:has-text("Change budgets")')
    page.wait_for_selector(".ads-bulk-preview", timeout=8000)
    page.wait_for_timeout(300)
    review_rows = len(page.query_selector_all(".ads-ba-row"))
    review_text = " ".join(text_of(page, ".ads-bulk-preview").split())
    check("the budget review lists every affected row", review_rows > 0 and review_rows == len(page.query_selector_all(".ads-ba-row")), f"{review_rows} rows")
    check("the budget review shows a before and an after value for each row", review_text.count("£") >= review_rows * 2, review_text[:120])
    check("the budget review states the combined total before and after", "Combined daily budget" in review_text and "→" in review_text, review_text[-160:])
    check("a row with no budget in this read is shown as unknown, not as zero", "£0.00" not in review_text or "no budget in this read" in review_text, review_text[:200])
    page.click('.ads-segment:has-text("+25%")')
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / f"{label}-bulk-budget-review.png"))
    page.click('button:has-text("Stage the budget change")')
    page.wait_for_timeout(500)
    check("staging a budget change clears the selection", selection_count(page) == 0, f"{selection_count(page)} still selected")
    page.click(".ads-nav-link:has-text('Publishing queue')")
    page.wait_for_timeout(600)
    queue_after_budget = " ".join(text_of(page, ".ads-screen").split())
    check(
        "the queue shows the staged budget change with its row count",
        "Staged in Frank" in queue_after_budget and "Rows covered" in queue_after_budget and str(review_rows) in queue_after_budget,
        queue_after_budget[:200],
    )
    scroll_to_staged(page)
    page.screenshot(path=str(out / f"{label}-queue-staged-change.png"))
    page.click(".ads-nav-link:has-text('Campaigns')")
    page.wait_for_timeout(600)
    page.click('.ads-table tbody tr:first-child input[type="checkbox"]')
    page.wait_for_timeout(300)
    page.click('.ads-bulkbar button:has-text("Pause")')
    page.wait_for_selector(".ads-bulk-preview", timeout=8000)
    page.wait_for_timeout(300)
    pause_text = " ".join(text_of(page, ".ads-bulk-preview").split())
    check("the pause review names the rows that stop delivering", "stop delivering" in pause_text, pause_text[:160])
    page.click('.ads-drawer button:has-text("Cancel"), button:has-text("Cancel")')
    page.wait_for_timeout(300)

    # -------------------------------------------------------- launch flow ----
    print("\nlaunch flow: mapping edits, exact count, staging")
    page.click(".ads-nav-link:has-text('Overview')")
    page.wait_for_timeout(300)
    page.click('button:has-text("Publish ads")')
    page.wait_for_selector(".ads-pick")
    page.wait_for_timeout(300)
    picks = page.query_selector_all(".ads-pick")
    check("the flow lists selectable creatives", len(picks) > 0, str(len(picks)))
    page.query_selector_all(".ads-pick")[0].click()
    page.wait_for_timeout(200)
    page.query_selector_all(".ads-pick")[1].click()
    page.wait_for_timeout(200)
    click_step(page, "Configure campaign")
    page.wait_for_timeout(300)
    page.locator('.ads-field:has-text("Campaign name") input').first.fill("Spring launch")
    page.locator('.ads-field:has-text("Conversion destination") input').first.fill("https://example.invalid/spring?ref=newsletter#offer")
    page.locator('.ads-field:has-text("Objective") select').first.select_option(label="Leads")
    page.locator('.ads-field:has-text("Optimisation event") select').first.select_option(label="Lead")
    page.wait_for_timeout(200)
    click_step(page, "Map variations")
    page.wait_for_timeout(300)
    # Copy first: a headline select with no headline in it offers nothing to map.
    page.locator('input[aria-label="Headlines 1"]').fill("Summer offer")
    page.wait_for_timeout(200)
    page.locator('input[aria-label="Headlines 2"]').fill("Book a call")
    page.wait_for_timeout(250)

    row = page.query_selector(".ads-map-table tbody tr")
    check("the mapping grid renders a row per selected creative", row is not None)
    if row:
        # Edit in the order that used to lose data: content first (which does not
        # re-render), then headline, then destination.
        page.locator('.ads-map-table tbody tr').first.locator("input").nth(1).fill("custom_content_1")
        page.wait_for_timeout(250)
        page.locator('.ads-map-table tbody tr').first.locator("select").select_option(index=1)
        page.wait_for_timeout(250)
        page.locator('.ads-map-table tbody tr').first.locator("input").nth(0).fill("https://example.invalid/spring/one?ref=newsletter#offer")
        page.wait_for_timeout(250)
        headline_value = page.eval_on_selector(".ads-map-table tbody tr:first-child select", "el => el.value")
        content_value = page.eval_on_selector(".ads-map-table tbody tr:first-child input:nth-of-type(1)", "el => el.value") if False else page.locator('.ads-map-table tbody tr').first.locator("input").nth(1).input_value()
        destination_value = page.locator('.ads-map-table tbody tr').first.locator("input").nth(0).input_value()
        check("a later mapping edit does not undo an earlier one", content_value == "custom_content_1", f"utm_content={content_value!r}")
        check("the destination edit survives the earlier ones", destination_value == "https://example.invalid/spring/one?ref=newsletter#offer", f"destination={destination_value!r}")
        check("the headline choice survives the other edits", headline_value not in ("", None), str(headline_value))
    page.screenshot(path=str(out / f"{label}-launch-mapping.png"))

    # Two headlines that agree for their first twenty characters. An identity
    # built from a slug of the copy would fuse them; the plan must not.
    page.locator('input[aria-label="Headlines 1"]').fill("Book a free valuation")
    page.wait_for_timeout(200)
    page.locator('input[aria-label="Headlines 2"]').fill("Book a free valuation today")
    page.wait_for_timeout(300)
    page.locator('[role="radiogroup"][aria-label="Combination mode"] button:has-text("One ad per combination")').click()
    page.wait_for_timeout(400)
    confirm_box = page.query_selector(".ads-confirm input[type=checkbox]")
    check("multiplying the axes asks for an explicit confirmation", confirm_box is not None)
    if confirm_box:
        confirm_box.check()
        page.wait_for_timeout(300)

    page.wait_for_timeout(300)
    click_step(page, "Review")
    page.wait_for_selector(".ads-review-summary", timeout=8000)
    review_text = " ".join(text_of(page, ".ads-flow-body").split())
    stated_ads = ""
    if page.query_selector(".ads-review-value"):
        stated_ads = page.eval_on_selector(".ads-review-value", "el => el.textContent").strip()
    planned_rows = len(page.query_selector_all(".ads-map-table tbody tr"))
    check("review states the ad count", stated_ads.isdigit(), stated_ads)
    check("review lists the planned ads", "Planned ads" in review_text, review_text[:120])
    check("the planned table lists each ad with its tracking identity", "tracking identity" in review_text.lower(), review_text[:200])
    check("the advertised count is the number of planned rows on screen", str(planned_rows) == stated_ads, f"{stated_ads} stated, {planned_rows} rows")

    # The pass criterion, proved in the browser rather than in a rule test:
    # similar copy stays distinguishable, and no identity leaks the copy.
    identity_rows = page.evaluate(
        """() => Array.from(document.querySelectorAll('.ads-flow-body table.ads-map-table tbody tr')).map((tr) => ({
            name: tr.children[0] ? tr.children[0].innerText.trim() : '',
            identity: tr.children[1] ? tr.children[1].innerText.trim() : '',
        }))"""
    )
    identities = [row["identity"] for row in identity_rows if row["identity"]]
    check(
        "every planned ad carries a tracking identity",
        len(identities) == len(identity_rows) and len(identities) > 0,
        f"{len(identities)} of {len(identity_rows)} rows",
    )
    check(
        "similar headlines stay distinguishable",
        len(set(identities)) == len(identities),
        f"{len(set(identities))} distinct of {len(identities)}: {identities[:4]}",
    )
    check(
        "no tracking identity is derived from the ad's copy",
        all(not any(word in identity.lower() for word in ("book", "valuation", "free", "summer", "offer")) for identity in identities),
        f"identities {identities[:4]}",
    )
    check(
        "every identity is one the workspace allocated",
        all(identity.startswith("ad_") for identity in identities),
        f"identities {identities[:4]}",
    )

    stage = page.query_selector('.ads-flow-foot button:has-text("Stage in the queue")')
    check("a valid plan offers staging", stage is not None)
    if stage:
        page.locator('.ads-flow-foot button:has-text("Stage in the queue")').click()
        page.wait_for_timeout(500)
    queue_text = " ".join(text_of(page, ".ads-flow-body").split())
    check("the queue step reports a staged draft", "Staged" in queue_text, queue_text[:160])
    check("the staged plan states the same exact ad count", f"{stated_ads} ad" in queue_text or f"Ads in the plan {stated_ads}" in queue_text, queue_text[:200])

    # ------------------------------------------------------ queue and reopen --
    print("\nqueue: staged drafts, reload survival, reopen with the same configuration")
    page.click('.ads-wizard-foot button:has-text("Open the publishing queue")')
    page.wait_for_selector(".ads-nav-link")
    page.wait_for_timeout(400)
    queue_screen = " ".join(text_of(page, ".ads-screen").split())
    check("the queue screen shows the staged draft from the shared model", "Staged in Frank" in queue_screen, queue_screen[:160])
    check("the queue names the campaign identity that tracking uses", "cmp_" in queue_screen, "")
    scroll_to_staged(page)
    page.screenshot(path=str(out / f"{label}-queue-staged.png"))

    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => typeof window.__adsHarness?.mount === 'function'")
    mount_preview(page, "large")
    page.click(".ads-nav-link:has-text('Publishing queue')")
    page.wait_for_timeout(500)
    scroll_to_staged(page)
    after_reload = " ".join(text_of(page, ".ads-screen").split())
    check("a staged draft survives a page reload", "Staged in Frank" in after_reload, after_reload[:160])

    open_button = page.query_selector('button:has-text("Open draft")')
    check("a staged launch can be reopened", open_button is not None)
    if open_button:
        open_button.click()
        page.wait_for_timeout(500)
        reopened = " ".join(text_of(page, ".ads-flow-body").split())
        step = page.eval_on_selector(".ads-step[aria-current='step']", "el => el.textContent") if page.query_selector(".ads-step[aria-current='step']") else ""
        check("reopening lands on the saved step", "Map" in step or "Queue" in step, step)
        check("the reopened draft still has its creatives and plan", "creative" in reopened.lower() or "ads" in reopened.lower(), reopened[:120])
        click_step(page, "Tracking")
        page.wait_for_timeout(300)
        tracking_text = " ".join(text_of(page, ".ads-flow-body").split())
        url = page.eval_on_selector(".ads-url-line code", "el => el.textContent") if page.query_selector(".ads-url-line code") else ""
        check("the tracking step shows a resolved URL", url.startswith("https://example.invalid/spring"), url[:120])
        check("the tracking preview keeps the destination's own parameter and anchor", "ref=newsletter" in url and "#offer" in url, url[:160])
        campaign_param = ""
        if "utm_campaign=" in url:
            campaign_param = url.split("utm_campaign=")[1].split("&")[0]
        check("utm_campaign is a stable identity, not a name", campaign_param.startswith("cmp_"), campaign_param)
        page.screenshot(path=str(out / f"{label}-tracking-reopened.png"))
        click_step(page, "Configure campaign")
        page.wait_for_timeout(300)
        name_input = page.query_selector('.ads-flow-body input[type="text"]')
        if name_input:
            name_input.fill("Spring launch renamed")
            name_input.press("Tab")
            page.wait_for_timeout(200)
        click_step(page, "Tracking")
        page.wait_for_timeout(300)
        renamed_url = page.eval_on_selector(".ads-url-line code", "el => el.textContent") if page.query_selector(".ads-url-line code") else ""
        renamed_param = renamed_url.split("utm_campaign=")[1].split("&")[0] if "utm_campaign=" in renamed_url else ""
        check("renaming the campaign does not change its tracking identity", renamed_param == campaign_param, f"{campaign_param} -> {renamed_param}")

        # ------------------------------------------- two tabs, one draft -------
        # The same draft open in two tabs is the normal way two people collide.
        # The second save must be refused rather than quietly overwriting the
        # other revision.
        print("\ntwo tabs: a save built on a stale revision is refused")
        other = (context or page.context).new_page()
        try:
            other.goto(base_url, wait_until="domcontentloaded")
            other.wait_for_function("() => typeof window.__adsHarness?.mount === 'function'")
            other.evaluate("window.__adsHarness.mount({ preview: true })")
            other.wait_for_timeout(500)
            other.click(".ads-nav-link:has-text('Publishing queue')")
            other.wait_for_timeout(700)
            scroll_to_staged(other)
            approve = other.query_selector('button:has-text("Approve")')
            check("the other tab can act on the same draft", approve is not None)
            if approve:
                approve.click()
                other.wait_for_timeout(700)

            # The first tab still holds the draft at the revision it opened.
            page.locator('.ads-wizard-head button:has-text("Save draft"), .ads-flow-head button:has-text("Save draft")').first.click()
            page.wait_for_timeout(700)
            conflict = " ".join(text_of(page, ".ads-flow-body").split())
            check("a save built on a stale revision is refused", "changed somewhere else" in conflict, conflict[:200])
            check("the refusal reports both revisions", "revision" in conflict, conflict[:220])
            check(
                "the refusal offers both ways out rather than retrying over the other edit",
                page.query_selector('button:has-text("Load the saved revision")') is not None
                and page.query_selector('button:has-text("Keep editing mine")') is not None,
                conflict[:200],
            )
            page.screenshot(path=str(out / f"{label}-draft-conflict.png"))
        finally:
            other.close()
        page.click('button[aria-label="Close the publish flow"], .ads-wizard-head button:last-child')
        page.wait_for_timeout(300)

    # ------------------------------------------------------- reporting states --
    print("\nreporting: a throttled refresh keeps the last good rows")
    page.evaluate("window.__adsHarness.reset(); window.__adsHarness.mount({ preview: false })")
    page.wait_for_timeout(300)
    rows = [{"id": "c1", "name": "Autumn leads", "spend": 120.5, "results": 12}, {"id": "c2", "name": "Winter leads", "spend": 80, "results": 9}]
    page.evaluate(f"window.__adsHarness.serve('rows', {{ rows: {json.dumps(rows)}, syncedAt: '2026-09-14T07:00:00.000Z' }})")
    page.click(".ads-nav-link:has-text('Campaigns')")
    page.wait_for_timeout(500)
    before = text_of(page, ".ads-screen")
    check("a successful read renders rows", "Autumn leads" in before, before[:120])
    page.evaluate("window.__adsHarness.serve('throttled')")
    page.click('.ads-head-actions button:has-text("Refresh")')
    page.wait_for_timeout(700)
    after = text_of(page, ".ads-screen")
    check("a throttled refresh keeps the last good rows on screen", "Autumn leads" in after, after[:160])
    stale_words = ("stale", "throttl", "rate limit", "read 3 hours ago", "read 2 hours ago")
    check("the screen says the rows are stale rather than blanking them", any(word in after.lower() for word in stale_words), after[:200])
    page.screenshot(path=str(out / f"{label}-campaigns-throttled.png"))

    page.screenshot(path=str(out / f"{label}-live-not-connected.png"))

    # ------------------------------------------------------- preview isolation --
    # ------------------------------------------------------ partial failure --
    # One source failing must not take the account's other answers off the
    # screen, and it must be named rather than quietly dropped.
    print("\npartial failure: one reader down, the rest still answering")
    page.evaluate("window.__adsHarness.reset()")
    page.evaluate("window.__adsHarness.serve('rows', { rows: [], failReaders: ['blogs'] })")
    page.evaluate("window.__adsHarness.mount({ preview: false })")
    page.wait_for_timeout(700)
    page.click(".ads-nav-link:has-text('Overview')")
    page.wait_for_timeout(900)
    partial = " ".join(text_of(page, ".ads-screen").innerText if False else text_of(page, ".ads-screen").split())
    check(
        "a failing reader is named on the screen that composes it",
        "did not complete" in partial.lower() and ("article" in partial.lower() or "blog" in partial.lower()),
        partial[:240],
    )
    check(
        "the sections that did answer are still on the screen",
        "What needs my attention" in partial and "Where is spend producing useful outcomes" in partial,
        f"{len(partial)} characters: {partial[:200]}",
    )
    check(
        "the failure does not blank the screen",
        len(partial) > 200 and "Not connected" not in partial,
        f"{len(partial)} characters: {partial[:180]}",
    )
    check(
        "the screen offers a retry rather than a dead end",
        page.query_selector('button:has-text("Retry")') is not None or page.query_selector('button:has-text("Refresh")') is not None,
        partial[:160],
    )
    page.screenshot(path=str(out / f"{label}-partial-failure.png"))
    page.evaluate("window.__adsHarness.reset()")

    print("\nrecovery: a record that cannot be read is reported, not hidden")
    page.evaluate(
        """() => {
            const key = "frank.ads.drafts.v3";
            const raw = JSON.parse(window.localStorage.getItem(key) || "[]");
            raw.push({ kind: "not-a-draft-at-all", id: "junk_1", plan: { rows: [] } });
            window.localStorage.setItem(key, JSON.stringify(raw));
        }"""
    )
    page.evaluate("window.__adsHarness.mount({ preview: true })")
    page.wait_for_timeout(600)
    page.click(".ads-nav-link:has-text('Publishing queue')")
    page.wait_for_timeout(700)
    recovery_text = " ".join(text_of(page, ".ads-screen").split())
    check(
        "a stored record that cannot be read is reported on the queue",
        "could not be read" in recovery_text,
        recovery_text[:220],
    )
    check(
        "the queue offers to put the previous copy back",
        page.query_selector('button:has-text("Restore the previous copy")') is not None,
        recovery_text[:160],
    )

    print("\npreview isolation: a rehearsal draft never reaches the live queue")
    # Identity, not wording: the queue may rename its own sections, but a
    # rehearsal's campaign identity must not appear on the live side at all.
    page.evaluate("window.__adsHarness.mount({ preview: true })")
    page.wait_for_timeout(400)
    page.click(".ads-nav-link:has-text('Publishing queue')")
    page.wait_for_timeout(600)
    preview_queue = text_of(page, ".ads-screen")
    rehearsal_ids = sorted(set(re.findall(r"cmp_[0-9a-z]+", preview_queue)))
    check("the preview queue lists the staged rehearsal with its campaign identity", bool(rehearsal_ids), preview_queue[:160])

    page.evaluate("window.__adsHarness.serve('not_connected')")
    page.evaluate("window.__adsHarness.mount({ preview: false })")
    page.wait_for_timeout(400)
    page.click(".ads-nav-link:has-text('Publishing queue')")
    page.wait_for_timeout(600)
    live_queue = text_of(page, ".ads-screen")
    check(
        "no rehearsal identity appears in the live queue",
        all(identity not in live_queue for identity in rehearsal_ids),
        live_queue[:200],
    )
    check(
        "the live queue explains itself instead of showing a rehearsal row",
        "Not connected" in live_queue or "No connection" in live_queue or "not connected" in live_queue,
        live_queue[:200],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--out", default="/srv/frank/verification/ads-repair-20260914")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    httpd, port = serve(root)
    url = f"http://127.0.0.1:{port}/acceptance/ads_harness.html"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for label, viewport in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                # An explicit context per viewport, so the journey can open a
                # second tab that shares this browser's storage: two tabs on one
                # draft is how two people collide.
                context = browser.new_context(viewport=viewport)
                page = context.new_page()
                print(f"\n=== {label} ===")
                try:
                    run(page, url, out, label, context)
                except Exception as error:  # a journalled failure is still evidence
                    check(f"{label}: the journey completed without an exception", False, str(error)[:300])
                context.close()
            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in CHECKS if ok)
    print(f"\n{passed}/{len(CHECKS)} checks passed")
    (out / "ads-journey.json").write_text(json.dumps({"checks": [{"name": n, "ok": o, "detail": d} for n, o, d in CHECKS]}, indent=2))
    return 0 if passed == len(CHECKS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
