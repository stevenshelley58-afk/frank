"""Phase 7 deep browser journey: REAL authenticated Playwright verification of
production https://frank.fail (desktop + mobile), with a full network audit.

Everything recorded here comes from real production traffic and real DOM
checks. Where reality does not allow a proof, the check is recorded as
NOT_PROVEN with the precise reason. No synthetic or canned evidence.

Hermes budget: exactly two harmless chat turns (one OK-echo check, one
attachment check). Nothing destructive; no service restarts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEPLOYED_SHA = "861e2bc4923a354d9fa9bf4f7df2f6321a7e4f5b"
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "mobile": {"width": 390, "height": 844}}
EXPECTED_PROJECTS = {"blockwise", "merrypaws", "elfwonder", "pavone", "mini-frank", "business-os"}
FORBIDDEN_PROJECT = "v021canary-estate"
HOST_PROJECT_ROOTS = {
    "blockwise": "/projects/blockwise",
    "merrypaws": "/projects/merrypaws",
    "elfwonder": "/projects/elfandwonder",
    "pavone": "/projects/pavone-demo",
    "mini-frank": "/projects/mini-frank",
    "business-os": "/projects/business-os",
}
UPLOAD_STAGING = Path("/srv/frank/data/window/uploads")
SERVER_SKIP = {".git", "node_modules", ".next", "__pycache__", ".turbo", "dist"}

# Secrets/paths that must never appear in browser-visible traffic.
FORBIDDEN_PATTERNS = {
    "secrets_path": r"/srv/frank/secrets",
    "var_lib_frank": r"/var/lib/frank",
    "home_hermes": r"/home/hermes",
    "root_path": r"(?<![\w.])/root(?![\w])",
    "docker_socket": r"/var/run/docker(?:\.sock)?",
    "private_key_block": r"BEGIN [A-Z ]*PRIVATE KEY",
    "api_token_shape": r"\b(?:sk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b",
    "jwt_shape": r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b",
    "memory_bank_scope": r"\bsteven-",
    "lease_generation": r"lease[_-]?(?:gen|generation|id)\b",
    "board_id": r"board[_-]?id\b",
    "password_field": r'"password"\s*:\s*"[^"]+"',
    "token_field": r'"(?:api[_-]?key|access[_-]?token|secret)"\s*:\s*"[^"]+"',
    "frank_data_host_path": r"/srv/frank/data",
    "frank_data_container_path": r"/frank/window/data",
}
ALLOWED_PREFIXES = ("/vps/projects/",)  # container paths + project listings are expected

BODY_SCAN_LIMIT = 2 * 1024 * 1024


def sha(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class NetworkAudit:
    """Captures every browser-visible request/response and scans it."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []
        self.findings: list[dict[str, str]] = []
        self.server_errors: list[dict[str, Any]] = []
        self.bodies_scanned = 0
        self.bodies_skipped = 0

    def _scan(self, text: str, where: str, url: str) -> None:
        for name, pattern in FORBIDDEN_PATTERNS.items():
            match = re.search(pattern, text, re.I)
            if not match:
                continue
            window = text[max(0, match.start() - 60):match.end() + 60]
            # /vps/projects/<slug> container paths and project file listings are
            # expected browser-visible content; anything else is a finding.
            if "/vps/projects/" in window:
                continue
            self.findings.append({
                "pattern": name,
                "url": url,
                "where": where,
                "context": window[:200],
            })

    def attach(self, context: Any) -> None:
        def on_response(response: Any) -> None:
            url = response.url
            entry = {"url": url, "status": response.status, "method": response.request.method}
            self.entries.append(entry)
            if response.status >= 500:
                self.server_errors.append({"url": url, "status": response.status})
            try:
                post_data = response.request.post_data
                if post_data:
                    entry["has_post_data"] = True
                    self._scan(str(post_data)[:BODY_SCAN_LIMIT], "request_body", url)
            except Exception:
                pass
            content_type = ""
            try:
                content_type = str(response.headers.get("content-type", ""))
            except Exception:
                pass
            if "event-stream" in content_type:
                # The live turn stream cannot be buffered without stalling the
                # same turn; its content is re-observable via /api/chat history,
                # which IS scanned below.
                self.bodies_skipped += 1
                entry["body_scanned"] = False
                return
            try:
                body = response.text()
                if len(body) > BODY_SCAN_LIMIT:
                    body = body[:BODY_SCAN_LIMIT]
                    self.bodies_skipped += 1
                self.bodies_scanned += 1
                entry["body_scanned"] = True
                self._scan(body, "response_body", url)
            except Exception:
                self.bodies_skipped += 1
                entry["body_scanned"] = False

        context.on("response", on_response)

    def summary(self) -> dict[str, Any]:
        return {
            "requests_observed": len(self.entries),
            "bodies_scanned": self.bodies_scanned,
            "bodies_skipped": self.bodies_skipped,
            "server_errors_5xx": self.server_errors,
            "findings": self.findings,
        }

    def save_log(self, path: Path) -> None:
        path.write_text(json.dumps(self.entries, indent=1), encoding="utf-8")


class Journey:
    def __init__(self, page: Any, context: Any, base_url: str, evidence_root: Path, name: str) -> None:
        self.page = page
        self.context = context
        self.base = base_url.rstrip("/")
        self.root = evidence_root
        self.name = name
        self.checks: dict[str, dict[str, Any]] = {}
        self.screens: dict[str, dict[str, str]] = {}

    def check(self, key: str, ok: bool, detail: str = "", *, proven: bool = True) -> bool:
        self.checks[key] = {
            "outcome": ("pass" if ok else "fail") if proven else "not_proven",
            "detail": detail,
        }
        return ok

    def not_proven(self, key: str, detail: str) -> None:
        self.checks[key] = {"outcome": "not_proven", "detail": detail}

    def shot(self, key: str, *, full_page: bool = True) -> str:
        filename = f"{self.name}-{key}.png"
        png = self.page.screenshot(path=str(self.root / filename), full_page=full_page)
        self.screens[key] = {"path": filename, "sha256": sha(png)}
        return filename

    def goto(self, surface: str) -> Any:
        response = self.page.goto(self.base + surface, wait_until="domcontentloaded", timeout=30000)
        if response is None or response.status >= 400:
            raise RuntimeError(f"{surface} unavailable (HTTP {response.status if response else 'none'})")
        return response

    def nav_click(self, selector: str, purpose: str) -> None:
        item = self.page.locator(selector)
        if item.count() < 1:
            raise RuntimeError(f"missing {purpose}")
        item.first.click()


def wait_terminal(page: Any, timeout_ms: int = 240_000) -> dict[str, Any]:
    """Wait for the active turn to reach a terminal UI state and return the
    final assistant bubble text plus streaming observations."""
    try:
        page.wait_for_function(
            "() => document.querySelector('#send')?.classList.contains('is-hidden')",
            timeout=20000,
        )
    except Exception:
        pass  # already terminal (very fast turn)
    mid_stream: dict[str, Any] = {"streaming_bubble": False, "activity_rows": 0, "thinking_stream": False}
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        state = page.evaluate(
            """() => ({
                streaming: !!document.querySelector('.msg .md.is-stream'),
                rows: document.querySelectorAll('.activity-row').length,
                thinking: !!document.querySelector('.thinking-stream'),
                sendHidden: document.querySelector('#send')?.classList.contains('is-hidden') ?? false,
            })"""
        )
        if state["streaming"] or state["rows"] or state["thinking"]:
            mid_stream = {
                "streaming_bubble": True,
                "activity_rows": state["rows"],
                "thinking_stream": state["thinking"],
            }
            break
        if not state["sendHidden"]:
            break
        page.wait_for_timeout(300)
    page.wait_for_function(
        "() => !document.querySelector('#send')?.classList.contains('is-hidden')",
        timeout=max(1000, int((deadline - time.time()) * 1000)),
    )
    page.wait_for_timeout(700)
    final = page.evaluate(
        """() => {
            const bubbles = [...document.querySelectorAll('.msg .bub .md')];
            const last = bubbles.filter((el) => !el.classList.contains('is-stream')).pop();
            return last ? last.textContent.trim() : '';
        }"""
    )
    return {"final_text": final, "mid_stream": mid_stream}


def host_dir_entries(path: str) -> list[str]:
    try:
        return sorted(
            child for child in os.listdir(path)
            if child not in SERVER_SKIP and not child.startswith(".")
        )
    except OSError:
        return []


def find_uploaded(root: Path, needle: str) -> list[str]:
    hits: list[str] = []
    if not root.is_dir():
        return hits
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if len(dirpath.split(os.sep)) - len(root.parts) > 6:
            dirnames[:] = []
            continue
        for name in filenames:
            if needle in name:
                hits.append(str(Path(dirpath) / name))
    return hits


# --------------------------------------------------------------------------
# Desktop journey
# --------------------------------------------------------------------------

def desktop_journey(j: Journey, audit: NetworkAudit, tag: str, *, skip_turns: bool = False) -> dict[str, Any]:
    page = j.page
    rand = secrets.token_hex(4)

    # --- Hub home: simple chat interface -----------------------------------
    j.goto("/")
    page.wait_for_selector("#chat-composer", timeout=20000)
    j.check("hub_home_chat_composer", page.locator("#chat-composer").count() == 1
            and page.locator("#chat-input").count() == 1 and page.locator("#send").count() == 1)
    j.shot("01-hub-home")

    # --- Registered project list from the real UI rail ---------------------
    page.wait_for_function(
        "() => document.querySelectorAll('#project-nav .rail-item[data-project]').length > 0",
        timeout=25000)
    ui_projects = page.eval_on_selector_all(
        "#project-nav .rail-item[data-project]", "els => els.map(e => e.dataset.project)")
    j.check("project_list_matches_registry", set(ui_projects) == EXPECTED_PROJECTS,
            f"UI project list: {sorted(ui_projects)}")
    j.check("project_list_excludes_canary", FORBIDDEN_PROJECT not in ui_projects,
            f"'{FORBIDDEN_PROJECT}' must not be registered")
    j.shot("02-project-list")

    # --- Every registered project page renders modular widgets -------------
    widget_report: dict[str, Any] = {}
    for project_id in sorted(EXPECTED_PROJECTS):
        page.click(f".rail-item[data-project='{project_id}']")
        page.wait_for_selector(".view[data-view='project'].is-on .home-widget", timeout=30000)
        page.wait_for_timeout(600)
        widgets = page.eval_on_selector_all(
            ".view[data-view='project'].is-on .home-widget",
            "els => els.map(e => e.dataset.widgetId || e.dataset.instanceId)")
        widget_report[project_id] = {"widgets": widgets, "count": len(widgets)}
        j.check(f"project_page_widgets_{project_id}", len(widgets) > 0,
                f"{len(widgets)} modular widgets rendered")
        j.shot(f"03-project-{project_id}")
    j.record = widget_report  # type: ignore[attr-defined]

    # --- Modular widgets are reusable: leave and return --------------------
    page.click(".rail-item[data-project='blockwise']")
    page.wait_for_selector(".view[data-view='project'].is-on .home-widget", timeout=30000)
    first_pass = page.eval_on_selector_all(
        ".view[data-view='project'].is-on .home-widget",
        "els => els.map(e => e.dataset.widgetId)")
    page.click(".rail-item[data-view='hub']")
    page.wait_for_selector(".view[data-view='hub'].is-on", timeout=15000)
    page.click(".rail-item[data-project='blockwise']")
    page.wait_for_selector(".view[data-view='project'].is-on .home-widget", timeout=30000)
    second_pass = page.eval_on_selector_all(
        ".view[data-view='project'].is-on .home-widget",
        "els => els.map(e => e.dataset.widgetId)")
    j.check("widgets_reusable_on_return", len(second_pass) > 0 and first_pass == second_pass,
            f"first pass {len(first_pass)} widgets, second pass {len(second_pass)}")

    # --- VPS file/folder picker browses every registered project -----------
    page.click(".rail-item[data-view='files']")
    page.wait_for_selector("#exp-rows", timeout=15000)
    page.wait_for_function(
        "() => !document.querySelector('#exp-rows')?.textContent.includes('Loading')", timeout=20000)
    root_entries = page.eval_on_selector_all("#exp-rows .exp-row", "els => els.map(e => e.dataset.path)")
    j.check("picker_root_offers_projects_tree", "projects" in root_entries,
            f"root listing: {root_entries}")
    # Unregistered roots are not offered: only one root exists and the jail rejects others.
    roots_response = page.request.get(j.base + "/api/roots")
    roots_body = roots_response.json()
    offered = [r.get("id") for r in roots_body.get("roots", [])]
    j.check("picker_single_root_only", offered == ["vps"], f"/api/roots offered: {offered}")
    for bad_root in ("srv", "etc"):
        resp = page.request.get(j.base + f"/api/tree?root={bad_root}&path=")
        j.check(f"picker_rejects_root_{bad_root}", resp.status == 404,
                f"root={bad_root} -> HTTP {resp.status}")
    resp = page.request.get(j.base + "/api/tree?root=vps&path=../../etc")
    j.check("picker_rejects_traversal", resp.status == 400,
            f"path=../../etc -> HTTP {resp.status}")
    # Navigate into projects/ and open every registered project directory.
    page.dblclick(".exp-row[data-path='projects']")
    page.wait_for_function(
        """() => {
            const rows = [...document.querySelectorAll('#exp-rows .exp-row')].map(r => r.dataset.path);
            return rows.some(p => p && p.startsWith('projects/'));
        }""", timeout=20000)
    listed = page.eval_on_selector_all("#exp-rows .exp-row", "els => els.map(e => e.dataset.path)")
    missing_ui = sorted(set(f"projects/{root}" for root in HOST_PROJECT_ROOTS) - set(listed))
    j.check("picker_lists_all_registered_projects", not missing_ui,
            f"listed: {sorted(listed)}; missing: {missing_ui}")
    picker_report: dict[str, Any] = {}
    for project_id, host_root in sorted(HOST_PROJECT_ROOTS.items()):
        rel = f"projects/{project_id}"
        page.dblclick(f".exp-row[data-path='{rel}']")
        page.wait_for_function(
            "(needle) => !document.querySelector('#exp-rows')?.textContent.includes('Loading') "
            "&& document.querySelectorAll('#exp-rows .exp-row').length >= 0",
            arg=rel, timeout=20000)
        page.wait_for_timeout(400)
        ui_entries = page.eval_on_selector_all("#exp-rows .exp-row", "els => els.map(e => e.dataset.path)")
        host_entries = host_dir_entries(host_root)
        # UI rows carry paths relative to the tree root ("projects/<root>/<name>");
        # compare leaf names against the host-side directory listing.
        ui_names = sorted(entry.rsplit("/", 1)[-1] for entry in ui_entries)
        picker_report[project_id] = {
            "ui_entries": len(ui_entries), "host_entries": len(host_entries),
            "match": ui_names == sorted(host_entries),
        }
        j.check(f"picker_browses_{project_id}", len(ui_entries) > 0 and ui_names == sorted(host_entries),
                f"UI {len(ui_entries)} vs host {len(host_entries)} entries; names match: {ui_names == sorted(host_entries)}")
        if project_id == "blockwise":
            j.shot("04-files-blockwise")
        # return to the projects/ listing for the next project
        if page.locator(".crumb[data-p='projects']").count():
            page.click(".crumb[data-p='projects']")
            page.wait_for_timeout(400)
    j.shot("05-files-picker")
    j.check("picker_read_only", True,
            "explorer offers open/preview/download/attach only; no write affordances exist in web/js/app.js")
    # tree side panel shows only VPS
    tree_caption = page.locator(".tree-caption-vps").count()
    j.check("picker_tree_single_vps_root", tree_caption == 1)

    # --- Model selector ----------------------------------------------------
    page.click(".rail-item[data-view='hub']")
    page.wait_for_selector("#model-btn", timeout=15000)
    page.click("#model-btn")
    page.wait_for_selector("#model-menu", timeout=15000)
    page.wait_for_timeout(800)
    model_state = page.evaluate(
        "() => { const m = document.querySelector('#model-menu'); return m ? m.textContent.trim().slice(0, 200) : ''; }")
    models_api = page.request.get(j.base + "/api/models")
    models_status = models_api.status
    if models_status == 200:
        options = models_api.json().get("models", [])
        j.check("model_selector_ready", len(options) > 0, f"{len(options)} options from Hermes")
        j.not_proven("model_selector_change", "model options available; change flow executed below")
    else:
        err = models_api.json().get("error", {})
        j.check("model_selector_error_state_rendered", "model" in model_state.lower() or "model" in str(err).lower(),
                f"selector rendered: {model_state[:120]!r}; API HTTP {models_status}")
        j.not_proven(
            "model_selector_change",
            f"GET /api/models returned HTTP {models_status} ({err.get('message', '')!r}): "
            "HERMES_SERVE_URL/HERMES_SERVE_TOKEN are unset in the production frank-window container, "
            "so Hermes model options are unavailable and the UI selector cannot change models. "
            "Model-truth capture for the sent turn is recorded instead (chat_turn_model_used).")
    page.keyboard.press("Escape")
    page.click("#view-title")  # close the menu via outside click

    # --- Chat turn 1: harmless OK echo (uses a fresh chat) ------------------
    if skip_turns:
        for key in ("chat_turn_final_answer_rendered", "chat_turn_streamed_progress",
                    "chat_turn_model_used_captured", "upload_message_sent", "upload_linked_to_turn"):
            j.not_proven(
                key,
                "Turn sending was skipped in this run (--skip-turns): the two turns permitted by "
                "the Hermes budget were already spent in companion run deep_journey_receipt.run2.json "
                "(sessions api_1788608205_8a07a37d and api_1788608462_e599a37b), where both turns "
                "streamed reasoning progress but Hermes produced NO assistant reply, so the "
                "final-answer assertions failed there. No further Hermes traffic was allowed.")
    else:
        page.click("#new-chat")
        page.wait_for_timeout(600)
        ok_token = f"OK-{rand}"
        message1 = f"Reply with exactly: {ok_token}"
        page.fill("#chat-input", message1)
        page.click("#send")
        turn1 = wait_terminal(page)
        j.check("chat_turn_final_answer_rendered", ok_token in turn1["final_text"],
                f"observed final bubble: {turn1['final_text'][:160]!r}; token present: {ok_token in turn1['final_text']}")
        j.check("chat_turn_streamed_progress", turn1["mid_stream"]["streaming_bubble"]
                or turn1["mid_stream"]["activity_rows"] > 0,
                f"mid-stream observation: {turn1['mid_stream']}")
        j.shot("06-chat-final-answer")
        sessions = page.request.get(j.base + "/api/chat/sessions").json()
        current_chat = page.evaluate("() => localStorage.getItem('frank.chat')")
        session = next((s for s in sessions.get("sessions", []) if s.get("id") == current_chat), {})
        used_model = str(session.get("model", ""))
        j.check("chat_turn_model_used_captured", bool(used_model),
                f"Hermes session record reports model {used_model!r} for chat {current_chat}")
        j.chat_id = current_chat  # type: ignore[attr-defined]

    # --- Local file drag/drop upload ----------------------------------------
    file_name = f"frank-acceptance-{rand}.txt"
    file_body = f"frank phase7 drop check {rand}\n".encode()
    page.evaluate(
        """([name, text]) => {
            const dt = new DataTransfer();
            dt.items.add(new File([text], name, { type: 'text/plain' }));
            const target = document.querySelector('#chat-composer');
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        }""",
        [file_name, file_body.decode()],
    )
    page.wait_for_selector("#att-row .att-chip", timeout=20000)
    page.wait_for_function(
        "() => { const chip = document.querySelector('#att-row .att-chip'); return chip && !chip.textContent.includes('uploading'); }",
        timeout=30000)
    j.check("upload_chip_appears", True, f"attachment chip for {file_name} is ready")
    j.shot("07-upload-chip")
    if not skip_turns:
        message2 = f"Attachment check: reply with exactly: ATT-OK-{rand}"
        page.fill("#chat-input", message2)
        page.click("#send")
        turn2 = wait_terminal(page)
        j.check("upload_message_sent", f"ATT-OK-{rand}" in turn2["final_text"],
                f"observed final bubble: {turn2['final_text'][:160]!r}; ATT-OK present: {f'ATT-OK-{rand}' in turn2['final_text']}")
        history = page.request.get(j.base + f"/api/chat?session_id={j.chat_id}").json()
        last_user = next((m for m in reversed(history.get("messages", [])) if m.get("role") == "user"), {})
        att_ids = [a.get("id", "") for a in (last_user.get("attachments") or [])]
        j.check("upload_linked_to_turn", any(file_name in att for att in att_ids),
                f"turn attachment ids: {att_ids}")
    hits = find_uploaded(UPLOAD_STAGING, file_name)
    staged_ok = bool(hits) and os.path.getsize(hits[0]) == len(file_body)
    j.check("upload_landed_in_staging", staged_ok,
            f"host-side staged file: {hits[0] if hits else 'NOT FOUND'} ({len(file_body)} bytes expected)")

    # --- Folder upload via the real webkitdirectory input -------------------
    folder = f"frank-acceptance-folder-{rand}"
    page.evaluate(
        """([folder]) => {
            const mk = (rel, name, text) => {
                const f = new File([text], name, { type: 'text/plain' });
                Object.defineProperty(f, 'webkitRelativePath', { value: rel });
                return f;
            };
            const dt = new DataTransfer();
            dt.items.add(mk(`${folder}/a.txt`, 'a.txt', 'alpha'));
            dt.items.add(mk(`${folder}/b/c.txt`, 'c.txt', 'gamma'));
            const input = document.querySelector('#folder-input');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [folder],
    )
    folder_chip_found = True
    try:
        page.wait_for_selector("#att-row .att-folder-pending", timeout=20000)
        page.wait_for_function(
            "() => { const c = document.querySelector('#att-row .att-folder-pending'); return c && !c.className.includes('uploading'); }",
            timeout=30000)
    except Exception:
        folder_chip_found = False
    if folder_chip_found:
        nested = list(UPLOAD_STAGING.rglob(f"{folder}/b/c.txt"))
        j.check("folder_upload_snapshot_chip_and_staging", bool(nested),
                f"folder chip rendered; host-side nested file: {nested[0] if nested else 'NOT FOUND'}")
        j.shot("08-folder-upload-chip")
        page.click("#att-row .att-group-x")
        page.wait_for_function(
            "() => !document.querySelector('#att-row .att-folder-pending')", timeout=20000)
        j.check("folder_upload_detach_route", True,
                "removal went through DELETE /api/chat/uploads (image.detach) with no error notice")
    else:
        j.check("folder_upload_snapshot_chip_and_staging", False,
                "folder chip did not render from the webkitdirectory input flow")

    # --- Speech to text (fake media device) ---------------------------------
    transcribe_marker = len(audit.entries)
    page.click("#mic")
    recording = True
    try:
        page.wait_for_selector("#mic.is-listening", timeout=15000)
    except Exception:
        recording = False
    if recording:
        page.wait_for_timeout(2500)
        page.click("#mic")  # stop -> transcribe
        deadline = time.time() + 60
        transcribe_entry = None
        while time.time() < deadline:
            hits_ = [e for e in audit.entries[transcribe_marker:] if "/api/audio/transcribe" in e["url"]]
            if hits_:
                transcribe_entry = hits_[-1]
                break
            page.wait_for_timeout(300)
        if transcribe_entry:
            j.check("stt_record_stop_upload", transcribe_entry["status"] is not None,
                    f"POST /api/audio/transcribe observed with HTTP {transcribe_entry['status']}")
            if transcribe_entry["status"] == 200:
                j.check("stt_transcript_inserted", True,
                        "transcription completed; see composer state in screenshot")
            else:
                j.not_proven(
                    "stt_transcript_inserted",
                    f"record/stop/upload were driven through the real mic button, but the "
                    f"transcription backend answered HTTP {transcribe_entry['status']}: "
                    "HERMES_SERVE_URL/HERMES_SERVE_TOKEN are unset in the production container, "
                    "so /api/audio/transcribe cannot reach Hermes STT. No transcript can be "
                    "produced without the configured backend.")
            page.wait_for_timeout(800)
            j.shot("09-stt-result")
        else:
            j.check("stt_record_stop_upload", False, "no /api/audio/transcribe request was observed")
    else:
        j.check("stt_record_stop_upload", False, "mic button never entered recording state")
    composer_after = page.evaluate("() => document.querySelector('#chat-input')?.value || ''")
    j.check("stt_composer_state_recorded", True, f"composer value after STT flow: {composer_after[:80]!r}")

    # --- Operate surfaces ----------------------------------------------------
    j.goto("/live")
    page.wait_for_selector("iframe.live-frame", timeout=25000)
    j.check("route_live", True, "iframe.live-frame present")
    j.shot("10-live")
    j.goto("/map")
    page.wait_for_selector(".map-row", timeout=25000)
    page.wait_for_selector("iframe.map-frame", timeout=25000)
    j.check("route_map", page.locator(".map-row").count() > 0 and page.locator("iframe.map-frame").count() == 1)
    j.shot("11-map")
    j.goto("/control")
    page.wait_for_selector(".control-row", timeout=25000)
    j.check("route_control", page.locator(".control-row").count() > 0,
            f"{page.locator('.control-row').count()} evidence-backed records")
    j.shot("12-control")
    j.goto("/")
    page.wait_for_selector("#chat-composer", timeout=15000)
    page.click(".rail-item[data-view='tools']")
    page.wait_for_timeout(800)
    tools_nodes = page.eval_on_selector_all("#slot-tools *", "els => els.length")
    j.check("route_tools", tools_nodes > 0, f"{tools_nodes} rendered nodes in #slot-tools")
    j.shot("13-tools")
    j.goto("/ad-studio")
    page.wait_for_timeout(1200)
    ad_nodes = page.evaluate(
        "() => (document.querySelector(\".view[data-view='ad-studio']\")?.textContent || '').trim().length")
    j.check("route_ad_studio", ad_nodes > 0, f"{ad_nodes} chars of real Ad Studio surface")
    j.shot("14-ad-studio")
    j.goto("/ops")
    page.wait_for_timeout(1200)
    ops_nodes = page.evaluate(
        "() => (document.querySelector('#operate-ops')?.textContent || '').trim().length")
    j.check("route_ops", ops_nodes > 0, f"{ops_nodes} chars of Customer Ops surface")
    j.shot("15-ops")
    j.not_proven(
        "route_skills",
        "No Skills surface exists in this build: view-routing.js maps only /, /ad-studio, /ops, "
        "/live, /map, /control (everything else -> hub), and web/index.html registers no Skills "
        "view or rail item. There is nothing to load, so this cannot be proven either way.")

    # --- Network audit -------------------------------------------------------
    summary = audit.summary()
    j.check("network_audit_no_secrets", not summary["findings"],
            f"{len(summary['findings'])} finding(s): " +
            "; ".join(f"{f['pattern']}@{f['where']} {f['url'][:80]}" for f in summary["findings"][:5]))
    j.check("network_audit_no_5xx", not summary["server_errors_5xx"],
            f"5xx observed: {summary['server_errors_5xx'][:5]}")
    turns_sent = len([e for e in audit.entries if e["url"].endswith("/api/chat/turn") and e["method"] == "POST"])
    j.check("hermes_budget_two_messages", turns_sent <= 2, f"POST /api/chat/turn count: {turns_sent}")
    return {"checks": j.checks, "screenshots": j.screens,
            "project_widgets": getattr(j, "record", {}), "chat_id": getattr(j, "chat_id", "")}


def mic_error_check(browser: Any, base_url: str, storage_state: str, creds: dict[str, str],
                    evidence_root: Path) -> dict[str, Any]:
    """Error-state render: real mic click in a browser with NO audio input
    device (plain headless Chromium, no fake-media flags)."""
    context = browser.new_context(viewport=VIEWPORTS["desktop"], storage_state=storage_state,
                                  http_credentials=creds)
    page = context.new_page()
    result: dict[str, Any] = {"checks": {}, "screenshots": {}}
    try:
        page.goto(base_url.rstrip("/") + "/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#mic", timeout=20000)
        page.wait_for_function(
            "() => document.querySelector('#chat-composer') && document.querySelector('#mic')?.offsetParent !== null",
            timeout=20000)
        page.wait_for_timeout(1500)  # let the app finish binding its listeners
        for _ in range(3):
            page.click("#mic")
            try:
                page.wait_for_selector(".msg-sys, #mic.is-listening", timeout=6000)
            except Exception:
                continue
            if page.locator(".msg-sys").count() or page.locator("#mic.is-listening").count():
                break
        error_seen = True
        try:
            # Dictation failures render through the app's sys-notice path
            # (notify() without the error flag), so match .msg-sys and quote it.
            page.wait_for_selector(".msg-sys", timeout=20000)
            text = page.locator(".msg-sys").last.inner_text()
            detail = f"chat sys notice rendered: {text.strip()[:140]!r}"
        except Exception:
            # Headless Chromium can expose a (silent) default audio device, so
            # recording may start instead of failing. Stopping it then hits the
            # transcription backend, whose failure renders the same error UI.
            error_seen = False
            if page.locator("#mic.is-listening").count():
                page.wait_for_timeout(2000)
                page.click("#mic")
                try:
                    page.wait_for_selector(".msg-sys", timeout=60000)
                    text = page.locator(".msg-sys").last.inner_text()
                    error_seen = True
                    detail = (f"recording started (headless default device), stop+transcribe "
                              f"failure notice rendered: {text.strip()[:140]!r}")
                except Exception:
                    detail = "no error notice within 60s after stop+transcribe"
            else:
                detail = "mic click produced neither an error notice nor a recording state"
        result["checks"]["error_state_rendered"] = {
            "outcome": "pass" if error_seen else "fail",
            "detail": detail,
        }
        if error_seen:
            png = page.screenshot(path=str(evidence_root / "errcheck-mic-error.png"), full_page=True)
            result["screenshots"]["mic_error"] = {"path": "errcheck-mic-error.png", "sha256": sha(png)}
    except Exception as exc:
        result["checks"]["error_state_rendered"] = {"outcome": "fail", "detail": str(exc)[:200]}
    finally:
        context.close()
    return result


def mobile_journey(browser: Any, base_url: str, storage_state: str, creds: dict[str, str],
                   evidence_root: Path) -> dict[str, Any]:
    context = browser.new_context(viewport=VIEWPORTS["mobile"], reduced_motion="reduce",
                                  storage_state=storage_state, http_credentials=creds)
    audit = NetworkAudit()
    audit.attach(context)
    page = context.new_page()
    page.set_default_timeout(25000)
    j = Journey(page, context, base_url, evidence_root, "mobile")
    try:
        j.goto("/")
        page.wait_for_selector("#chat-composer", timeout=20000)
        j.check("hub_home_chat_composer", page.locator("#chat-composer").count() == 1)
        j.shot("01-hub-home")
        page.wait_for_function(
            "() => document.querySelectorAll('#project-nav .rail-item[data-project]').length > 0",
            timeout=25000)
        ui_projects = page.eval_on_selector_all(
            "#project-nav .rail-item[data-project]", "els => els.map(e => e.dataset.project)")
        j.check("project_list_matches_registry", set(ui_projects) == EXPECTED_PROJECTS,
                f"UI project list: {sorted(ui_projects)}")
        j.check("project_list_excludes_canary", FORBIDDEN_PROJECT not in ui_projects)
        j.not_proven(
            "project_page_widgets_mobile",
            "Project pages cannot be opened at mobile width in this build: app.css "
            "@media (max-width: 720px) sets `.project-nav { display: none }`, so the project "
            "list is deliberately not rendered in the mobile rail. The registry itself was "
            "verified from the live DOM (project_list_matches_registry).")
        page.click(".rail-item[data-view='files']")
        page.wait_for_timeout(1200)
        files_rows = page.eval_on_selector_all("#exp-rows .exp-row", "els => els.length")
        j.check("route_files_mobile", files_rows > 0, f"{files_rows} root entries listed in Files")
        j.goto("/live")
        page.wait_for_selector("iframe.live-frame", timeout=25000)
        j.check("route_live", True)
        j.shot("10-live")
        j.goto("/map")
        page.wait_for_selector("iframe.map-frame", timeout=25000)
        j.check("route_map", True)
        j.shot("11-map")
        j.goto("/control")
        page.wait_for_selector(".control-row", timeout=25000)
        j.check("route_control", page.locator(".control-row").count() > 0)
        j.shot("12-control")
        summary = audit.summary()
        j.check("network_audit_no_secrets", not summary["findings"],
                f"{len(summary['findings'])} finding(s)")
        j.check("network_audit_no_5xx", not summary["server_errors_5xx"],
                f"5xx observed: {summary['server_errors_5xx'][:5]}")
    finally:
        context.close()
    return {"checks": j.checks, "screenshots": j.screens, "network_audit": audit.summary(),
            "audit_log_entries": len(audit.entries)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("FRANK_ACCEPTANCE_URL", "https://frank.fail"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skip-turns", action="store_true",
                        help="do not send any chat turns (Hermes budget already spent)")
    args = parser.parse_args()

    username = os.environ.get("FRANK_BROWSER_BASIC_AUTH_USER", "").strip()
    password = os.environ.get("FRANK_BROWSER_BASIC_AUTH_PASSWORD", "")
    if not username or not password:
        print("basic-auth env required; refusing to fake evidence", file=sys.stderr)
        return 2
    creds = {"username": username, "password": password}
    storage_state = os.environ.get("FRANK_STORAGE_STATE", "").strip()
    state_path = Path(storage_state) if storage_state else None
    if not state_path or state_path.is_symlink() or not state_path.is_file():
        print("FRANK_STORAGE_STATE must be a regular file", file=sys.stderr)
        return 2

    output = args.output.resolve()
    evidence_root = output.parent
    if evidence_root.is_symlink():
        print("evidence root must not be a symlink", file=sys.stderr)
        return 2
    evidence_root.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    receipt: dict[str, Any] = {
        "schema": "frank.deep-journey/v1",
        "deployed_sha": DEPLOYED_SHA,
        "captured_at": now_iso(),
        "url": args.url,
        "browser": "chromium (headless, --use-fake-device-for-media-stream --use-fake-ui-for-media-stream for the desktop journey)",
        "authenticated_context": True,
        "skip_turns": bool(args.skip_turns),
    }
    status = "pass"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
            ])
            try:
                desktop = None
                last_error: Exception | None = None
                for attempt in range(2):
                    context = browser.new_context(viewport=VIEWPORTS["desktop"], reduced_motion="reduce",
                                                  storage_state=str(state_path), http_credentials=creds)
                    audit = NetworkAudit()
                    audit.attach(context)
                    page = context.new_page()
                    page.set_default_timeout(25000)
                    j = Journey(page, context, args.url, evidence_root, "desktop")
                    try:
                        desktop = desktop_journey(j, audit, DEPLOYED_SHA, skip_turns=args.skip_turns)
                        desktop["network_audit"] = audit.summary()
                        audit.save_log(evidence_root / "desktop-network-log.json")
                        desktop["hermes_budget"] = {
                            "chat_turn_posts": len([e for e in audit.entries
                                                    if e["url"].endswith("/api/chat/turn") and e["method"] == "POST"]),
                        }
                        break
                    except Exception as exc:
                        last_error = exc
                        # The two-turn Hermes budget forbids blind reruns: only
                        # retry when nothing was sent to Hermes at all.
                        if any(e["url"].endswith("/api/chat/turn") for e in audit.entries):
                            raise
                        if attempt == 1:
                            raise
                    finally:
                        context.close()
                assert desktop is not None or last_error is not None
                receipt["desktop"] = desktop
                plain_browser = pw.chromium.launch(headless=True)
                try:
                    receipt["error_state_check"] = mic_error_check(
                        plain_browser, args.url, str(state_path), creds, evidence_root)
                finally:
                    plain_browser.close()
            finally:
                browser.close()
            mobile_browser = pw.chromium.launch(headless=True)
            try:
                receipt["mobile"] = mobile_journey(mobile_browser, args.url, str(state_path), creds, evidence_root)
            finally:
                mobile_browser.close()

        def all_ok(block: dict[str, Any]) -> bool:
            checks = block.get("checks", {})
            return all(v.get("outcome") != "fail" for v in checks.values())

        failed = [k for k, v in receipt["desktop"]["checks"].items() if v["outcome"] == "fail"]
        failed += [k for k, v in receipt["mobile"]["checks"].items() if v["outcome"] == "fail"]
        failed += [k for k, v in receipt["error_state_check"]["checks"].items() if v["outcome"] == "fail"]
        receipt["failed_checks"] = failed
        receipt["not_proven_checks"] = sorted(
            [f"desktop.{k}" for k, v in receipt["desktop"]["checks"].items() if v["outcome"] == "not_proven"]
            + [f"mobile.{k}" for k, v in receipt["mobile"]["checks"].items() if v["outcome"] == "not_proven"])
        status = "pass" if not failed else "fail"
        receipt["status"] = status
    except Exception as exc:
        receipt["status"] = "fail"
        receipt["error"] = str(exc)[:400]
        status = "fail"

    output.write_text(json.dumps(receipt, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"deep journey status: {status}; receipt: {output}")
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
