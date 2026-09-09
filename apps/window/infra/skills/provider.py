"""Provider snapshot: the one canonical skills library as Frank views it."""
from __future__ import annotations

import json
from pathlib import Path

from .inventory import SKILL_INVENTORY_SCHEMA

PROVIDER_SCHEMA = "schema://frank.skills-provider/v1"


def provider_snapshot(catalogue_root: Path, *, max_preview_chars: int = 20_000) -> dict:
    """Snapshot for the existing library/entity-home widget mechanism.

    States are explicit: ready, empty, stale, unavailable, error. The
    browser receives display metadata only; SKILL.md text is exposed via
    the bounded read-only inspector, never as rendered HTML.
    """
    catalogue_root = Path(catalogue_root)
    catalog_path = catalogue_root / "catalog.json"
    if not catalogue_root.is_dir():
        return {"schema": PROVIDER_SCHEMA, "state": "unavailable", "detail": "catalogue root missing", "source_truth": "filesystem", "skills": []}
    if not catalog_path.is_file():
        return {"schema": PROVIDER_SCHEMA, "state": "empty", "detail": "canonical tree not cut over yet", "source_truth": "filesystem", "skills": []}
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {"schema": PROVIDER_SCHEMA, "state": "error", "detail": "catalog unreadable", "source_truth": "filesystem", "skills": []}
    skills = []
    stale = False
    for item in catalog.get("included", []):
        skill_dir = catalogue_root / item["path"]
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            stale = True
            skills.append({"name": item["name"], "validation": "error", "detail": "SKILL.md missing from canonical tree"})
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            stale = True
            continue
        description = ""
        for line in text.splitlines():
            if line.startswith("description:"):
                description = line[len("description:"):].strip()[:300]
                break
        skills.append(
            {
                "name": item["name"],
                "path": item["path"],
                "validation": "valid",
                "description": description,
                "scope": item.get("scope", "operator"),
                "preview_available_chars": min(len(text), max_preview_chars),
            }
        )
    state = "stale" if stale else "ready"
    return {
        "schema": PROVIDER_SCHEMA,
        "state": state,
        "source_truth": "filesystem",
        "skills": skills,
    }


def read_skill_source(catalogue_root: Path, skill_path: str, *, max_chars: int = 20_000) -> dict:
    """Bounded read-only SKILL.md text for the existing file-view pattern."""
    catalogue_root = Path(catalogue_root).resolve()
    target = (catalogue_root / skill_path).resolve()
    try:
        target.relative_to(catalogue_root)
    except ValueError as error:
        raise ValueError("skill path escapes the catalogue") from error
    if target.is_symlink() or not target.is_file():
        raise ValueError("skill source is unavailable")
    if target.name not in {"SKILL.md", ".frank-skill-scope.json"}:
        raise ValueError("only skill sources can be inspected")
    text = target.read_text(encoding="utf-8", errors="replace")[:max_chars]
    return {"path": skill_path, "text": text, "truncated": target.stat().st_size > max_chars}
