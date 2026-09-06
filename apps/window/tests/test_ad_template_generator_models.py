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


def image_candidate(provider="meta-direct", model="muse-image-1.0", capability="reference_image_edit", *, available=True):
    return {
        "provider": provider,
        "model": model,
        "capability": capability,
        "capabilities": [capability],
        "capability_verified": True,
        "supports_vision": True,
        "supports_tools": False,
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
    stages = {
        stage: {
            "capability": "vision_structured",
            "primary": {**candidate(model), "capability_verified": True},
            "fallbacks": [],
            "max_attempts": 1,
            "timeout_seconds": 120,
            "max_cost_usd": 0.35,
        }
        for stage, model in routes.items()
    }
    photo = image_candidate()
    stages["aspect-reference-image"] = {
        "capability": photo["capability"],
        "primary": {key: photo[key] for key in (
            "provider", "model", "capability_verified", "capabilities", "supports_vision", "supports_tools"
        )},
        "fallbacks": [],
        "max_attempts": 1,
        "timeout_seconds": 180,
        "max_cost_usd": 0.35,
    }
    return {
        "schema": "schema://hermes.tool-model-policy/v1",
        "tool_id": "ad-template-generator",
        "name": "Sole ad-template process",
        "preset": "cheap-quality",
        "seed_revision": 9,
        "stages": stages,
        "deterministic_stages": ["qa", "import"],
    }


class AdTemplateGeneratorModelsTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_catalogue_and_default_policy_are_projected_from_hermes(self):
        calls = []

        def hermes(path, **kwargs):
            calls.append(path)
            if path == "/v1/tool-runs/models":
                return {
                    "policy_schema": "schema://hermes.tool-model-policy/v1",
                    "ad_template_generator_capabilities": [
                        candidate("gpt-5.6-sol"),
                        image_candidate(),
                        image_candidate("openai-codex", "gpt-image-2-high", "masked_image_edit"),
                        image_candidate("openai-api", "generic-image", "masked_image_edit"),
                    ],
                }
            return {"data": [{"revision": 12, "is_default": True, "policy": policy()}]}

        with mock.patch.object(server, "hermes_request", side_effect=hermes):
            response = self.client.get("/api/ad-template-generator/models?project_id=blockwise")

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual([(item["provider"], item["model"]) for item in body["models"]], [("openai-codex", "gpt-5.6-sol")])
        self.assertEqual(body["policy_revision"], 12)
        self.assertEqual(body["policy"]["stages"]["analyse"]["primary"]["model"], "gpt-5.6-sol")
        self.assertEqual(
            [(item["provider"], item["model"], item["capability"]) for item in body["image_models"]],
            [
                ("meta-direct", "muse-image-1.0", "reference_image_edit"),
                ("openai-codex", "gpt-image-2-high", "masked_image_edit"),
            ],
        )
        self.assertEqual(body["policy"]["stages"]["aspect-reference-image"]["primary"]["model"], "muse-image-1.0")
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
            "image_models": [image_candidate()],
            "policy_schema": "schema://hermes.tool-model-policy/v1",
            "policy_revision": 12,
            "policy": policy(),
        }
        with mock.patch.object(server, "_ad_template_generator_model_catalogue", return_value=catalogue):
            result = server._validated_ad_template_generator_model_policy(selected, project_id="blockwise")
        comparator = result["stages"]["compare"]["primary"]
        self.assertTrue(comparator["capability_verified"])
        self.assertTrue(comparator["supports_vision"])
        self.assertEqual(comparator["capabilities"], ["vision_structured"])

    def test_photo_assets_route_uses_audited_image_capability_without_tool_claims(self):
        selected = policy()
        selected["stages"]["aspect-reference-image"]["primary"] = {
            "provider": "meta-direct", "model": "muse-image-1.0",
            "capability_verified": False, "capabilities": [],
            "supports_vision": False, "supports_tools": True,
        }
        catalogue = {
            "models": [candidate("gpt-5.6-sol"), candidate("gpt-5.6-luna")],
            "image_models": [image_candidate()],
            "policy": policy(),
        }
        with mock.patch.object(server, "_ad_template_generator_model_catalogue", return_value=catalogue):
            result = server._validated_ad_template_generator_model_policy(selected, project_id="blockwise")
        photo = result["stages"]["aspect-reference-image"]
        self.assertEqual(photo["capability"], "reference_image_edit")
        self.assertEqual(photo["primary"]["capabilities"], ["reference_image_edit"])
        self.assertFalse(photo["primary"]["supports_tools"])

    def test_unavailable_selected_model_fails_without_silent_fallback(self):
        selected = policy()
        selected["stages"]["compare"]["primary"]["model"] = "offline-model"
        catalogue = {
            "models": [candidate("gpt-5.6-sol"), candidate("offline-model", available=False)],
            "image_models": [image_candidate()],
            "policy": policy(),
        }
        with (
            mock.patch.object(server, "_ad_template_generator_model_catalogue", return_value=catalogue),
            self.assertRaisesRegex(server._AdTemplateGeneratorSourceError, "not currently available"),
        ):
            server._validated_ad_template_generator_model_policy(selected, project_id="blockwise")

    def test_run_projection_exposes_immutable_model_snapshot_not_chat_state(self):
        projected = server._public_ad_template_generator_run({
            "run_id": "trun-models",
            "status": "queued",
            "model_policy_revision": 14,
            "model_policy": policy(),
        })
        self.assertEqual(projected["model_policy_revision"], 14)
        roles = {item["role"]: item for item in projected["model_profile"]["roles"]}
        self.assertEqual(roles["photo-assets"]["provider"], "meta-direct")
        self.assertEqual(roles["photo-assets"]["model"], "muse-image-1.0")
        self.assertEqual(roles["builder"]["provider"], "openai-codex")
        self.assertEqual(roles["builder"]["model"], "gpt-5.6-sol")
        self.assertEqual(roles["comparator"]["model"], "gpt-5.6-luna")


if __name__ == "__main__":
    unittest.main()
