"""Fail-closed helpers for Frank's versioned control-plane declarations.

This module validates repository contracts only.  It does not collect host
state, mutate services, execute actions, or advance a release pointer.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

import rfc8785
import yaml
from jsonschema import Draft202012Validator, FormatChecker


STABLE_ID_PATTERN = (
    r"^(vps|project|repo|runtime|service|component|worker|store|route|"
    r"capability|rule|skill|tool|plugin|cli|mcp|app|template|library|"
    r"hook|gate|policy|runbook|eval|observer|source|release|projection|"
    r"generation|receipt|proposal|finding|mapping|run|edge):"
    r"[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$"
)
STABLE_ID = re.compile(STABLE_ID_PATTERN)
ID_KEY = re.compile(r"^id_[A-Za-z0-9_-]+$")
GRAPH_HASH_KEY = re.compile(r"^g_[0-9a-f]{64}$")
REVISION_KEY = re.compile(r"^rev_[0-9a-f]{40,64}$")
SAFE_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

RELATIONSHIPS = frozenset(
    {
        "contains", "owns", "runs", "exposes", "routes_to", "reads",
        "writes", "depends_on", "uses", "executes", "declares",
        "produces", "consumes", "validates", "deploys", "observes",
        "replaces",
    }
)
FEATURE_FLAGS = frozenset(
    {
        "live_view", "map_view", "control_read",
        "reconciliation_schedules", "runtime_monitoring", "safe_actions",
        "operational_actions", "source_actions", "cleanup_jobs",
        "discovery_jobs", "evaluation_jobs", "chat_pattern_candidates",
        "retention_restore_drills",
    }
)
REQUIRED_OSS_DECISION_IDS = frozenset(
    {
        f"receipt:oss-decision/{name}"
        for name in (
            "action-adapters",
            "agenttrail",
            "archify",
            "catalog-model",
            "cleanup-reporters",
            "custom-adapters",
            "discovery-feeds",
            "evaluation-runner",
            "json-schema-yaml-validation",
            "map-projection-adapter",
            "reconciliation-provider",
            "report-normalizer",
            "runtime-evidence-adapter",
            "runtime-monitoring",
            "safe-action-adapters",
            "source-evidence-adapter",
            "stable-id-adapter",
        )
    }
)


class ControlContractError(ValueError):
    """Raised when a declaration or materialization fails closed."""


class _UniqueKeyLoader(yaml.SafeLoader):
    """SafeLoader variant that rejects ambiguous duplicate YAML keys."""


def _construct_unique_mapping(
    loader: _UniqueKeyLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[str, Any]:
    # Inspect explicit keys before expanding YAML's merge key.  A merge may be
    # intentionally overridden by the receiving mapping; two explicit keys
    # at the same level remain ambiguous and are rejected.
    explicit: set[str] = set()
    for key_node, value_node in node.value:
        if key_node.tag == "tag:yaml.org,2002:merge":
            continue
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise ControlContractError("declaration mapping keys must be strings")
        if key in explicit:
            raise ControlContractError(f"duplicate declaration key: {key}")
        explicit.add(key)
    loader.flatten_mapping(node)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def normalize_stable_id(value: object) -> str:
    """Normalize a human-facing ID to lower-case and validate release 1."""
    if not isinstance(value, str) or not value:
        raise ControlContractError("stable ID must be non-empty text")
    normalized = value.lower()
    if not STABLE_ID.fullmatch(normalized):
        raise ControlContractError(f"invalid stable ID: {value!r}")
    return normalized


def require_canonical_stable_id(value: object) -> str:
    """Require an already-normalized stable ID for persisted contracts."""
    normalized = normalize_stable_id(value)
    if value != normalized:
        raise ControlContractError("persisted stable IDs must already be lower-case")
    return normalized


def id_key(stable_id: object) -> str:
    """Encode a stable ID as the universal canonical filesystem key."""
    value = require_canonical_stable_id(stable_id)
    encoded = base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii")
    return "id_" + encoded.rstrip("=")


def stable_id_from_key(value: object) -> str:
    """Decode a canonical id-key, rejecting aliases and path syntax."""
    if not isinstance(value, str) or not ID_KEY.fullmatch(value):
        raise ControlContractError("invalid id-key syntax")
    if any(token in value for token in ("%", ".", "\\", "=")):
        raise ControlContractError("id-key contains forbidden path syntax")
    encoded = value[3:]
    try:
        raw = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4),
            altchars=b"-_",
            validate=True,
        )
        decoded = raw.decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as error:
        raise ControlContractError("id-key is not canonical UTF-8 base64url") from error
    stable_id = require_canonical_stable_id(decoded)
    if id_key(stable_id) != value:
        raise ControlContractError("id-key decode/re-encode mismatch")
    return stable_id


def resolve_key_path(
    root: Path,
    key: str,
    *suffix: str,
    must_exist: bool = False,
) -> Path:
    """Resolve only declared key/slug segments beneath a configured root."""
    if not (ID_KEY.fullmatch(key) or GRAPH_HASH_KEY.fullmatch(key) or REVISION_KEY.fullmatch(key)):
        raise ControlContractError("path key is not a declared key format")
    for segment in suffix:
        if not isinstance(segment, str) or len(segment) > 64 or not SAFE_SLUG.fullmatch(segment):
            raise ControlContractError("unsafe materialization path segment")
    base = root.resolve()
    target = base.joinpath(key, *suffix).resolve()
    if target == base or base not in target.parents:
        raise ControlContractError("materialization path escapes configured root")
    if must_exist and (not target.is_file() or target.is_symlink()):
        raise ControlContractError("materialization target must be a regular file")
    return target


def canonical_bytes(value: object) -> bytes:
    """Return RFC 8785 bytes for deterministic manifests and hashes."""
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, TypeError, ValueError) as error:
        raise ControlContractError("value is not canonicalizable JSON") from error


def canonical_sha256(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _load_yaml(path: Path) -> Any:
    try:
        return yaml.load(path.read_text(encoding="utf-8"), Loader=_UniqueKeyLoader)
    except (OSError, UnicodeError, yaml.YAMLError) as error:
        raise ControlContractError(f"cannot load declaration {path}") from error


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ControlContractError(f"cannot load JSON contract {path}") from error


def _validate(instance: object, schema: Mapping[str, object], label: str) -> None:
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda item: tuple(str(part) for part in item.path))
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.path) or "<root>"
        raise ControlContractError(f"{label} invalid at {location}: {first.message}")


def _duplicates(values: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return duplicates


class ControlPlaneContracts:
    """Load and cross-check one exact repository declaration set."""

    def __init__(self, control_root: Path):
        self.root = control_root.resolve()
        self.schema_root = self.root / "schema"

    def schema(self, name: str) -> dict[str, Any]:
        value = _load_json(self.schema_root / name)
        if not isinstance(value, dict):
            raise ControlContractError(f"schema {name} must be an object")
        Draft202012Validator.check_schema(value)
        return value

    def load(self, relative: str) -> Any:
        path = (self.root / relative).resolve()
        if self.root not in path.parents:
            raise ControlContractError("declaration path escapes control root")
        return _load_json(path) if path.suffix == ".json" else _load_yaml(path)

    def validate(self) -> dict[str, Any]:
        catalog = self.load("catalog.yaml")
        _validate(catalog, self.schema("catalog.schema.json"), "catalog")

        node_ids = [require_canonical_stable_id(node["id"]) for node in catalog["nodes"]]
        if duplicates := _duplicates(node_ids):
            raise ControlContractError(f"duplicate catalog IDs: {sorted(duplicates)}")
        known_ids = set(node_ids)

        edge_ids: list[str] = []
        for edge in catalog["relationships"]:
            edge_ids.append(require_canonical_stable_id(edge["id"]))
            if edge["from"] not in known_ids or edge["to"] not in known_ids:
                raise ControlContractError(f"relationship has undeclared endpoint: {edge['id']}")
            if edge["type"] not in RELATIONSHIPS:
                raise ControlContractError(f"relationship type is not closed: {edge['type']}")
        if duplicates := _duplicates(edge_ids):
            raise ControlContractError(f"duplicate relationship IDs: {sorted(duplicates)}")

        evidence_status = self.load("build-context.yaml").get("evidence_status", {})
        if evidence_status.get("ad_template_builder_blockwise_runtime_consumption") == "unknown":
            for edge in catalog["relationships"]:
                if edge["type"] == "consumes" and edge["to"] in {"project:blockwise", "service:blockwise-app"}:
                    raise ControlContractError("unproven Ad Builder to Blockwise consumes edge")

        projections_doc = self.load("projections.yaml")
        projections = projections_doc.get("projections", [])
        projection_schema = self.schema("projection.schema.json")
        projection_ids: list[str] = []
        for projection in projections:
            _validate(projection, projection_schema, f"projection {projection.get('id')}")
            projection_id = require_canonical_stable_id(projection["id"])
            projection_ids.append(projection_id)
            known_ids.add(projection_id)
        if duplicates := _duplicates(projection_ids):
            raise ControlContractError(f"duplicate projection IDs: {sorted(duplicates)}")
        if sum(bool(item["mandatory"]) for item in projections) != 6:
            raise ControlContractError("exactly six projections must be mandatory")

        mapping_schema = self.schema("mapping.schema.json")
        aliases_doc = self.load("aliases.yaml")
        mappings = aliases_doc.get("external_mappings", [])
        mapping_ids: list[str] = []
        destinations: list[tuple[str, str]] = []
        for mapping in mappings:
            _validate(mapping, mapping_schema, f"mapping {mapping.get('id')}")
            mapping_ids.append(require_canonical_stable_id(mapping["id"]))
            if mapping["canonical_id"] not in known_ids or mapping["owner_id"] not in known_ids:
                raise ControlContractError(f"mapping {mapping['id']} references an undeclared identity")
            destinations.append((mapping["destination_authority"], mapping["destination_id_or_path"]))
        if duplicates := _duplicates(mapping_ids):
            raise ControlContractError(f"duplicate mapping IDs: {sorted(duplicates)}")
        if duplicates := _duplicates(f"{authority}\0{target}" for authority, target in destinations):
            raise ControlContractError(f"duplicate mapping destinations: {sorted(duplicates)}")

        decisions: dict[str, dict[str, Any]] = {}
        decision_schema = self.schema("oss-decision.schema.json")
        for path in sorted((self.root / "decisions" / "oss").glob("*.yaml")):
            decision = _load_yaml(path)
            _validate(decision, decision_schema, f"OSS decision {path.name}")
            decision_id = require_canonical_stable_id(decision["id"])
            if decision_id in decisions:
                raise ControlContractError(f"duplicate OSS decision ID: {decision_id}")
            selected = decision["selected_candidate"]
            if selected is not None and not any(
                candidate["name"].casefold() in selected.casefold()
                for candidate in decision["candidates"]
            ):
                raise ControlContractError(
                    f"OSS decision {decision_id} selects an undeclared candidate"
                )
            decisions[decision_id] = decision
        if set(decisions) != REQUIRED_OSS_DECISION_IDS:
            missing = sorted(REQUIRED_OSS_DECISION_IDS - decisions.keys())
            unexpected = sorted(decisions.keys() - REQUIRED_OSS_DECISION_IDS)
            raise ControlContractError(
                f"OSS decision register drift (missing={missing}, unexpected={unexpected})"
            )

        for node in catalog["nodes"]:
            decision_id = node.get("oss_decision_id")
            if decision_id is not None and decision_id not in decisions:
                raise ControlContractError(f"catalog node {node['id']} has dangling OSS decision")

        catalog_schema = self.schema("catalog.schema.json")
        capability_validator = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$defs": catalog_schema["$defs"],
            "$ref": "#/$defs/capability",
        }
        capabilities: list[dict[str, Any]] = []
        capability_ids: list[str] = []
        repository_root = self.root.parents[1]
        for path in sorted((self.root / "capabilities").glob("*.yaml")):
            capability = _load_yaml(path)
            _validate(capability, capability_validator, f"capability {path.name}")
            capability_id = require_canonical_stable_id(capability["id"])
            capability_ids.append(capability_id)
            if capability["oss_decision_id"] not in decisions:
                raise ControlContractError(f"capability {capability_id} has dangling OSS decision")
            source = (repository_root / capability["source_locator"]).resolve()
            if repository_root not in source.parents or not source.is_file() or source.is_symlink():
                raise ControlContractError(f"capability {capability_id} source is not a repository file")
            source_bytes = source.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            expected_hash = "sha256:" + hashlib.sha256(source_bytes).hexdigest()
            if capability["content_hash"] != expected_hash:
                raise ControlContractError(f"capability {capability_id} content hash drift")
            capabilities.append(capability)
            known_ids.add(capability_id)
        if duplicates := _duplicates(capability_ids):
            raise ControlContractError(f"duplicate capability IDs: {sorted(duplicates)}")

        actions_doc = self.load("actions.yaml")
        if actions_doc.get("execution") != "disabled":
            raise ControlContractError("Step 1 action execution must remain disabled")
        action_schema = self.schema("action.schema.json")
        actions = actions_doc.get("actions", [])
        action_ids: list[str] = []
        for action in actions:
            _validate(action, action_schema, f"action {action.get('id')}")
            action_id = require_canonical_stable_id(action["id"])
            action_ids.append(action_id)
            if action["enabled"]:
                raise ControlContractError("Step 1 actions must remain disabled")
            if action["oss_decision_id"] not in decisions:
                raise ControlContractError(f"action {action_id} has dangling OSS decision")
            unknown_targets = set(action["target_allowlist"]) - known_ids
            if unknown_targets:
                raise ControlContractError(f"action {action_id} has undeclared targets: {sorted(unknown_targets)}")
        if duplicates := _duplicates(action_ids):
            raise ControlContractError(f"duplicate action IDs: {sorted(duplicates)}")
        action_id_set = set(action_ids)
        for action in actions:
            rollback = action["rollback_action_id"]
            if rollback is not None and rollback not in action_id_set:
                raise ControlContractError(f"action {action['id']} has unknown rollback {rollback}")

        flags = self.load("feature-flags.yaml")
        defaults = flags.get("defaults", {})
        declarations = flags.get("flags", {})
        if set(defaults) != FEATURE_FLAGS or set(declarations) != FEATURE_FLAGS:
            raise ControlContractError("feature flag set differs from release-1 contract")
        if any(value is not False for value in defaults.values()):
            raise ControlContractError("every declared feature flag must default false")
        for name, declaration in declarations.items():
            if declaration.get("default") is not False:
                raise ControlContractError(f"feature flag {name} has hidden enablement")
            for field in ("owner", "enable_condition", "rollback_command", "test"):
                if not isinstance(declaration.get(field), str) or not declaration[field]:
                    raise ControlContractError(f"feature flag {name} lacks {field}")

        payload = {
            "catalog": catalog,
            "aliases": aliases_doc,
            "projections": projections_doc,
            "actions": actions_doc,
            "feature_flags": flags,
            "capabilities": sorted(capabilities, key=lambda item: item["id"]),
            "oss_decisions": [decisions[key] for key in sorted(decisions)],
        }
        payload["contract_hash"] = canonical_sha256(payload)
        return payload

    def verify_register_acceptance(self) -> str:
        context = self.load("build-context.yaml")
        register = context.get("bootstrap_open_source_register", {})
        expected = register.get("repository_copy_sha256")
        if register.get("repository_copy_status") != "accepted_step_1" or not isinstance(expected, str):
            raise ControlContractError("repository OSS register is not accepted")
        register_path = self.root / "decisions" / "open-source-register.md"
        try:
            body = register_path.read_bytes()
        except OSError as error:
            raise ControlContractError("cannot read accepted repository OSS register") from error
        actual = hashlib.sha256(body.replace(b"\r\n", b"\n").replace(b"\r", b"\n")).hexdigest()
        if actual != expected:
            raise ControlContractError("repository OSS register hash drift")
        return actual


def utc_now() -> datetime:
    """Clock seam for later freshness checks; tests inject fixed instants."""
    return datetime.now(timezone.utc)
