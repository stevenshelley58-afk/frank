import importlib.util
from pathlib import Path
import sys
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


PACKAGE = Path(__file__).resolve().parents[1] / "tools" / "ad-template-generator"
sys.path.insert(0, str(PACKAGE))
import template_pack
import blockwise_adapter
import reference_consumer


def candidate():
    return {
        "schema":"schema://frank.template-pack/v1","pack_version":"1.0.0","id":"pack_demo_1",
        "compatibility":["blockwise-template-pack-v1","frank-reference-consumer-v1"],
        "document":{"canvas":{"width":1080,"height":1080},"layers":[{"id":"photo","type":"image-slot"},{"id":"headline","type":"text"}]},
        "layouts":{"feed":{"width":1080,"height":1350,"layers":[{"type":"plate","layerId":"bg","colourRole":"background","geometry":{"x":0,"y":0,"width":1080,"height":1350},"protected":False}],"safeZones":[{"x":40,"y":40,"width":1000,"height":1270}]},"story":{"width":1080,"height":1920,"layers":[{"type":"plate","layerId":"bg","colourRole":"background","geometry":{"x":0,"y":0,"width":1080,"height":1920},"protected":False}],"safeZones":[{"x":40,"y":200,"width":1000,"height":1520}]}},
        "assets":[{"id":"plate","kind":"sanitized-plate","file_name":"plate.png","mime_type":"image/png","sha256":"1"*64}],
        "fields":{"images":[{"id":"photo","width":1080,"height":1080,"crop":"cover","focal":[0.5,0.5],"minimum_resolution":[1080,1080],"clip":"canvas","effects":[]}],"text":[{"id":"headline","default":"Your headline","limit":40,"font_ref":"font/inter"}],"baked":[]},
        "ad":{"copy":{"primary_text":{"default":"Primary text","variant_limit":5},"headline":{"default":"Headline","variant_limit":5},"description":{"default":"Description","variant_limit":5}},"cta":{"allowed":["LEARN_MORE"],"default":"LEARN_MORE"},"destination":{"required":True,"scheme":"https"},"lead_form":{"enabled":True,"questions":[{"id":"email","type":"email","required":True}],"consent_text":"I agree","policy_link_placeholder":"{{privacy_policy_url}}"},"meta":{"placement_routing":{"feed":"feed","story":"story"},"creative_features":[]}},
        "editor":{"version":1,"renderer_version":"frank-reference-renderer/v1","controls":["photo","headline"]},"previews":[{"placement":"feed","asset_ref":"preview/feed.png","sha256":"3"*64,"deterministic":True},{"placement":"story","asset_ref":"preview/story.png","sha256":"4"*64,"deterministic":True}],
        "provenance":{"hashes":{"document":"2"*64},"model_policy_revision":3,"release_trace_ref":"trace:abc","sanitization_receipt":"receipt:abc"},
        "qa":{"all_gates_passed":True,"subject_invariance_passed":True,"source_identity_leakage":0,"evidence_refs":["qa:abc"]},
        "approval":{"confirmed_100_percent":True,"decision":"approved"},"integrity":{}
    }


class TemplatePackV1Test(unittest.TestCase):
    def test_signed_pack_imports_in_reference_and_blockwise_consumers(self):
        key = Ed25519PrivateKey.generate()
        pack = template_pack.sign(candidate(), key, key_id="release-2026")
        self.assertEqual(template_pack.validate(pack), [])
        self.assertTrue(template_pack.verify_signature(pack, key.public_key()))
        imported = reference_consumer.import_pack(pack)
        prepared = reference_consumer.prepare_ad(imported, {"headline":"New copy","photo":"asset:new"}, placement="feed")
        self.assertEqual(prepared["placement"], "feed")
        rendered = reference_consumer.render_svg(prepared)
        self.assertIn('width="1080"', rendered)
        self.assertIn("<rect", rendered)
        blockwise = blockwise_adapter.to_blockwise(pack)
        self.assertEqual(blockwise["packId"], "pack_demo_1")
        self.assertEqual(blockwise_adapter._manifest_hash(blockwise), blockwise["manifestSha256"])

    def test_rejects_private_source_and_failed_gates(self):
        pack = candidate()
        pack["raw_source"] = "/vps/private/source.png"
        pack["qa"]["subject_invariance_passed"] = False
        pack["integrity"] = {"checksum":"0"*64}
        errors = template_pack.validate(pack)
        self.assertTrue(any("private" in error for error in errors))
        self.assertTrue(any("QA" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
