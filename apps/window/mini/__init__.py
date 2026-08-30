"""Mini Frank product contracts layered over Frank's one transport.

The modules in this package contain deterministic policy and projection code
only.  They do not own a model, tool loop, memory client, repository, or
database.  ``mini_frank.py`` remains the single Flask transport and Hermes
remains the only reasoning/build runtime.
"""

from .contracts import (
    ACCOUNT_ID_RE,
    BINDING_VERSION,
    account_claim_token,
    binding_receipt,
    derive_legacy_account_id,
    new_account_id,
    reject_client_scope_fields,
    verify_account_claim,
)
from .product import (
    COMMENT_ROLES,
    SERVICE_KINDS,
    SHARE_MODES,
    SHARE_ROLES,
    SHARE_SCOPES,
    add_comment,
    append_audit,
    create_share,
    create_service_request,
    find_share,
    owner_comments,
    owner_sharing,
    published_projection,
    quality_projection,
    revoke_share,
    rotate_share,
    share_projection,
    shared_comments,
    update_sharing,
)
from .knowledge import (
    INDUSTRY_CANDIDATES_SCHEMA,
    KNOWLEDGE_BINDING_SCHEMA,
    industry_candidate_prompt,
    knowledge_binding,
    validate_industry_candidates,
)
from .results import (
    GUIDANCE_SCHEMA,
    SELF_HOST_SCHEMA,
    RESULT_SUPPORT_FIELDS,
    build_result_support,
    result_support_prompt,
    validate_guidance,
    validate_self_host_guide,
)

__all__ = [name for name in globals() if not name.startswith("_")]
