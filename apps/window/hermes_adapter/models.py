"""Model truth: options come only from Hermes, never a Frank list.

Uses the contracted ``GET /v1/models`` and ``GET /v1/model_options`` sources.
Provider/model capability hints, reasoning options, service tier, and price
metadata are preserved exactly as supplied by Hermes.  A chosen pair that
Hermes does not offer is a hard error — never a default fallback presented as
success.
"""
from __future__ import annotations

from typing import Any

from .http import RestError, RestSurface


class ModelError(RuntimeError):
    def __init__(self, message: str, *, frank_code: str = "hermes.model_unavailable"):
        super().__init__(message)
        self.frank_code = frank_code


class ModelCatalog:
    def __init__(self, surface: RestSurface):
        self._surface = surface

    def models(self) -> list[dict[str, Any]]:
        _, result = self._surface.request("GET", "/v1/models")
        items = result.get("data") if isinstance(result, dict) else None
        if not isinstance(items, list):
            raise ModelError("model list response is invalid", frank_code="hermes.invalid_response")
        return [item for item in items if isinstance(item, dict)]

    def options(self) -> dict[str, Any]:
        _, result = self._surface.request("GET", "/v1/model_options")
        if not isinstance(result, dict):
            raise ModelError("model options response is invalid", frank_code="hermes.invalid_response")
        return result

    def capabilities(self) -> dict[str, Any]:
        _, result = self._surface.request("GET", "/v1/capabilities")
        if not isinstance(result, dict):
            raise ModelError("capabilities response is invalid", frank_code="hermes.invalid_response")
        return result

    def validate_choice(self, model: str, *, provider: str | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        """Validate the chosen pair against Hermes-returned options; return the effective entry."""
        if not isinstance(model, str) or not model.strip():
            raise ModelError("model is required", frank_code="hermes.invalid_params")
        options = options or self.options()
        candidates = options.get("options", options.get("models", []))
        if not isinstance(candidates, list):
            raise ModelError("model options payload is invalid", frank_code="hermes.invalid_response")
        for entry in candidates:
            if not isinstance(entry, dict):
                continue
            entry_model = entry.get("model", entry.get("id"))
            if entry_model != model:
                continue
            entry_provider = entry.get("provider")
            if provider is not None and entry_provider is not None and entry_provider != provider:
                continue
            return entry
        raise ModelError(f"model {model!r} is not offered by Hermes for provider {provider!r}")
