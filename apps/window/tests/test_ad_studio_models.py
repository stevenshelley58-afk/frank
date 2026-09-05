import unittest
from unittest import mock

import server


def candidate(model, *, available=True):
    return {
        "provider": "openai-codex",
        "model": model,
        "capabilities": ["vision_structured"],
        "supports_vision": True,
        "supports_tools": True,
        "available": available,
        "credential_ready": available,
    }


def policy():
    routes = {
        "analyse": "gpt-5.6-sol",
        "compare": "gpt-5.6-luna",
        "final-review-a": "gpt-5.6-luna",
        "final-review-b": "gpt-5.6-sol",
        "quality-escalation": "gpt-5.6-sol",
    }
    return {
        "schema": "schema://hermes.tool-model-policy/v1",
        "tool_id": "ad-template-generator",
        "name": "Sole ad-template process",
        "preset": "cheap-quality",
        "seed_revision": 9,
        "stages": {
            stage: {
                "capability": "vision_structured",
                "primary": {
                    **candidate(model),
                    "capability_verified": True,
                },
                "fallbacks": [],
                "max_attempts": 1,
                "timeout_seconds": 120,
                "max_cost_usd": 0.35,
            }
            for stage, model in routes.items()
        },
        "deterministic_stages": ["qa", "import"],
    }


class AdStudioModelsTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_catalogue_and_default_policy_are_projected_from_hermes(self):
        calls = []

        def hermes(path, **kwargs):
            calls.append(path)
            if path == "/v1/tool-runs/models":
                return {
                    "policy_schema": "schema://hermes.tool-model-policy/v1",
                    "ad_studio_capabilities": [
                        candidate("gpt-5.6-sol"),
                        candidate("image-only") | {"capabilities": ["masked_image_edit"]},
                    ],
                }
            return {"data": [{"revision": 12, "is_default": True, "policy": policy()}]}

        with mock.patch.object(server, "hermes_request", side_effect=hermes):
            response = self.client.get("/api/ad-studio/models?project_id=blockwise")

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual([(item["provider"], item["model"]) for item in body["models"]], [("openai-codex", "gpt-5.6-sol")])
        self.assertEqual(body["policy_revision"], 12)
        self.assertEqual(body["policy"]["stages"]["analyse"]["primary"]["model"], "gpt-5.6-sol")
        self.assertIn("project_id=blockwise", calls[1])

    def test_policy_validation_uses_live_hermes_availability_and_replaces_browser_claims(self):
        selected = policy()
        selected["stages"]["compare"]["primary"] = {
            "provider": "openai-codex", "model": "gpt-5.6-luna",
            "capability_verified": False, "capabilities": [],
            "supports_vision": False, "supports_tools": False,
        }
        catalogue = {
            "models": [candidate("gpt-5.6-sol"), candidate("gpt-5.6-luna")],
            "policy_schema": "schema://hermes.tool-model-policy/v1",
            "policy_revision": 12,
            "policy": policy(),
        }
        with mock.patch.object(server, "_ad_studio_model_catalogue", return_value=catalogue):
            result = server._validated_ad_studio_model_policy(selected, project_id="blockwise")
        comparator = result["stages"]["compare"]["primary"]
        self.assertTrue(comparator["capability_verified"])
        self.assertTrue(comparator["supports_vision"])
        self.assertEqual(comparator["capabilities"], ["vision_structured"])

    def test_unavailable_selected_model_fails_without_silent_fallback(self):
        selected = policy()
        selected["stages"]["compare"]["primary"]["model"] = "offline-model"
        catalogue = {
            "models": [candidate("gpt-5.6-sol"), candidate("offline-model", available=False)],
            "policy": policy(),
        }
        with (
            mock.patch.object(server, "_ad_studio_model_catalogue", return_value=catalogue),
            self.assertRaisesRegex(server._AdStudioSourceError, "not currently available"),
        ):
            server._validated_ad_studio_model_policy(selected, project_id="blockwise")

    def test_run_projection_exposes_immutable_model_snapshot_not_chat_state(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-models",
            "status": "queued",
            "model_policy_revision": 14,
            "model_policy": policy(),
        })
        self.assertEqual(projected["model_policy_revision"], 14)
        roles = {item["role"]: item for item in projected["model_profile"]["roles"]}
        self.assertEqual(roles["builder"]["provider"], "openai-codex")
        self.assertEqual(roles["builder"]["model"], "gpt-5.6-sol")
        self.assertEqual(roles["comparator"]["model"], "gpt-5.6-luna")


if __name__ == "__main__":
    unittest.main()
