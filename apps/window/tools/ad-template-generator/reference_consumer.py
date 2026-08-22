"""Small provider-neutral consumer used by conformance tests and documentation."""

from __future__ import annotations

from copy import deepcopy
import html
from typing import Any, Mapping

from template_pack import validate


def import_pack(pack: Mapping[str, Any]) -> dict[str, Any]:
    errors = validate(pack)
    if errors:
        raise ValueError("; ".join(errors))
    return {
        "pack_id": pack["id"],
        "layouts": deepcopy(pack["layouts"]),
        "document": deepcopy(pack["document"]),
        "fields": deepcopy(pack["fields"]),
        "ad": deepcopy(pack["ad"]),
        "editor": deepcopy(pack["editor"]),
    }


def prepare_ad(imported: Mapping[str, Any], values: Mapping[str, Any], *, placement: str) -> dict[str, Any]:
    if placement not in imported["layouts"]:
        raise ValueError("unsupported placement")
    known = {item["id"] for group in ("images", "text") for item in imported["fields"].get(group, [])}
    unknown = set(values) - known
    if unknown:
        raise ValueError(f"unknown field: {sorted(unknown)[0]}")
    return {"pack_id": imported["pack_id"], "placement": placement, "layout": deepcopy(imported["layouts"][placement]), "values": dict(values), "ad": deepcopy(imported["ad"])}


def render_svg(prepared: Mapping[str, Any]) -> str:
    """Deterministic reference rendering for conformance, not a browser editor."""
    layout = prepared["layout"]
    width, height = int(layout.get("width") or 1080), int(layout.get("height") or 1080)
    body: list[str] = []
    for layer in layout.get("layers") or []:
        geometry = layer.get("geometry") or {}
        x, y = geometry.get("x", 0), geometry.get("y", 0)
        w, h = geometry.get("width", width), geometry.get("height", height)
        if layer.get("type") == "plate":
            body.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#fff"/>')
        elif layer.get("type") == "text":
            value = html.escape(str(prepared["values"].get(layer.get("inputKey"), "")))
            body.append(f'<text x="{x}" y="{y + layer.get("fontSize", 24)}" font-size="{layer.get("fontSize", 24)}">{value}</text>')
        elif layer.get("type") == "image_slot":
            value = html.escape(str(prepared["values"].get(layer.get("inputKey"), "")), quote=True)
            body.append(f'<image href="{value}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{"".join(body)}</svg>'
