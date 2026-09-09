#!/usr/bin/env python3
"""Shared-skills cutover parity check (Frank release, Phase 4).

Verifies that ONE canonical operator skill library at /srv/skills serves both
consumers (Hermes v0.21 and the VPS Codex user) with no drift, no shadowing
and no writable consumer copies. Stdlib only. Exit non-zero on any failure.

Checks:
  (a) catalog.json parses and covers every skill directory under /srv/skills
  (b) every catalog item's checksum matches its directory content (recomputed)
  (c) Hermes resolves every shared skill to the approved canonical content
      (resolved source path must be inside /srv/skills, content must match)
  (d) Codex resolves every shared skill to the same canonical content
  (e) no runtime-owned skill shadows a shared operator skill (name collision
      check across the runtime trees: Hermes ~/.hermes/skills, Codex .system)
  (f) no writable consumer copy exists (consumers must resolve through
      symlink/direct path into /srv/skills; a copied tree under a consumer
      HOME is a failure) and /srv/skills is not world-writable

Mechanism notes (verified against source, do not guess):
  - Hermes v0.21: tools/skills_tool.py::_find_all_skills scans project dirs,
    then HERMES_HOME/skills, then ``skills.external_dirs`` from config.yaml
    (agent/skill_utils.py::get_external_skills_dirs). First-wins on the
    frontmatter ``name``.
  - Codex CLI: user scope is ~/.agents/skills/**/SKILL.md (the .agents/skills
    standard); legacy ~/.codex/skills is also scanned and is where the
    packaged ``.system`` skills live. [[skills.config]] can disable by path.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SKILLS_ROOT = Path("/srv/skills")
CATALOG_PATH = SKILLS_ROOT / "catalog.json"
HERMES_HOME = Path("/home/hermes/.hermes")
HERMES_RUNTIME_SKILLS = HERMES_HOME / "skills"
HERMES_CONFIG = HERMES_HOME / "config.yaml"
HERMES_VENV_PY = Path("/home/hermes/.hermes/hermes-agent-v021/venv/bin/python")
HERMES_AGENT_SRC = Path("/home/hermes/.hermes/hermes-agent-v021")
CODEX_HOME = Path("/home/codex/.codex")
CODEX_AGENTS_SKILLS = Path("/home/codex/.agents/skills")
CODEX_USER_SKILLS = CODEX_HOME / "skills"
CODEX_SYSTEM_MARKER = ".system"

_NAME_RE = re.compile(r"^name:\s*(.+)$", re.MULTILINE)
_BOUNDS_RE = re.compile(r"^---\s*$", re.MULTILINE)

results: list[tuple[str, str, str]] = []  # (check, status, detail)


def record(check: str, ok: bool, detail: str) -> bool:
    results.append((check, "PASS" if ok else "FAIL", detail))
    return ok


def skill_name(skill_md: Path) -> str | None:
    try:
        text = skill_md.read_text(encoding="utf-8-sig", errors="replace")[:4000]
    except OSError:
        return None
    if len(_BOUNDS_RE.findall(text[:4000])) < 2 or not text.startswith("---"):
        return None
    m = _NAME_RE.search(text)
    return m.group(1).strip() if m else None


def hash_dir(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        if item.is_file() and not item.is_symlink():
            digest.update(str(item.relative_to(path)).encode("utf-8"))
            digest.update(item.read_bytes())
    return digest.hexdigest()[:32]


# ---------------------------------------------------------------- check (a)
def check_catalog_coverage() -> tuple[dict | None, list[Path]]:
    catalog, skill_dirs = None, []
    try:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        record("a) catalog parses & covers all dirs", False, f"catalog unreadable: {exc}")
        return None, skill_dirs
    included = catalog.get("included", [])
    catalog_paths = {i["path"] for i in included}
    seen: list[Path] = []
    for skill_md in sorted(SKILLS_ROOT.rglob("SKILL.md")):
        d = skill_md.parent
        if d == SKILLS_ROOT or d.is_symlink() or skill_md.is_symlink():
            continue
        if any(kept == d or kept in d.parents for kept in seen):
            continue
        seen.append(d)
    uncovered = [
        d.relative_to(SKILLS_ROOT).as_posix()
        for d in seen
        if d.relative_to(SKILLS_ROOT).as_posix() not in catalog_paths
    ]
    stale = sorted(p for p in catalog_paths if not (SKILLS_ROOT / p).is_dir())
    ok = not uncovered and not stale
    detail = (
        f"items={len(included)} dirs={len(seen)} "
        f"uncovered={uncovered[:5] or 'none'} stale={stale[:5] or 'none'}"
    )
    record("a) catalog parses & covers all dirs", ok, detail)
    return catalog, seen


# ---------------------------------------------------------------- check (b)
def check_item_checksums(catalog: dict) -> bool:
    mismatches = []
    for item in catalog.get("included", []):
        d = SKILLS_ROOT / item["path"]
        actual = hash_dir(d) if d.is_dir() else "<missing>"
        if actual != item.get("checksum"):
            mismatches.append(f"{item['path']}: catalog={item.get('checksum')} disk={actual}")
    return record(
        "b) item checksums match disk (recomputed)",
        not mismatches,
        f"{len(catalog.get('included', []))} items verified; mismatches={mismatches[:5] or 'none'}",
    )


# ------------------------------------------------- hermes resolution helpers
def hermes_scan_dirs() -> list[Path] | None:
    """Skill scan order per Hermes' own code, via its venv (preferred)."""
    if HERMES_VENV_PY.is_file():
        try:
            env = dict(os.environ, HERMES_HOME=str(HERMES_HOME))
            out = subprocess.run(
                [str(HERMES_VENV_PY), "-c", (
                    "import sys, json; sys.path.insert(0, %r)\n"
                    "from pathlib import Path\n"
                    "from agent.skill_utils import (get_external_skills_dirs,\n"
                    "    get_project_skills_dirs, get_skills_dir)\n"
                    "dirs = list(get_project_skills_dirs()) + [get_skills_dir()]\n"
                    "dirs += [Path(p) for p in get_external_skills_dirs()]\n"
                    "print(json.dumps([str(d) for d in dirs]))"
                    % str(HERMES_AGENT_SRC)
                )],
                capture_output=True, text=True, timeout=120, env=env,
            )
            if out.returncode == 0:
                return [Path(p) for p in json.loads(out.stdout.strip().splitlines()[-1])]
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
    # Fallback: parse skills.external_dirs from config.yaml with stdlib regex.
    try:
        text = HERMES_CONFIG.read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"^skills:\n((?:[ \t]+.*\n?)+)", text, re.M)
    if not m:
        return None
    block = m.group(1)
    dm = re.search(r"^  external_dirs:\n((?:    -[^\n]*\n?)+)", block, re.M)
    if not dm:
        return [HERMES_RUNTIME_SKILLS]
    entries = re.findall(r"    -\s*(.+)", dm.group(1))
    dirs = [HERMES_RUNTIME_SKILLS]
    for e in entries:
        p = Path(os.path.expandvars(os.path.expanduser(e.strip()))).resolve()
        if p.is_dir() and p != HERMES_RUNTIME_SKILLS.resolve():
            dirs.append(p)
    return dirs


def first_wins(dirs: list[Path]) -> dict[str, Path]:
    """Replicate Hermes'/Codex's first-wins SKILL.md resolution."""
    resolved: dict[str, Path] = {}
    for d in dirs:
        if not d.is_dir():
            continue
        for sm in sorted(d.rglob("SKILL.md")):
            if any(part in {".curator_backups", ".hub", "index-cache", "__pycache__",
                            CODEX_SYSTEM_MARKER} for part in sm.parts):
                continue
            if sm.is_symlink() or sm.parent.is_symlink():
                continue
            name = skill_name(sm) or sm.parent.name
            if name and name not in resolved:
                resolved[name] = sm.parent
    return resolved


# ---------------------------------------------------------------- check (c)
def check_hermes_resolution(catalog: dict) -> bool:
    dirs = hermes_scan_dirs()
    if not dirs:
        return record("c) Hermes resolves shared skills to /srv/skills", False,
                      "could not determine Hermes scan dirs (venv + config fallback failed)")
    resolved = first_wins(dirs)
    missing, outside, drift = [], [], []
    for item in catalog.get("included", []):
        name, want = item["name"], item["checksum"]
        d = resolved.get(name)
        if d is None:
            missing.append(name)
            continue
        real = d.resolve()
        if SKILLS_ROOT.resolve() not in real.parents and real != SKILLS_ROOT.resolve():
            outside.append(f"{name} -> {real}")
            continue
        if hash_dir(real) != want:
            drift.append(name)
    ok = not missing and not outside and not drift
    detail = (
        f"scan_dirs={[str(d) for d in dirs]}; total={len(resolved)}; "
        f"missing={missing or 'none'} outside={outside or 'none'} drift={drift or 'none'}"
    )
    return record("c) Hermes resolves shared skills to /srv/skills", ok, detail)


# ---------------------------------------------------------------- check (d)
def codex_user_skill_dirs() -> list[Path]:
    dirs = []
    if CODEX_AGENTS_SKILLS.is_dir() or CODEX_AGENTS_SKILLS.is_symlink():
        dirs.append(CODEX_AGENTS_SKILLS)
    legacy = CODEX_USER_SKILLS
    if legacy.is_dir():
        dirs.append(legacy)
    return dirs


def check_codex_resolution(catalog: dict) -> bool:
    resolved = first_wins(codex_user_skill_dirs())
    missing, outside, drift = [], [], []
    for item in catalog.get("included", []):
        name, want = item["name"], item["checksum"]
        d = resolved.get(name)
        if d is None:
            missing.append(name)
            continue
        real = d.resolve()
        if SKILLS_ROOT.resolve() not in real.parents:
            outside.append(f"{name} -> {real}")
            continue
        if hash_dir(real) != want:
            drift.append(name)
    ok = not missing and not outside and not drift
    detail = (
        f"roots={[str(d) for d in codex_user_skill_dirs()]}; "
        f"missing={missing or 'none'} outside={outside or 'none'} drift={drift or 'none'}"
    )
    return record("d) Codex resolves shared skills to /srv/skills", ok, detail)


# ---------------------------------------------------------------- check (e)
def check_no_runtime_shadowing(catalog: dict) -> bool:
    shared_names = {i["name"] for i in catalog.get("included", [])}
    collisions = []
    runtime_roots = [HERMES_RUNTIME_SKILLS, CODEX_USER_SKILLS / CODEX_SYSTEM_MARKER]
    for root in runtime_roots:
        if not root.is_dir():
            continue
        for sm in root.rglob("SKILL.md"):
            name = skill_name(sm) or sm.parent.name
            if name in shared_names:
                collisions.append(f"{name} @ {sm.parent}")
    return record(
        "e) no runtime-owned skill shadows a shared skill",
        not collisions,
        f"runtime_roots={[str(r) for r in runtime_roots]}; collisions={collisions or 'none'}",
    )


# ---------------------------------------------------------------- check (f)
def check_no_consumer_copies(catalog: dict) -> bool:
    problems = []
    shared_checksums = {i["checksum"] for i in catalog.get("included", []) if i.get("checksum")}

    # Codex consumer root must be a symlink into /srv/skills (or contain only
    # symlinks into /srv/skills).
    if CODEX_AGENTS_SKILLS.is_symlink():
        target = Path(os.path.realpath(CODEX_AGENTS_SKILLS))
        if SKILLS_ROOT.resolve() not in [target, *target.parents]:
            problems.append(f"{CODEX_AGENTS_SKILLS} -> {target} (not /srv/skills)")
    elif CODEX_AGENTS_SKILLS.is_dir():
        for child in sorted(CODEX_AGENTS_SKILLS.iterdir()):
            if not child.is_symlink():
                problems.append(f"non-symlink entry in {CODEX_AGENTS_SKILLS}: {child}")
            elif not str(os.path.realpath(child)).startswith(str(SKILLS_ROOT.resolve())):
                problems.append(f"link target outside /srv/skills: {child}")
    else:
        problems.append(f"{CODEX_AGENTS_SKILLS} missing (Codex consumer not wired)")

    # Legacy codex skills dir must hold ONLY packaged .system skills.
    if CODEX_USER_SKILLS.is_dir():
        for child in sorted(CODEX_USER_SKILLS.iterdir()):
            if child.name != CODEX_SYSTEM_MARKER:
                problems.append(f"unexpected non-.system entry in {CODEX_USER_SKILLS}: {child}")

    # Hermes runtime tree must not contain a copy of any shared skill
    # (by name or by content checksum).
    if HERMES_RUNTIME_SKILLS.is_dir():
        resolved = first_wins([HERMES_RUNTIME_SKILLS])
        shared_names = {i["name"] for i in catalog.get("included", [])}
        for name, d in resolved.items():
            if name in shared_names:
                problems.append(f"hermes runtime tree still exposes shared skill: {name} @ {d}")
            if hash_dir(d) in shared_checksums:
                problems.append(f"hermes runtime tree contains shared skill content: {d}")

    # /srv/skills must not be world-writable and must be a real directory.
    if SKILLS_ROOT.is_symlink():
        problems.append("/srv/skills is a symlink")
    for p in [SKILLS_ROOT, *SKILLS_ROOT.rglob("*")]:
        if p.stat().st_mode & 0o002:
            problems.append(f"world-writable: {p}")
            break

    return record(
        "f) no writable consumer copy (symlink/direct-path only)",
        not problems,
        f"problems={problems[:5] or 'none'}",
    )


def main() -> int:
    catalog, _ = check_catalog_coverage()
    if catalog is not None:
        check_item_checksums(catalog)
        check_hermes_resolution(catalog)
        check_codex_resolution(catalog)
        check_no_runtime_shadowing(catalog)
    else:
        for label in ["b) item checksums match disk (recomputed)",
                      "c) Hermes resolves shared skills to /srv/skills",
                      "d) Codex resolves shared skills to /srv/skills",
                      "e) no runtime-owned skill shadows a shared skill"]:
            record(label, False, "skipped: catalog unreadable")
    check_no_consumer_copies(catalog or {"included": []})

    width = max(len(r[0]) for r in results)
    print(f"{'check'.ljust(width)}  status  detail")
    print("-" * (width + 2 + 6 + 2 + 40))
    for check, status, detail in results:
        print(f"{check.ljust(width)}  {status.ljust(6)}  {detail[:400]}")
    failed = [r for r in results if r[1] == "FAIL"]
    print("-" * (width + 2 + 6 + 2 + 40))
    print(f"TOTAL: {len(results) - len(failed)}/{len(results)} checks passed"
          + (f"; FAILURES: {len(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
