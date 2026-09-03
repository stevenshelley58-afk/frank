"""Shared-skills inventory for the one canonical operator library.

Enumerates skill directories containing ``SKILL.md`` without executing any
content. Runtime-owned ``.system``/packaged skills stay in place and are
excluded from the canonical tree. Same-name collisions are hashed and
quarantined — two skill folders are never merged implicitly.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SKILL_INVENTORY_SCHEMA = "schema://frank.skills-inventory/v1"
_FRONTMATTER_NAME = re.compile(r"^name:\s*(.+)$", re.MULTILINE)
_FRONTMATTER_DESC = re.compile(r"^description:\s*(.+)$", re.MULTILINE)
_FRONTMATTER_BOUNDARY = re.compile(r"^---\s*$", re.MULTILINE)
_MAX_REFERENCED_FILES = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class SkillRecord:
    name: str
    source_root: str
    path: str
    classification: str  # operator | runtime-owned
    description: str
    checksum: str
    referenced_files: list[str] = field(default_factory=list)
    validation: str = "unknown"  # valid | error
    validation_detail: str = ""
    provenance: str = ""
    compatibility: str = ""
    collision_with: str = ""
    last_checked: str = field(default_factory=_now)

    def public(self) -> dict:
        return {
            "name": self.name,
            "classification": self.classification,
            "description": self.description,
            "checksum": self.checksum,
            "validation": self.validation,
            "validation_detail": self.validation_detail,
            "provenance": self.provenance,
            "compatibility": self.compatibility,
            "collision_with": self.collision_with,
            "last_checked": self.last_checked,
        }


def _hash_dir(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        if item.is_file() and not item.is_symlink():
            digest.update(str(item.relative_to(path)).encode("utf-8"))
            digest.update(item.read_bytes())
    return digest.hexdigest()[:32]


def _referenced_files(skill_md: Path, skill_dir: Path) -> tuple[list[str], list[str]]:
    """Safe local files referenced by SKILL.md text (never executed).

    Returns ``(references, escapes)``: references include files that must
    exist at validation time; escapes are attempts to point outside the
    skill directory and are validation errors.
    """
    references, escapes = [], []
    try:
        text = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return references, escapes
    for match in re.finditer(r"[\w./-]+\.(?:md|txt|py|sh|json|ya?ml|csv)", text):
        raw = match.group(0)
        candidate = (skill_dir / raw).resolve()
        try:
            candidate.relative_to(skill_dir.resolve())
        except ValueError:
            if len(escapes) < _MAX_REFERENCED_FILES:
                escapes.append(raw)
            continue
        if len(references) < _MAX_REFERENCED_FILES:
            references.append(candidate.relative_to(skill_dir).as_posix())
    return references, escapes


def validate_skill(record: SkillRecord, skill_dir: Path) -> SkillRecord:
    """Fail-closed structural validation; broken skills are marked, never faked."""
    if record.validation == "error":
        return record
    skill_md = skill_dir / "SKILL.md"
    try:
        text = skill_md.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        record.validation = "error"
        record.validation_detail = "SKILL.md unreadable"
        return record
    boundaries = _FRONTMATTER_BOUNDARY.findall(text[:4000])
    if len(boundaries) < 2 or not text.startswith("---"):
        record.validation = "error"
        record.validation_detail = "invalid frontmatter"
        return record
    name_match = _FRONTMATTER_NAME.search(text)
    desc_match = _FRONTMATTER_DESC.search(text)
    if not name_match or not desc_match:
        record.validation = "error"
        record.validation_detail = "frontmatter missing name or description"
        return record
    for relative in record.referenced_files:
        candidate = skill_dir / relative
        if not candidate.is_file() or candidate.is_symlink():
            record.validation = "error"
            record.validation_detail = f"unreadable reference: {relative}"
            return record
    record.validation = "valid"
    return record


def inventory_root(source_root: Path, *, production_active_names: set[str] | None = None) -> dict:
    """Inventory one skill root without executing anything.

    ``production_active_names`` marks skills whose Hermes production version
    must be preserved when the same name exists in several roots.
    """
    source_root = Path(source_root)
    skills: list[SkillRecord] = []
    if not source_root.is_dir():
        return {"schema": SKILL_INVENTORY_SCHEMA, "root": str(source_root), "skills": [], "checked_at": _now()}
    for skill_dir in sorted(source_root.iterdir(), key=lambda item: item.name):
        if not skill_dir.is_dir() or skill_dir.is_symlink():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file() or skill_md.is_symlink():
            continue
        try:
            frontmatter = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
        except OSError:
            continue
        classification = "runtime-owned" if skill_dir.name.startswith(".system") else "operator"
        name_match = _FRONTMATTER_NAME.search(frontmatter)
        desc_match = _FRONTMATTER_DESC.search(frontmatter)
        record = SkillRecord(
            name=name_match.group(1).strip() if name_match else skill_dir.name,
            source_root=str(source_root),
            path=skill_dir.name,
            classification=classification,
            description=desc_match.group(1).strip() if desc_match else "",
            checksum=_hash_dir(skill_dir),
            referenced_files=_referenced_files(skill_md, skill_dir)[0],
            provenance=str(source_root),
        )
        escapes = _referenced_files(skill_md, skill_dir)[1]
        if escapes:
            record.validation = "error"
            record.validation_detail = "referenced path escapes the skill directory"
        if production_active_names and record.name in production_active_names:
            record.provenance = f"{source_root} (production-active version preserved)"
        skills.append(validate_skill(record, skill_dir))
    # Same-name collision handling: hash both, quarantine the non-production one.
    by_name: dict[str, list[SkillRecord]] = {}
    for record in skills:
        by_name.setdefault(record.name, []).append(record)
    for name, group in by_name.items():
        if len(group) < 2:
            continue
        keep = next(
            (r for r in group if "production-active" in r.provenance),
            group[0],
        )
        for record in group:
            if record is not keep:
                record.validation = "error"
                record.validation_detail = "same-name collision quarantined; folders never merged"
                record.collision_with = keep.path
    return {
        "schema": SKILL_INVENTORY_SCHEMA,
        "root": str(source_root),
        "skills": [record.__dict__ for record in skills],
        "checked_at": _now(),
    }
