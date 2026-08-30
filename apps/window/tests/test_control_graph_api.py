import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph.control_contract import materialize_control_graph
from graph.control_store import ControlGraphStore
import server
import control_plane_view


class ControlGraphApiTests(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        graph, assertions, manifest = materialize_control_graph({
            "nodes": [{
                "id": "service:frank-window", "kind": "service", "title": "Frank Window",
                "state_axes": {"lifecycle": "approved", "trust": "reviewed", "installation": "installed", "enablement": "enabled", "production_authority": "operate"},
            }],
            "relationships": [],
        }, receipt_ids=["receipt:control/api"])
        store = ControlGraphStore(self.root / "control-graph")
        store.write_generation(graph["graph_revision"], graph, assertions, manifest)
        store.advance_current(graph["graph_revision"])

    def tearDown(self):
        control_plane_view._SNAPSHOT_CACHE.clear()
        self.temp.cleanup()

    def test_snapshot_cache_reuses_validated_generation_and_invalidates_selector(self):
        env = {"FRANK_PREVIEW": "1", "CONTROL_GRAPH_ROOT": str(self.root / "control-graph")}
        with patch.dict(os.environ, env, clear=False), patch.object(control_plane_view.ControlProvider, "get", wraps=control_plane_view._control_provider().get) as get:
            first = control_plane_view._snapshot()
            second = control_plane_view._snapshot()
            self.assertIn(first["status"], {"ready", "attention"})
            self.assertEqual(second["status"], first["status"])
            self.assertEqual(get.call_count, 1)
            selector = self.root / "control-graph" / "graph" / "current.json"
            selector.write_text(selector.read_text(encoding="utf-8"), encoding="utf-8")
            control_plane_view._snapshot()
            self.assertEqual(get.call_count, 2)

    def test_snapshot_cache_does_not_pin_unavailable_result(self):
        env = {"CONTROL_GRAPH_ROOT": str(self.root / "control-graph")}
        unavailable = {"status": "unavailable", "manifest": None, "graph": None, "assertions": None, "findings": None}
        with patch.dict(os.environ, env, clear=False), patch.object(control_plane_view.ControlProvider, "get", side_effect=[unavailable, unavailable]) as get:
            control_plane_view._snapshot()
            control_plane_view._snapshot()
        self.assertEqual(get.call_count, 2)

    def test_flags_are_off_by_default_and_preview_is_explicit(self):
        with patch.dict(os.environ, {"CONTROL_GRAPH_ROOT": str(self.root / "control-graph")}, clear=False):
            os.environ.pop("FRANK_PREVIEW", None)
            result = self.client.get("/api/control/overview")
            self.assertFalse(result.json["feature_flags"]["control_read"])
            self.assertEqual(result.json["control"]["status"], "disabled")
            with patch.dict(os.environ, {"FRANK_PREVIEW": "1"}, clear=False):
                result = self.client.get("/api/control/records?category=systems")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json["records"][0]["id"], "service:frank-window")

    def test_map_declarations_are_listed_without_inventing_current_artifacts(self):
        with patch.dict(os.environ, {"FRANK_PREVIEW": "1", "CONTROL_GRAPH_ROOT": str(self.root / "control-graph")}, clear=False):
            payload = self.client.get("/api/control/projections").json
            self.assertEqual(len(payload["projections"]), 7)
            self.assertFalse(next(item for item in payload["projections"] if item["projection_id"] == "projection:vps/world")["available"])

    def test_import_is_preview_only_and_agenttrail_mutations_are_denied(self):
        with patch.dict(os.environ, {"FRANK_PREVIEW": "1", "CONTROL_GRAPH_ROOT": str(self.root / "control-graph")}, clear=False):
            response = self.client.post("/api/control/import/preview", json={"schema": "schema://fixture", "source_revision": "rev_fixture"})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json["applies"])
            self.assertEqual(self.client.post("/agenttrail/spawn", json={}).status_code, 403)

    def test_agenttrail_board_is_same_origin_and_read_only(self):
        class Upstream:
            headers = {"Content-Type": "text/html; charset=utf-8"}

            def read(self, _limit=-1):
                return b"<script>fetch('/world'); const e = new EventSource('/events')</script>"

            def close(self):
                return None

        with patch.object(server, "AGENTTRAIL_URL", "http://127.0.0.1:5340"), patch.object(server.urllib.request, "urlopen", return_value=Upstream()):
            response = self.client.get("/agenttrail/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("fetch('/agenttrail/world')", response.get_data(as_text=True))
        self.assertIn("EventSource('/agenttrail/events'", response.get_data(as_text=True))

    def test_agenttrail_events_forwards_small_sse_frames_without_waiting_for_buffer(self):
        class Upstream:
            headers = {"Content-Type": "text/event-stream; charset=utf-8"}

            def __init__(self):
                self.calls = []

            def read1(self, limit):
                self.calls.append(limit)
                return b"data: {\"partial\":true}\n\n" if len(self.calls) == 1 else b""

            def close(self):
                return None

        upstream = Upstream()
        with patch.object(server, "AGENTTRAIL_URL", "http://127.0.0.1:5340"), patch.object(server.urllib.request, "urlopen", return_value=upstream):
            response = self.client.get("/agenttrail/events")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_data(), b"data: {\"partial\":true}\n\n")
        self.assertEqual(upstream.calls, [64 * 1024, 64 * 1024])


if __name__ == "__main__":
    unittest.main()
