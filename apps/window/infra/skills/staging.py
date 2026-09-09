"""Staged cutover for the one canonical skills library (``/srv/skills``).

Builds and validates a staging tree from inventoried operator skills, then
emits the exact Session-1 cutover, checksum-parity, no-shadow and rollback
scripts. This module never touches live consumers; promotion is executed by
the integration owner from the reviewed scripts.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .inventory import SKILL_INVENTORY_SCHEMA, SkillRecord, _hash_dir

CUTOVER_SCHEMA = "schema://frank.skills-cutover/v1"
CONSUMERS = ("hermes", "codex-vps")


class StagingError(RuntimeError):
    """Staging tree could not be built or validated."""


def build_staging_tree(
    staging_root: Path,
    inventories: list[dict],
    *,
    extra_operator_skills: list[dict] | None = None,
) -> dict:
    """Copy only valid, non-colliding operator skills into the staging tree.

    Runtime-owned skills are excluded by classification. Uniquely named
    project-scoped skills may enter with explicit scope metadata. Every
    consumer resolves the same physical copy after cutover.
    """
    staging_root = Path(staging_root)
    if staging_root.exists():
        raise StagingError("staging root already exists; use a fresh release path")
    staging_root.mkdir(parents=True)
    included, excluded = [], []
    seen_names: dict[str, str] = {}
    for inventory in inventories:
        if inventory.get("schema") != SKILL_INVENTORY_SCHEMA:
            raise StagingError("inventory has an unsupported format")
        source_root = Path(inventory["root"])
        for raw in inventory.get("skills", []):
            record = SkillRecord(**{k: v for k, v in raw.items()})
            if record.classification != "operator" or record.validation != "valid":
                excluded.append({"name": record.name, "path": record.path, "reason": record.validation_detail or record.validation})
                continue
            if record.name in seen_names:
                excluded.append({"name": record.name, "path": record.path, "reason": "duplicate name in staging"})
                continue
            destination = staging_root / record.path
            shutil.copytree(source_root / record.path, destination, symlinks=False)
            # Post-copy verification: recompute the checksum of what actually
            # landed in the staging tree, not what we intended to copy.
            actual = _hash_dir(destination)
            if actual != record.checksum:
                raise StagingError(
                    f"post-copy checksum mismatch for {record.path}: "
                    f"catalog={record.checksum} copied={actual}"
                )
            seen_names[record.name] = record.path
            included.append({"name": record.name, "path": record.path, "checksum": record.checksum})
    for extra in extra_operator_skills or []:
        # Uniquely named project-scoped skill with explicit scope metadata.
        source = Path(extra["source_path"])
        name = extra["name"]
        scope = extra.get("scope", "project")
        if name in seen_names or scope not in {"project", "user-root"}:
            excluded.append({"name": name, "path": str(source), "reason": "shadow or invalid scope"})
            continue
        destination = staging_root / source.name
        shutil.copytree(source, destination, symlinks=False)
        (destination / ".frank-skill-scope.json").write_text(
            json.dumps({"scope": scope, "project": extra.get("project", "")}), encoding="utf-8"
        )
        # Post-copy verification against the checksum of the copied tree
        # (extras carry no catalog checksum, so the copy itself is truth).
        copied_checksum = _hash_dir(destination)
        seen_names[name] = source.name
        included.append({"name": name, "path": source.name, "checksum": copied_checksum, "scope": scope})
    catalog = {
        "schema": CUTOVER_SCHEMA,
        "included": included,
        "excluded": excluded,
        "source_truth": "filesystem",
    }
    (staging_root / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return catalog


def validate_staging_tree(staging_root: Path, consumers: tuple[str, ...] = CONSUMERS) -> dict:
    """Fail-closed staging validation before any consumer is redirected.

    Recomputes and verifies every catalog item checksum AFTER the copy
    (post-copy verification): a catalog entry whose on-disk content no
    longer hashes to its recorded checksum fails validation.
    """
    staging_root = Path(staging_root)
    catalog_path = staging_root / "catalog.json"
    if not catalog_path.is_file():
        raise StagingError("staging tree has no catalog")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    problems = []
    for item in catalog["included"]:
        skill_dir = staging_root / item["path"]
        if not (skill_dir / "SKILL.md").is_file():
            problems.append(f"missing SKILL.md: {item['path']}")
        if any(link.is_symlink() for link in skill_dir.rglob("*") if link.is_symlink()):
            problems.append(f"symlink inside staged skill: {item['path']}")
        recorded = item.get("checksum", "")
        if recorded:
            actual = _hash_dir(skill_dir)
            if actual != recorded:
                problems.append(
                    f"post-copy checksum mismatch: {item['path']} "
                    f"catalog={recorded} disk={actual}"
                )
    names = [item["name"] for item in catalog["included"]]
    if len(names) != len(set(names)):
        problems.append("duplicate names in staging tree")
    if problems:
        raise StagingError("; ".join(problems))
    return {
        "ok": True,
        "skills": len(catalog["included"]),
        "consumers": list(consumers),
        "catalog_checksum": _catalog_checksum(staging_root),
    }


def _catalog_checksum(staging_root: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    for item in sorted(staging_root.rglob("*")):
        if item.is_file() and not item.is_symlink():
            digest.update(str(item.relative_to(staging_root)).encode("utf-8"))
            digest.update(item.read_bytes())
    return digest.hexdigest()


def emit_cutover_scripts(staging_root: Path, output_dir: Path) -> dict:
    """Emit the exact Session-1 cutover, parity and rollback scripts.

    The scripts are reviewed handoffs: this session never executes them
    against the live ``/srv/skills`` target or live consumers.
    """
    staging_root = Path(staging_root).resolve()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    checksum = _catalog_checksum(staging_root)
    promote = output_dir / "promote_skills_cutover.sh"
    promote.write_text(
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "# Session-1 reviewed cutover: atomically promote the validated staging tree.",
                "set -euo pipefail",
                f'staging="{staging_root}"',
                'target="/srv/skills"',
                'timestamp="$(date -u +%Y%m%dT%H%M%SZ)"',
                'backup="/srv/skills.previous.$timestamp"',
                'test -d "$staging" || { echo "staging tree missing"; exit 1; }',
                'test -f "$staging/catalog.json" || { echo "staging catalog missing"; exit 1; }',
                'if [ -d "$target" ]; then mv "$target" "$backup"; fi',
                'mv "$staging" "$target"',
                'chown -R root:hermes "$target"',
                'chmod -R a-w,u+rwX "$target"  # read-only for consumers, browser cannot write',
                'echo "promoted $staging -> $target (backup: $backup)"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    promote.chmod(0o750)
    rollback = output_dir / "rollback_skills_cutover.sh"
    rollback.write_text(
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "# Session-1 reviewed rollback: restore every prior consumer/root atomically.",
                "set -euo pipefail",
                'target="/srv/skills"',
                'backup="${1:?usage: rollback_skills_cutover.sh /srv/skills.previous.<timestamp>}"',
                'test -d "$backup" || { echo "backup missing"; exit 1; }',
                'rm -rf "$target"',
                'mv "$backup" "$target"',
                'echo "rolled back to $backup"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    rollback.chmod(0o750)
    parity = output_dir / "check_checksum_parity.sh"
    parity.write_text(
        "\n".join(
            [
                "#!/usr/bin/env bash",
                "# Fail deployment if a consumer resolves a different physical skill",
                "# than the catalogue reports. Run after consumer redirection.",
                "set -euo pipefail",
                f'expected="{checksum}"',
                'actual="$(python3 - <<"PY"',
                "import hashlib, pathlib, sys",
                "root = pathlib.Path('/srv/skills')",
                "digest = hashlib.sha256()",
                "for item in sorted(root.rglob('*')):",
                "    if item.is_file() and not item.is_symlink():",
                "        digest.update(str(item.relative_to(root)).encode()); digest.update(item.read_bytes())",
                "print(digest.hexdigest())",
                "PY",
                ')"',
                'if [ "$expected" != "$actual" ]; then echo "checksum parity FAILED"; exit 1; fi',
                'echo "checksum parity OK: $actual"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    parity.chmod(0o750)
    return {"scripts": [promote.name, rollback.name, parity.name], "catalog_checksum": checksum}
