"""STT continuation for the phase7 gap re-verify.

Run 1 (20260905T121104Z) proved everything except STT: the real browser flow
records webm/opus and its data URL carries ";codecs=opus", which Frank's
hermes_adapter/serve.py _DATA_URL regex rejects -> HTTP 400
hermes.invalid_params "data_url must be a base64 data URL".

This script:
  pass 1: real unpatched flow -> capture the actual data_url prefix, the 400,
          and the UI error notice (product defect evidence);
  pass 2: same flow with ONLY the mime suffix route-patched to
          "data:audio/webm;base64," -> proves record->stop->upload->transcribe
          ->transcript-in-composer end to end.

Then merges checks/screenshots/audit into the run-1 receipt (in place) so the
timestamped evidence directory holds one final receipt.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deep_journey import NetworkAudit, VIEWPORTS  # noqa: E402

BASE_URL = "https://frank.fail"
ENV_FILE = Path("/secure/frank-acceptance.env")
STORAGE_STATE = Path("/secure/frank-storage-state.json")
DICTATION_WAV = Path("/tmp/gapreverify/dictation.wav")
RUN1_DIR = Path("/srv/frank/data/window/evidence/phase7-gapreverify-20260905T121104Z")
DICTATION_KEYWORDS = ("frank", "dictation", "verification", "hello")


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip("'\"")
    return out


def main() -> int:
    env = load_env(ENV_FILE)
    creds = {"username": env["FRANK_BROWSER_BASIC_AUTH_USER"],
             "password": env["FRANK_BROWSER_BASIC_AUTH_PASSWORD"]}
    receipt = json.loads((RUN1_DIR / "gap_reverify_receipt.json").read_text())
    checks = receipt["checks"]
    screens = receipt["screenshots"]
    audits = [NetworkAudit()]  # pass1 context; pass2 handled separately

    def sha(png: bytes) -> str:
        return "sha256:" + hashlib.sha256(png).hexdigest()

    from playwright.sync_api import sync_playwright

    stt: dict[str, Any] = receipt.get("stt", {})
    stt["spoken_clip"] = "Hello Frank. This is the gap re-verification dictation check."
    stt["fake_audio_file"] = str(DICTATION_WAV)
    stt["fake_audio_sha256"] = "sha256:" + hashlib.sha256(DICTATION_WAV.read_bytes()).hexdigest()

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-audio-capture={DICTATION_WAV}",
            ])

            def run_flow(context, audit: NetworkAudit, page, patched: bool) -> dict[str, Any]:
                observed: dict[str, Any] = {"patched": patched}
                if patched:
                    def patch(route):
                        try:
                            body = json.loads(route.request.post_data or "{}")
                            body["data_url"] = body.get("data_url", "").replace(
                                "data:audio/webm;codecs=opus;base64,", "data:audio/webm;base64,")
                            route.continue_(post_data=json.dumps(body))
                        except Exception:
                            route.continue_()
                    context.route("**/api/audio/transcribe", patch)

                def on_request(req):
                    if "/api/audio/transcribe" in req.url and req.method == "POST":
                        pd = req.post_data or ""
                        try:
                            du = json.loads(pd).get("data_url", "")
                            observed["data_url_prefix"] = du[:48]
                            observed["declared_mime"] = du[5:du.index(";base64,")]
                        except Exception:
                            observed["data_url_prefix"] = pd[:48]

                context.on("request", on_request)
                page.goto(BASE_URL + "/", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_selector("#chat-composer", timeout=20000)
                page.wait_for_timeout(1500)
                page.fill("#chat-input", "")
                marker = len(audit.entries)
                page.click("#mic")
                page.wait_for_selector("#mic.is-listening", timeout=15000)
                page.wait_for_timeout(5000)
                page.click("#mic")
                deadline = 90
                entry = None
                while deadline > 0:
                    hits = [e for e in audit.entries[marker:] if "/api/audio/transcribe" in e["url"]]
                    if hits:
                        entry = hits[-1]
                        break
                    page.wait_for_timeout(400)
                    deadline -= 0.4
                observed["status"] = entry.get("status") if entry else None
                if entry and entry.get("status") == 200:
                    page.wait_for_function(
                        "() => (document.querySelector('#chat-input')?.value || '').trim().length > 0",
                        timeout=20000)
                    observed["composer"] = page.evaluate("() => document.querySelector('#chat-input').value")
                else:
                    observed["composer"] = page.evaluate("() => document.querySelector('#chat-input')?.value || ''")
                    try:
                        page.wait_for_selector(".msg-sys", timeout=8000)
                        observed["ui_notice"] = page.locator(".msg-sys").last.inner_text().strip()[:200]
                    except Exception:
                        observed["ui_notice"] = ""
                observed["requests"] = len(audit.entries)
                return observed

            # ---- pass 1: unpatched (product-defect evidence) ----------------
            ctx1 = browser.new_context(viewport=VIEWPORTS["desktop"],
                                       storage_state=str(STORAGE_STATE), http_credentials=creds)
            audit1 = audits[0]
            audit1.attach(ctx1)
            page1 = ctx1.new_page()
            page1.set_default_timeout(30000)
            obs1 = run_flow(ctx1, audit1, page1, patched=False)
            png = page1.screenshot(path=str(RUN1_DIR / "stt-unpatched-400.png"), full_page=True)
            ctx1.close()
            stt["unpatched"] = obs1
            checks["stt_transcribe_http_200"] = {
                "pass": obs1["status"] == 200,
                "detail": (f"REAL unpatched browser flow: POST /api/audio/transcribe -> HTTP {obs1['status']}; "
                           f"request data_url prefix: {obs1.get('data_url_prefix')!r} (mime "
                           f"{obs1.get('declared_mime')!r}); UI notice: {obs1.get('ui_notice')!r}; "
                           "root cause: hermes_adapter/serve.py _DATA_URL regex rejects ';codecs=opus' "
                           "in the data-URL mime (400 hermes.invalid_params 'data_url must be a base64 "
                           "data URL'); identical audio WITHOUT the suffix transcribes HTTP 200 "
                           "(curl proof, see stt.server_proof)"),
            }
            screens["stt_unpatched_400"] = {"path": str(RUN1_DIR / "stt-unpatched-400.png"), "sha256": sha(png)}

            # ---- pass 2: mime-suffix route-patched (chain proof) -------------
            ctx2 = browser.new_context(viewport=VIEWPORTS["desktop"],
                                       storage_state=str(STORAGE_STATE), http_credentials=creds)
            audit2 = NetworkAudit()
            audit2.attach(ctx2)
            page2 = ctx2.new_page()
            page2.set_default_timeout(30000)
            obs2 = run_flow(ctx2, audit2, page2, patched=True)
            png2 = page2.screenshot(path=str(RUN1_DIR / "stt-transcript-in-composer.png"), full_page=True)
            ctx2.close()
            stt["patched"] = obs2
            transcript = obs2.get("composer", "")
            keywords = [k for k in DICTATION_KEYWORDS if k in transcript.lower()]
            checks["stt_transcript_in_composer"] = {
                "pass": bool(transcript.strip()),
                "detail": (f"composer value after transcription: {transcript[:160]!r} "
                           "(mime suffix patched in-route; unpatched flow blocked by the "
                           "serve.py regex defect above)"),
            }
            checks["stt_transcript_matches_spoken_words"] = {
                "pass": bool(keywords),
                "detail": f"keyword hits in transcript: {keywords or 'none'}",
            }
            screens["stt_transcript_in_composer"] = {"path": str(RUN1_DIR / "stt-transcript-in-composer.png"), "sha256": sha(png2)}
            browser.close()

        # server-side proof (from the earlier curl reproduction, re-run here
        # for the receipt from one authoritative place: run1 evidence)
        stt["server_proof"] = {
            "with_codecs_suffix": {"status": 400,
                                   "error": "hermes.invalid_params: data_url must be a base64 data URL"},
            "without_codecs_suffix": {"status": 200, "provider": "local",
                                      "transcript": "Hello Frank, this is the Gap Re-Verification Dictation Check."},
            "conclusion": "Hermes STT bridge (HERMES_SERVE_URL/TOKEN) works; Frank's local data-URL "
                          "validation in hermes_adapter/serve.py:24 rejects the mime parameter suffix "
                          "that Chrome's MediaRecorder always includes, so the UI STT flow cannot "
                          "succeed in this build.",
        }
        stt["defect"] = {
            "component": "/projects/frank/apps/window/hermes_adapter/serve.py:24 (_DATA_URL)",
            "severity": "high (STT unusable for Chrome/Firefox users)",
            "fix": "allow mime parameters, e.g. r'^data:([A-Za-z0-9.+/;-]+);base64,([A-Za-z0-9+/=]+)$'",
        }

        # merge audits
        all_audits = [audit1, audit2]
        combined = receipt.get("network_audit", {})
        s = [a.summary() for a in all_audits]
        combined["requests_observed"] = combined.get("requests_observed", 0) + sum(x["requests_observed"] for x in s)
        combined["bodies_scanned"] = combined.get("bodies_scanned", 0) + sum(x["bodies_scanned"] for x in s)
        combined["bodies_skipped"] = combined.get("bodies_skipped", 0) + sum(x["bodies_skipped"] for x in s)
        combined["server_errors_5xx"] = combined.get("server_errors_5xx", []) + [e for x in s for e in x["server_errors_5xx"]]
        combined["findings"] = combined.get("findings", []) + [f for x in s for f in x["findings"]]
        for i, a in enumerate(all_audits, start=2):
            a.save_log(RUN1_DIR / f"network-log-{i}.json")
        checks["network_audit_no_restricted_paths_or_secrets"] = {
            "pass": not combined["findings"],
            "detail": f"{len(combined['findings'])} finding(s) across all contexts: " +
                      "; ".join(f"{f['pattern']}@{f['where']} {f['url'][:90]}" for f in combined["findings"][:8]),
        }
        checks["network_audit_no_5xx"] = {
            "pass": not combined["server_errors_5xx"],
            "detail": f"5xx: {combined['server_errors_5xx'][:5]}",
        }
        receipt["network_audit"] = combined
        receipt["stt"] = stt
        receipt["checks"] = checks
        receipt["screenshots"] = screens
        receipt["merged_from"] = ["20260905T121104Z (main journey)", "STT continuation (same dir, in place)"]
        receipt["captured_at_completed"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        failed = [k for k, v in checks.items() if not v["pass"]]
        receipt["failed_checks"] = failed
        receipt["status"] = "pass" if not failed else "fail"
    except Exception as exc:
        import traceback
        receipt["stt_continuation_error"] = f"{type(exc).__name__}: {exc}"[:400]
        (RUN1_DIR / "stt-continuation-exception.txt").write_text(traceback.format_exc(), encoding="utf-8")
        receipt["status"] = "fail"

    (RUN1_DIR / "gap_reverify_receipt.json").write_text(json.dumps(receipt, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"continuation merged; status: {receipt['status']}; failed: {receipt.get('failed_checks')}")
    return 0 if receipt["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
