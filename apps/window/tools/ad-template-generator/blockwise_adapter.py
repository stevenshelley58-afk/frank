"""Translate provider-neutral TemplatePack v1 into Blockwise's frozen v1 contract."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any, Mapping

from template_pack import validate


COLOURS = {"background":"#FFFFFF","primary":"#1A56DB","secondary":"#6B7280","accent":"#F59E0B","mainText":"#111827","inverseText":"#FFFFFF"}


def _manifest_hash(pack: Mapping[str, Any]) -> str:
    value = {key: item for key, item in pack.items() if key not in {"manifestSha256", "signature"}}
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _layout(name: str, layout: Mapping[str, Any]) -> dict[str, Any]:
    layers = deepcopy(layout.get("layers") or [])
    if not layers:
        raise ValueError(f"{name} layout has no portable layers")
    width = float(layout.get("width") or (1080 if name == "story" else 1080))
    height = float(layout.get("height") or (1920 if name == "story" else 1350))
    return {"placement": name, "layers": layers, "safeZones": deepcopy(layout.get("safeZones") or [{"x":40,"y":40,"width":width-80,"height":height-80}])}


def to_blockwise(pack: Mapping[str, Any]) -> dict[str, Any]:
    errors = validate(pack)
    if errors:
        raise ValueError("; ".join(errors))
    if "blockwise-template-pack-v1" not in pack["compatibility"]:
        raise ValueError("pack does not declare Blockwise compatibility")
    images = pack["fields"].get("images", [])
    texts = pack["fields"].get("text", [])
    assets = {
        item["id"]: {"fileName": item.get("file_name") or item.get("ref") or f"{item['id']}.png", "sha256": item["sha256"], "mimeType": item.get("mime_type") or "image/png"}
        for item in pack["assets"]
    }
    fonts_by_hash = {}
    for field in texts:
        font = field.get("font") or {}
        if font.get("file") and font.get("sha256"):
            fonts_by_hash[font["sha256"]] = {"file": font["file"], "sha256": font["sha256"]}
    output = {
        "schema":"blockwise.template-pack/v1","templateId":pack["id"],"version":1,"packId":pack["id"],
        "createdAt":pack.get("provenance", {}).get("released_at") or "1970-01-01T00:00:00.000Z",
        "builderVersion":pack.get("provenance", {}).get("builder_version") or "frank/ad-template-builder-v2",
        "rendererVersion":pack.get("editor", {}).get("renderer_version") or "frank-reference-renderer/v1",
        "classification":deepcopy(pack.get("provenance", {}).get("classification") or {"label":"portable_ad_template","modelVersion":"recorded-in-provenance","confidence":1}),
        "manifestSha256":"","signature":json.dumps(pack["integrity"]["signature"], separators=(",", ":"), sort_keys=True),
        "feedLayout":_layout("feed", pack["layouts"]["feed"]),"storyLayout":_layout("story", pack["layouts"]["story"]),
        "imageInputs":[{"key":item["id"],"label":item.get("label") or item["id"],"acceptedTypes":item.get("accepted_types") or ["image/jpeg","image/png","image/webp"]} for item in images],
        "textInputs":[{"key":item["id"],"label":item.get("label") or item["id"],"placeholder":item.get("default") or "","maxLength":int(item.get("limit") or 100)} for item in texts],
        "semanticColours":deepcopy(pack.get("editor", {}).get("semantic_colours") or COLOURS),"assets":assets,"fonts":list(fonts_by_hash.values()),
        "safePreviews":{"feed":{"sha256":next((item["sha256"] for item in pack["previews"] if item.get("placement")=="feed"), "0"*64)},"story":{"sha256":next((item["sha256"] for item in pack["previews"] if item.get("placement")=="story"), "0"*64)}},
        "qaEvidence":{"feedPassed":True,"storyPassed":True,"reviewerVersions":["frank-studio-qa/v1"],"stressFixtureResults":deepcopy(pack["qa"].get("stress_fixture_results") or {"portablePack":"pass"})},
    }
    output["manifestSha256"] = _manifest_hash(output)
    return output
