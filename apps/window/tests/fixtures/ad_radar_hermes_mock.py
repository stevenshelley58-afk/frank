"""Deterministic, test-only Hermes Tool Run service for Ad Radar browser QA."""

from __future__ import annotations

import argparse
import binascii
from functools import lru_cache
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import struct
import sys
import time
from urllib.parse import urlparse
import zlib

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from tool_apps.canonical import canonical_sha256


RUN_ID = "trun_" + ("d" * 32)


CREATIVE_ROWS = (
    ("northline-001", "Northline Homes", "changed", "Residential", "Lifestyle", "image", "Perth", "Primary media updated; headline unchanged.", "10:42:18"),
    ("kincoast-002", "Kin & Coast", "new", "Residential", "Social proof", "carousel", "Perth", "New public creative observed.", "10:38:07"),
    ("belmore-003", "Belmore Living", "quarantined", "Residential", "Offer", "video", "Fremantle", "Policy review required for the text overlay.", "10:29:33"),
    ("wattle-004", "Wattle & Frame", "approved", "Residential", "Authority", "image", "Subiaco", "Media and classification checks passed.", "09:54:12"),
    ("solway-005", "Solway Homes", "stopped", "Residential", "Listing", "video", "Joondalup", "Public ad is no longer active.", "09:31:45"),
    ("fernfield-006", "Fern & Field", "published", "Residential", "Lifestyle", "image", "Perth Hills", "Approved creative published to the fieldbook.", "09:14:02"),
)


def creative(row: tuple[str, ...]) -> dict:
    creative_id, advertiser, change, category, hook, kind, market, summary, clock = row
    hour, minute, second = clock.split(":")
    first_seen = f"2026-08-31T{hour}:{minute}:{second}Z"
    return {
        "id": creative_id,
        "source_ref": f"https://www.facebook.com/ads/library/?id={creative_id}",
        "advertiser": advertiser,
        "market": market,
        "category": category,
        "copy": {
            "headline": f"{advertiser} — a better way home",
            "body": summary,
            "cta": "Learn more",
        },
        "destination_ref": f"public://destination/{creative_id}",
        "observed": {
            "first_seen": first_seen,
            "last_seen": "2026-08-31T10:45:00Z",
        },
        "media": [{
            "asset_ref": f"media://{creative_id}",
            "kind": kind,
            "width": 1200,
            "height": 800,
            "qa_status": "passed",
        }],
        "classification": {
            "label": hook,
            "confidence": 0.94,
            "receipt_refs": [f"receipt://classification/{creative_id}"],
            "provenance_refs": [f"source://meta-public-au/{creative_id}"],
        },
        "_fixture_change": change,
    }


CREATIVES = [creative(row) for row in CREATIVE_ROWS]


def run_record(status: str = "awaiting_approval") -> dict:
    public_creatives = [{key: value for key, value in item.items() if key != "_fixture_change"} for item in CREATIVES]
    public_export = {
        "schema": "schema://frank.ad-intelligence-public/v1",
        "project": "blockwise",
        "generated_at": "2026-08-31T10:45:00Z",
        "creatives": public_creatives,
    }
    return {
        "id": RUN_ID,
        "tool_id": "ad-intelligence",
        "request_id": "req_synthetic_browser_qa",
        "status": status,
        "stage": "publish",
        "progress": 1,
        "attention": status == "awaiting_approval",
        "created_at": "2026-08-31T09:00:00Z",
        "updated_at": "2026-08-31T10:42:18Z",
        "scope": {"project_id": "blockwise"},
        "payload": {
            "job_name": "Perth public creative pulse",
            "settings_revision": 7,
            "source_ids": ["meta-public-au"],
            "research_brief": {
                "markets": ["Perth WA", "6000"],
                "advertisers": [item[1] for item in CREATIVE_ROWS],
                "query_terms": ["appraisal", "just listed", "new home"],
                "include_surrounding": True,
            },
        },
        "output": {
            "public_export": public_export,
            "metrics": {
                "discovered": 74,
                "resolved": 69,
                "captured": 68,
                "normalized": 68,
                "classified": 67,
                "media_ready": 66,
                "quarantined": 1,
                "published": 65,
            },
            "previews": [
                {"creative_id": item["id"], "name": f"{item['id']}.png", "kind": "image"}
                for item in CREATIVES
            ],
            "creative_states": [{
                "creative_id": item["id"],
                "status": item["_fixture_change"],
                "observation_id": f"obs-{item['id']}",
                "receipt_refs": [f"receipt://lifecycle/{item['id']}"],
            } for item in CREATIVES],
            "receipts": [
                {"kind": "classification", "receipt_ref": "receipt://classification/run-synthetic", "status": "passed", "stage": "classify"},
                {"kind": "media-qa", "receipt_ref": "receipt://media-qa/run-synthetic", "status": "passed", "stage": "media-qa"},
                {"kind": "pii-scan", "receipt_ref": "receipt://pii-scan/run-synthetic", "status": "passed", "stage": "publish"},
            ],
            "approval": {
                "expected_checksum": canonical_sha256(public_export),
                "expected_settings_revision": 7,
                "state": "pending",
                "summary": "QA, provenance, PII, and secret scans passed.",
            },
            "health": {
                "status": "ready",
                "stage": "publish",
                "last_run_at": "2026-08-31T10:42:18Z",
                "published": 65,
                "quarantined": 1,
            },
            "cost": {"reported_usd": 0.83},
            "usage": {"input_tokens": 28410, "output_tokens": 6122, "total_tokens": 34532},
        },
    }


def event_rows() -> list[dict]:
    events = []
    for sequence, item in enumerate(CREATIVES, start=1):
        change = item["_fixture_change"]
        events.append({
            "sequence": sequence,
            "kind": "creative-observed" if change not in {"quarantined", "published"} else (
                "creative-quarantined" if change == "quarantined" else "publish-completed"
            ),
            "status": "quarantined" if change == "quarantined" else "ok",
            "timestamp": item["observed"]["first_seen"],
            "node_id": "publish" if change == "published" else "capture",
            "data": {
                "creative_id": item["id"],
                "observation_id": f"obs-{item['id']}",
                "advertiser": item["advertiser"],
                "change": change,
                "summary": item["copy"]["body"],
                "source_id": "meta-public-au",
            },
        })
    return events


def _rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)


@lru_cache(maxsize=12)
def artwork(name: str) -> bytes:
    palettes = (
        ("#193629", "#a6c0aa", "#eee2d0"),
        ("#28363f", "#c8a277", "#e8dfd1"),
        ("#473431", "#d3a76f", "#f3e7d7"),
        ("#24313b", "#9aafbd", "#dbe1df"),
        ("#342f29", "#bda880", "#e6ddce"),
        ("#243b31", "#8da88e", "#eee8dc"),
    )
    index = sum(name.encode("utf-8")) % len(palettes)
    dark, middle, light = (_rgb(color) for color in palettes[index])
    width, height = 600, 400
    white = (248, 246, 240)
    glass = (168, 194, 205)
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            color = light if y < 260 else middle
            if (x - 540) ** 2 + (y - 82) ** 2 < 38 ** 2:
                color = white
            left_roof = 72 <= x <= 315 and 126 <= y <= 268 and (
                y >= 268 - int((x - 72) * 142 / 108) if x < 180 else y >= 126 + int((x - 180) * 142 / 135)
            )
            right_roof = 285 <= x <= 578 and 160 <= y <= 268 and (
                y >= 268 - int((x - 285) * 108 / 90) if x < 375 else y >= 160 + int((x - 375) * 108 / 203)
            )
            if left_roof:
                color = dark
            if right_roof:
                color = white
            if 95 <= x <= 280 and 178 <= y <= 268:
                color = white
            if 112 <= x <= 160 and 198 <= y <= 268:
                color = middle
            if 175 <= x <= 248 and 198 <= y <= 238:
                color = glass
            if 380 <= x <= 535 and 200 <= y <= 268:
                color = dark
            wave = 286 + int(17 * ((x % 180) / 180))
            if y >= wave:
                color = tuple(min(255, channel + 28) for channel in middle)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + _png_chunk(b"IEND", b"")


class Handler(BaseHTTPRequestHandler):
    server_version = "AdRadarHermesMock/1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[ad-radar-mock] {self.address_string()} {fmt % args}")

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path == "/v1/tool-runs":
            self.send_json({"runs": [run_record()]})
            return
        if path == f"/v1/tool-runs/{RUN_ID}":
            self.send_json({"run": run_record()})
            return
        if path == f"/v1/tool-runs/{RUN_ID}/events":
            body = "".join(
                f"id: {event['sequence']}\nevent: {event['kind']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"
                for event in event_rows()
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                self.wfile.write(body)
                self.wfile.flush()
                while True:
                    time.sleep(10)
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        prefix = f"/v1/tool-runs/{RUN_ID}/artifacts/"
        if path.startswith(prefix) and path.endswith(".png"):
            body = artwork(path.removeprefix(prefix))
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json({"error": {"message": "not found"}}, 404)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        if path == "/v1/tool-runs":
            if payload.get("tool_id") != "ad-intelligence" or payload.get("action") != "run":
                self.send_json({"error": {"message": "unsupported synthetic command"}}, 400)
                return
            self.send_json({"run": run_record("queued")}, 202)
            return
        action_prefix = f"/v1/tool-runs/{RUN_ID}/"
        if path.startswith(action_prefix) and path.removeprefix(action_prefix) in {"retry", "pause", "approval"}:
            action = path.removeprefix(action_prefix)
            status = {"retry": "running", "pause": "paused", "approval": "published"}[action]
            self.send_json({"run": run_record(status)})
            return
        self.send_json({"error": {"message": "not found"}}, 404)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8642)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Ad Radar Hermes mock listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
