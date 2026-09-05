"""Phase 7 GAP RE-VERIFICATION against production https://frank.fail.

Focused re-check of the items that failed in the earlier Phase 7 run:
  1. /api/models (was 503: HERMES_SERVE_* unset)  -> must be 200 with options
  2. Model selector journey with ONE short chat turn + model-truth proof
  3. STT journey: record -> stop -> upload -> transcribe -> composer insert
  4. Final-answer bubble render + error-state render path
  5. Full network audit (restricted host paths / secrets / steven-* / leases / board ids)
  6. Project list = the six registered projects, no v021canary-estate

Hermes budget: exactly ONE chat turn (the OK echo). No service restarts.
Reuses the real selectors/waiters/audit from deep_journey.py.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deep_journey import (  # noqa: E402
    EXPECTED_PROJECTS,
    FORBIDDEN_PROJECT,
    NetworkAudit,
    Journey,
    VIEWPORTS,
    mic_error_check,
    wait_terminal,
)

DEPLOYED_SHA = "bedf02a0af75daa680daaba7f1ca62207b77c817"
BASE_URL = "https://frank.fail"
ENV_FILE = Path("/secure/frank-acceptance.env")
STORAGE_STATE = Path("/secure/frank-storage-state.json")
DICTATION_WAV = Path("/tmp/gapreverify/dictation.wav")
DICTATION_KEYWORDS = ("frank", "dictation", "verification", "hello")
PREFERRED_ALTERNATE = "gpt-5.4-mini"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip("'\"")
    return out


def session_get(page: Any, chat_id: str) -> dict[str, Any]:
    data = page.request.get(BASE_URL + "/api/chat/sessions").json()
    for s in data.get("sessions", []):
        if s.get("id") == chat_id:
            return s
    return {}


def main() -> int:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    evidence = Path(f"/srv/frank/data/window/evidence/phase7-gapreverify-{ts}")
    evidence.mkdir(parents=True)

    env = load_env(ENV_FILE)
    creds = {
        "username": env["FRANK_BROWSER_BASIC_AUTH_USER"],
        "password": env["FRANK_BROWSER_BASIC_AUTH_PASSWORD"],
    }

    checks: dict[str, dict[str, Any]] = {}
    screens: dict[str, dict[str, str]] = {}

    def check(key: str, ok: bool, detail: str = "") -> bool:
        checks[key] = {"pass": bool(ok), "detail": detail}
        return ok

    def shot(page: Any, key: str, *, full_page: bool = True) -> None:
        png = page.screenshot(path=str(evidence / f"{key}.png"), full_page=full_page)
        screens[key] = {
            "path": str(evidence / f"{key}.png"),
            "sha256": "sha256:" + hashlib.sha256(png).hexdigest(),
        }

    audits: list[NetworkAudit] = []

    from playwright.sync_api import sync_playwright

    receipt: dict[str, Any] = {
        "schema": "frank.deep-journey/v1.1",
        "run": "phase7-gap-reverify",
        "deployed_sha": DEPLOYED_SHA,
        "captured_at": now_iso(),
        "url": BASE_URL,
        "browser": "chromium (headless)",
        "authenticated_context": True,
        "hermes_budget": {"max_chat_turns": 3, "planned_chat_turns": 1},
    }

    try:
        with sync_playwright() as pw:
            # ---------------- main browser: models + projects + chat turn ----
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                viewport=VIEWPORTS["desktop"], reduced_motion="reduce",
                storage_state=str(STORAGE_STATE), http_credentials=creds)
            audit = NetworkAudit()
            audit.attach(context)
            audits.append(audit)
            page = context.new_page()
            page.set_default_timeout(30000)
            j = Journey(page, context, BASE_URL, evidence, "desktop")

            # --- [6] project list: six registered projects, no canary -------
            page.goto(BASE_URL + "/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_selector("#chat-composer", timeout=20000)
            page.wait_for_function(
                "() => document.querySelectorAll('#project-nav .rail-item[data-project]').length > 0",
                timeout=25000)
            ui_projects = page.eval_on_selector_all(
                "#project-nav .rail-item[data-project]", "els => els.map(e => e.dataset.project)")
            check("project_list_exactly_six", set(ui_projects) == EXPECTED_PROJECTS and len(ui_projects) == 6,
                  f"UI project list: {sorted(ui_projects)}")
            check("project_list_no_canary", FORBIDDEN_PROJECT not in ui_projects,
                  f"'{FORBIDDEN_PROJECT}' absent: {FORBIDDEN_PROJECT not in ui_projects}")
            widget_report: dict[str, Any] = {}
            for project_id in sorted(EXPECTED_PROJECTS):
                page.click(f".rail-item[data-project='{project_id}']")
                page.wait_for_selector(".view[data-view='project'].is-on .home-widget", timeout=30000)
                page.wait_for_timeout(500)
                n = page.locator(".view[data-view='project'].is-on .home-widget").count()
                widget_report[project_id] = n
                check(f"project_page_opens_{project_id}", n > 0, f"{n} widgets rendered")
            receipt["project_widget_counts"] = widget_report
            shot(page, "projects-pass")

            # --- [1] /api/models authenticated -------------------------------
            models_resp = page.request.get(BASE_URL + "/api/models")
            models_status = models_resp.status
            models_body = models_resp.json() if models_status == 200 else {}
            options = models_body.get("models", []) if models_status == 200 else []
            option_ids = [o.get("id", "") for o in options]
            check("api_models_200_with_options", models_status == 200 and len(options) > 0,
                  f"HTTP {models_status}, {len(options)} model options")
            receipt["api_models"] = {
                "status": models_status,
                "model_count": len(options),
                "option_ids_sample": option_ids[:12],
            }

            # --- [2] model selector journey ----------------------------------
            original_ui_model = page.locator("#model-name").inner_text().strip()
            page.click("#new-chat")
            page.wait_for_timeout(900)
            chat_id = page.evaluate("() => localStorage.getItem('frank.chat')") or ""
            session_before = session_get(page, chat_id)
            original_model = str(session_before.get("model", "") or "")
            receipt["api_models"]["default_model_id_session_record"] = original_model or "(unset -> Hermes default)"
            receipt["api_models"]["ui_model_label_before"] = original_ui_model

            page.click("#model-btn")
            page.wait_for_selector("#model-menu.is-open", timeout=15000)
            page.wait_for_function(
                "() => document.querySelectorAll('#model-menu .model-opt').length > 0", timeout=20000)
            menu_ids = page.eval_on_selector_all(
                "#model-menu .model-opt", "els => els.map(e => e.dataset.id)")
            selectable = page.evaluate(
                """() => [...document.querySelectorAll('#model-menu .model-opt')]
                     .filter(e => e.getAttribute('aria-pressed') !== 'true')
                     .map(e => ({id: e.dataset.id, confirm: /expensive/.test(e.textContent)}))""")
            check("model_menu_lists_options", len(menu_ids) == len(options),
                  f"menu options: {len(menu_ids)} vs API {len(options)}")

            target = PREFERRED_ALTERNATE if PREFERRED_ALTERNATE in menu_ids and PREFERRED_ALTERNATE != original_model else ""
            if not target:
                for cand in selectable:
                    if not cand["confirm"] and cand["id"] != original_model and cand["id"] != "default":
                        target = cand["id"]
                        break
            check("model_alternate_available", bool(target), f"selected alternate model: {target}")

            runtime_capture: dict[str, Any] = {}

            def on_model_response(resp: Any) -> None:
                if "/model" in resp.url and resp.request.method == "POST":
                    try:
                        runtime_capture.setdefault("responses", []).append(
                            {"url": resp.url, "status": resp.status, "body": resp.json()})
                    except Exception:
                        runtime_capture.setdefault("responses", []).append(
                            {"url": resp.url, "status": resp.status, "body": None})

            context.on("response", on_model_response)
            # 437 options overflow the menu container: scroll the option into
            # view and click it through the DOM (same synthetic click path the
            # app's own listener handles).
            page.locator(f"#model-menu .model-opt[data-id='{target}']").scroll_into_view_if_needed()
            page.eval_on_selector(
                f"#model-menu .model-opt[data-id='{target}']", "el => el.click()")
            page.wait_for_function("!document.querySelector('#model-menu').classList.contains('is-open')", timeout=10000)
            deadline = time.time() + 20
            session_after_select = {}
            while time.time() < deadline:
                session_after_select = session_get(page, chat_id)
                if str(session_after_select.get("model", "")) == target:
                    break
                page.wait_for_timeout(500)
            check("model_selector_change_accepted",
                  str(session_after_select.get("model", "")) == target,
                  f"session record model after select: {session_after_select.get('model')!r} (target {target!r})")
            ui_model_after = page.locator("#model-name").inner_text().strip()
            check("model_ui_label_shows_selection", ui_model_after == target,
                  f"#model-name label: {ui_model_after!r}")
            rt = (runtime_capture.get("responses") or [{}])[-1] if runtime_capture.get("responses") else {}
            rt_model = str(((rt.get("body") or {}).get("runtime") or {}).get("model", ""))
            receipt["model_selector"] = {
                "selected": target, "original_model": original_model or "(unset -> Hermes default)",
                "ui_label_after_select": ui_model_after,
                "set_model_http_status": rt.get("status"),
                "runtime_model_from_response": rt_model,
                "session_record_model": session_after_select.get("model"),
            }

            # --- ONE chat turn: OK echo ---------------------------------------
            page.click("#new-chat")
            page.wait_for_timeout(900)
            chat_id = page.evaluate("() => localStorage.getItem('frank.chat')") or ""
            ok_token = "OK-" + os.urandom(3).hex()
            page.fill("#chat-input", f"Reply with exactly: {ok_token}")
            page.click("#send")
            turn = wait_terminal(page)
            check("chat_turn_streamed_progress",
                  turn["mid_stream"]["streaming_bubble"] or turn["mid_stream"]["activity_rows"] > 0,
                  f"mid-stream observation: {turn['mid_stream']}")
            check("chat_turn_final_answer_rendered", ok_token in turn["final_text"],
                  f"final bubble text: {turn['final_text'][:200]!r}; token {ok_token!r} present: {ok_token in turn['final_text']}")
            shot(page, "final-answer-bubble")
            receipt["chat_turn"] = {
                "chat_id": chat_id, "ok_token": ok_token,
                "final_bubble_text": turn["final_text"][:400],
                "mid_stream": turn["mid_stream"],
            }
            session_final = session_get(page, chat_id)
            used_model = str(session_final.get("model", ""))
            check("model_used_equals_selection", used_model == target,
                  f"Hermes session {chat_id} reports model {used_model!r}; selection was {target!r}")
            receipt["chat_turn"]["session_record_model"] = used_model
            check("model_truth_ui_session_runtime_agree",
                  used_model == target and ui_model_after == target and (not rt_model or rt_model == target),
                  f"ui={ui_model_after!r} session={used_model!r} runtime={rt_model!r}")

            # restore the original default model (no chat turn involved).
            # A fresh session's implicit default ("hermes-agent") is not a
            # selectable option and the set-model endpoint always sends
            # require_model_lock=true, so the closest UI-available restore is
            # the platform's offered default option ("default", provider moa).
            restore_id = original_model if original_model in menu_ids else "default"
            restore_note = (
                f"original session model {original_model!r} is Hermes's fresh-session default "
                "and not a selectable option; restored the selectable platform default instead"
            ) if restore_id != original_model else ""
            page.click("#model-btn")
            page.wait_for_selector("#model-menu.is-open", timeout=15000)
            page.wait_for_function(
                "() => document.querySelectorAll('#model-menu .model-opt').length > 0", timeout=20000)
            page.locator(f"#model-menu .model-opt[data-id='{restore_id}']").scroll_into_view_if_needed()
            page.eval_on_selector(
                f"#model-menu .model-opt[data-id='{restore_id}']", "el => el.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Escape")
            page.click("#view-title")
            deadline = time.time() + 20
            restored = ""
            while time.time() < deadline:
                restored = str(session_get(page, chat_id).get("model", ""))
                if restored == restore_id:
                    break
                page.wait_for_timeout(500)
            check("original_default_model_restored", restored == restore_id,
                  f"session model restored to {restored!r} "
                  f"(original {original_model!r}{('; ' + restore_note) if restore_note else ''})")
            receipt["model_selector"]["restore_target"] = restore_id
            receipt["model_selector"]["restore_note"] = restore_note
            receipt["model_selector"]["session_model_after_restore"] = restored
            context.close()
            browser.close()

            # ---------------- STT journey: real speech via fake mic -----------
            stt_browser = pw.chromium.launch(headless=True, args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={DICTATION_WAV}",
            ])
            stt_context = stt_browser.new_context(
                viewport=VIEWPORTS["desktop"], storage_state=str(STORAGE_STATE), http_credentials=creds)
            stt_audit = NetworkAudit()
            stt_audit.attach(stt_context)
            audits.append(stt_audit)
            spage = stt_context.new_page()
            spage.set_default_timeout(30000)
            spage.goto(BASE_URL + "/", wait_until="domcontentloaded", timeout=30000)
            spage.wait_for_selector("#chat-composer", timeout=20000)
            spage.wait_for_timeout(1500)
            spage.fill("#chat-input", "")
            marker = len(stt_audit.entries)
            spage.click("#mic")
            recording = True
            try:
                spage.wait_for_selector("#mic.is-listening", timeout=15000)
            except Exception:
                recording = False
            check("stt_recording_started", recording, "#mic.is-listening observed" if recording else "mic never entered listening state")
            if recording:
                spage.wait_for_timeout(5000)  # capture a full pass of the speech clip
                spage.click("#mic")  # stop -> upload -> transcribe
                deadline = time.time() + 90
                transcribe_entry = None
                while time.time() < deadline:
                    hits = [e for e in stt_audit.entries[marker:] if "/api/audio/transcribe" in e["url"]]
                    if hits:
                        transcribe_entry = hits[-1]
                        break
                    spage.wait_for_timeout(400)
                check("stt_upload_transcribe_called", bool(transcribe_entry),
                      f"POST /api/audio/transcribe observed: {transcribe_entry}" if transcribe_entry
                      else "no /api/audio/transcribe request observed within 90s")
                if transcribe_entry:
                    check("stt_transcribe_http_200", transcribe_entry.get("status") == 200,
                          f"HTTP {transcribe_entry.get('status')} from /api/audio/transcribe")
                    inserted = ""
                    try:
                        spage.wait_for_function(
                            "() => (document.querySelector('#chat-input')?.value || '').trim().length > 0",
                            timeout=20000)
                        inserted = spage.evaluate("() => document.querySelector('#chat-input').value")
                    except Exception:
                        inserted = ""
                    check("stt_transcript_in_composer", bool(inserted.strip()),
                          f"composer value after transcription: {inserted[:160]!r}")
                    keyword_hit = [k for k in DICTATION_KEYWORDS if k in inserted.lower()]
                    check("stt_transcript_matches_spoken_words", bool(keyword_hit),
                          f"spoken clip was 'Hello Frank. This is the gap re-verification dictation check.'; "
                          f"keyword hits in transcript: {keyword_hit or 'none'}")
                    receipt["stt"] = {
                        "transcribe_status": transcribe_entry.get("status"),
                        "composer_transcript": inserted[:300],
                        "keyword_hits": keyword_hit,
                        "fake_audio_file": str(DICTATION_WAV),
                        "fake_audio_sha256": "sha256:" + hashlib.sha256(DICTATION_WAV.read_bytes()).hexdigest(),
                    }
                    spage.wait_for_timeout(600)
                    shot(spage, "stt-transcript-in-composer")
            stt_context.close()
            stt_browser.close()

            # ---------------- error-state render path (no fake media) ---------
            plain = pw.chromium.launch(headless=True)
            err = mic_error_check(plain, BASE_URL, str(STORAGE_STATE), creds, evidence)
            plain.close()
            for k, v in err.get("checks", {}).items():
                checks[f"error_state.{k}"] = {"pass": v.get("outcome") == "pass", "detail": v.get("detail", "")}
            for k, v in err.get("screenshots", {}).items():
                p = evidence / v["path"]
                screens[f"error_state.{k}"] = {"path": str(p), "sha256": v["sha256"]}
            receipt["error_state_check"] = err

        # ---------------- network audit across all contexts -------------------
        combined = {
            "requests_observed": sum(a.summary()["requests_observed"] for a in audits),
            "bodies_scanned": sum(a.summary()["bodies_scanned"] for a in audits),
            "bodies_skipped": sum(a.summary()["bodies_skipped"] for a in audits),
            "server_errors_5xx": [e for a in audits for e in a.summary()["server_errors_5xx"]],
            "findings": [f for a in audits for f in a.summary()["findings"]],
        }
        check("network_audit_no_restricted_paths_or_secrets", not combined["findings"],
              f"{len(combined['findings'])} finding(s): " +
              "; ".join(f"{f['pattern']}@{f['where']} {f['url'][:90]}" for f in combined["findings"][:8]))
        check("network_audit_no_5xx", not combined["server_errors_5xx"],
              f"5xx: {combined['server_errors_5xx'][:5]}")
        receipt["network_audit"] = combined
        for i, a in enumerate(audits):
            a.save_log(evidence / f"network-log-{i}.json")

        turn_posts = 0
        for a in audits:
            turn_posts += len([e for e in a.entries if e["url"].endswith("/api/chat/turn") and e["method"] == "POST"])
        check("hermes_budget_respected_one_turn", turn_posts == 1, f"POST /api/chat/turn count: {turn_posts}")

        receipt["checks"] = checks
        receipt["screenshots"] = screens
        failed = [k for k, v in checks.items() if not v["pass"]]
        receipt["failed_checks"] = failed
        receipt["status"] = "pass" if not failed else "fail"
    except Exception as exc:
        receipt["status"] = "fail"
        receipt["error"] = f"{type(exc).__name__}: {exc}"[:500]
        receipt["checks"] = checks
        receipt["screenshots"] = screens
        import traceback
        (evidence / "exception.txt").write_text(traceback.format_exc(), encoding="utf-8")

    (evidence / "gap_reverify_receipt.json").write_text(
        json.dumps(receipt, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"gap-reverify status: {receipt['status']}; evidence: {evidence}")
    if receipt.get("failed_checks"):
        print("failed:", ", ".join(receipt["failed_checks"]))
    if receipt.get("error"):
        print("error:", receipt["error"])
    return 0 if receipt["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
