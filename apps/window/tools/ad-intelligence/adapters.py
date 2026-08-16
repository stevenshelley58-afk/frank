"""Provider-neutral boundaries for the Ad Radar package."""

from typing import Protocol, Any

class BrowserAdapter(Protocol):
    """Implement with Playwright or CDP; return provider-neutral observations."""
    def discover(self, source: dict[str, Any]) -> list[dict[str, Any]]: ...
    def capture(self, resolved: dict[str, Any]) -> dict[str, Any]: ...

class TelemetryAdapter(Protocol):
    """Use OTel GenAI-style spans/events as trace interchange."""
    def span(self, name: str, attributes: dict[str, Any]) -> Any: ...

class HermesAdapter(Protocol):
    """Hermes owns scheduling, model choice, approvals, and execution."""
    def dispatch(self, command: dict[str, Any]) -> dict[str, Any]: ...
