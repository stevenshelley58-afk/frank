"""Generate a deterministic CycloneDX inventory from installed distributions."""

from __future__ import annotations

import json
import re
import sys
from importlib.metadata import distributions
from pathlib import Path


def normalized_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


components = []
for distribution in distributions():
    metadata = distribution.metadata
    name = metadata.get("Name")
    if not name:
        continue
    version = distribution.version
    license_name = metadata.get("License-Expression") or metadata.get("License")
    if not license_name:
        classifiers = metadata.get_all("Classifier") or []
        license_name = next((value.removeprefix("License :: ") for value in classifiers if value.startswith("License :: ")), "UNKNOWN")
    license_name = " ".join(str(license_name).split())[:512] or "UNKNOWN"
    components.append({
        "type": "library",
        "name": name,
        "version": version,
        "purl": f"pkg:pypi/{normalized_name(name)}@{version}",
        "licenses": [{"license": {"name": license_name}}],
    })

bom = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "version": 1,
    "metadata": {"component": {"type": "application", "name": "frank-codegraph"}},
    "components": sorted(components, key=lambda item: normalized_name(item["name"])),
}
destination = Path(sys.argv[1])
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(bom, indent=2, sort_keys=True) + "\n", encoding="utf-8")
