"""Provider contracts that keep Frank's broker separate from Hermes execution.

The registry contains capability and consumer metadata only. Provider adapters
never receive or return a secret value; the vault broker owns the write-only
secret boundary and Hermes owns provider execution.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderAdapter:
    provider: str
    title: str
    consumer: str
    capabilities: tuple[str, ...]
    secret_keys: tuple[str, ...]
    transport: str
    setup_mode: str
    setup_note: str

    def public_contract(self, vault_status: str) -> dict:
        if self.setup_mode == "available":
            status = {
                "verified": "ready",
                "setup_needed": "setup_needed",
                "unavailable": "setup_needed",
                "permission_denied": "error",
                "error": "error",
            }.get(vault_status, "error")
        else:
            status = "setup_needed"
        return {
            "provider": self.provider,
            "title": self.title,
            "status": status,
            "consumer": self.consumer,
            "capabilities": list(self.capabilities),
            "secret_keys": list(self.secret_keys),
            "transport": self.transport,
            "setup_mode": self.setup_mode,
            "setup_note": self.setup_note,
        }


RESEND = ProviderAdapter(
    provider="resend",
    title="Resend",
    consumer="hermes-resend-mcp",
    capabilities=("email.send", "email.status"),
    secret_keys=("RESEND_API_KEY",),
    transport="hermes-mcp",
    setup_mode="available",
    setup_note="The broker binds the opaque vault reference to Hermes Resend MCP; Hermes performs the provider action.",
)

MAUTIC_SMTP = ProviderAdapter(
    provider="mautic-smtp",
    title="Mautic SMTP",
    consumer="hermes-mautic-smtp",
    capabilities=("email.send",),
    secret_keys=("SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD"),
    transport="smtp",
    setup_mode="setup_needed",
    setup_note="SMTP adapter is not available yet; no SMTP credential is accepted by this broker.",
)

ACTIVEPIECES = ProviderAdapter(
    provider="activepieces",
    title="Activepieces",
    consumer="hermes-activepieces-mcp",
    capabilities=("workflow.run", "workflow.status"),
    secret_keys=(),
    transport="activepieces-mcp",
    setup_mode="setup_needed",
    setup_note="Configure credentials in Activepieces CE. Frank does not use enterprise-only sync or copy its credentials.",
)


ADAPTERS = {item.provider: item for item in (RESEND, MAUTIC_SMTP, ACTIVEPIECES)}


def get_adapter(provider: str) -> ProviderAdapter:
    try:
        return ADAPTERS[provider.strip().lower()]
    except (KeyError, AttributeError):
        raise ValueError("provider adapter is not available") from None


def public_catalog(vault_status: str) -> list[dict]:
    return [ADAPTERS[key].public_contract(vault_status) for key in ADAPTERS]
