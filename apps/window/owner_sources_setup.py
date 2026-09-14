"""Wire the owner read projections into the workspace source routes.

The projection module owns the readers and the source module owns the route
contract. This is the single place that connects them, so neither has to import
the other and a reader can be attached or withheld independently.

An attachment is explicit and narrow: a source that has no reader is reported as
unavailable by name, which is the honest answer before its adapter exists.
"""

from __future__ import annotations

import owner_projections
import owner_sources


def attach_owner_sources() -> tuple[str, ...]:
    """Attach every projection that exists, and return the ids that were attached.

    Returns the attached ids so a caller or a test can assert exactly which
    sources are live rather than assuming all of them are.
    """
    attached: list[str] = []
    for source_id, reader in (
        ("support", owner_projections.support_snapshot),
        ("crm", owner_projections.crm_snapshot),
        ("notifications", owner_projections.notifications_snapshot),
    ):
        owner_sources.register_source(source_id, reader)
        attached.append(source_id)
    return tuple(attached)
