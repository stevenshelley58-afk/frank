#!/usr/bin/env python3
"""Idempotently provision the Frank owner identity.

Runs inside the authentik server container, so it only ever talks to
127.0.0.1:9000 on the internal network. It creates exactly one human identity
and no self-service path: the owner account is pre-created, the OIDC client
denies automatic signup, and the SAML provider has no default role, which is
what makes Mautic refuse to create an unknown user.

Every step is get-or-create. Re-running the script against a provisioned
instance changes nothing and prints `= unchanged` for each object.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("OWNER_IDENTITY_API", "http://127.0.0.1:9000/api/v3")
TOKEN = os.environ["OWNER_IDENTITY_BOOTSTRAP_TOKEN"]
IDP_HOST = os.environ.get("OWNER_IDENTITY_HOST", "auth.frank.fail")
FRANK_ORIGIN = os.environ.get("OWNER_FRANK_ORIGIN", "https://frank.fail")
CRM_ORIGIN = os.environ.get("OWNER_CRM_ORIGIN", "https://crm.frank.fail")
MARKETING_ORIGIN = os.environ.get("OWNER_MARKETING_ORIGIN", "https://marketing.frank.fail")
WEBMAIL_ORIGIN = os.environ.get("OWNER_WEBMAIL_ORIGIN", "https://mail.frank.fail")

OWNER_USERNAME = "owner"
OWNER_EMAIL = os.environ.get("OWNER_IDENTITY_OWNER_EMAIL", "owner@blockwise.sale")
OWNER_NAME = os.environ.get("OWNER_IDENTITY_OWNER_NAME", "Steven")
OWNER_GROUP = "owner-workspace"
OWNER_ROLE = "owner-workspace-owner"

# Authenticated session lifetime. Owned by the User Login stage, not by an
# environment variable. 12 hours matches an owner working day; a fresh
# authentication is required the next morning.
SESSION_DURATION = os.environ.get("OWNER_IDENTITY_SESSION_DURATION", "hours=12")

DRY_RUN = os.environ.get("OWNER_IDENTITY_DRY_RUN") == "1"

created: list[str] = []
unchanged: list[str] = []
updated: list[str] = []


def call(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf8", "replace")
        raise SystemExit(f"{method} {path} -> HTTP {exc.code}: {detail[:600]}") from exc


def get(path: str):
    return call("GET", path)


def _with_full_list(path: str) -> str:
    """Ask for the unfiltered application list.

    authentik hides applications from the list endpoint when the requesting
    user cannot pass the application's own access policies. That is exactly the
    behaviour the owner-only binding creates, and it means akadmin cannot see
    the applications this script manages unless the superuser view is asked
    for explicitly. Without this, every re-run tries to recreate them.
    """
    if path.startswith("/core/applications/") and "superuser_full_list" not in path:
        sep = "&" if "?" in path else "?"
        return f"{path}{sep}superuser_full_list=true"
    return path


def find(path: str, field: str, value):
    """Return the first result whose `field` equals `value`, else None.

    Not every authentik list endpoint implements a filter for every field, and
    a filter that is silently ignored returns the full unfiltered page. So the
    filtered query is a fast path only: a miss falls back to paging through
    every result and comparing locally. Without that fallback this script would
    try to create a duplicate object and fail on the second run.
    """
    sep = "&" if "?" in path else "?"
    try:
        data = get(_with_full_list(f"{path}{sep}{field}={urllib.parse.quote(str(value))}&page_size=200"))
    except SystemExit:
        data = {}
    for row in data.get("results", []):
        if row.get(field) == value:
            return row

    page = 1
    while page <= 20:
        sep = "&" if "?" in path else "?"
        chunk = get(_with_full_list(f"{path}{sep}page={page}&page_size=200"))
        rows = chunk.get("results", [])
        for row in rows:
            if row.get(field) == value:
                return row
        if not chunk.get("pagination", {}).get("next"):
            break
        page += 1
    return None


def _differs(existing: dict, wanted: dict) -> bool:
    """Compare only the fields this script manages.

    authentik does not preserve the order of a many-to-many list on read, so a
    plain != comparison would report a change on every run and issue an
    unnecessary write. pk lists are therefore compared as sets.
    """
    for key, value in wanted.items():
        current = existing.get(key)
        if isinstance(value, list) and isinstance(current, list):
            # Many-to-many fields come back as bare pks (ints for some models,
            # uuid strings for others) in an order authentik does not promise.
            if sorted(map(str, current)) != sorted(map(str, value)):
                return True
            continue
        if current != value:
            return True
    return False


def ensure(path: str, match_field: str, match_value, body: dict, label: str):
    """Get-or-create keyed on `match_field`. Never recreate, never duplicate."""
    existing = find(path, match_field, match_value)
    if existing:
        # Update only the fields we own, so a later re-run converges after a
        # manual change instead of silently drifting.
        patch = {k: v for k, v in body.items() if k in PATCHABLE.get(path, set())}
        if _differs(existing, patch):
            result = call("PATCH", f"{path}{existing['pk']}/", patch)
            updated.append(f"{label} ({match_value})")
            return result
        unchanged.append(f"{label} ({match_value})")
        return existing
    if DRY_RUN:
        created.append(f"{label} ({match_value}) [dry-run]")
        return {"pk": -1}
    result = call("POST", path, body)
    created.append(f"{label} ({match_value})")
    return result


PATCHABLE = {
    "/providers/proxy/": {"external_host", "authorization_flow", "invalidation_flow", "cookie_domain", "mode"},
    # grant_types must be patchable: authentik's API does not apply a default
    # when the field is omitted, so a provider created without it ends up with
    # an EMPTY grant set. The authorize endpoint then answers every
    # response_type=code request with `invalid_request` ("otherwise malformed")
    # from check_grant, because authorization_code is not in the provider's
    # allowed grant types. That is a silent, confusing failure: the client is
    # configured correctly and the error names no missing field.
    "/providers/oauth2/": {"redirect_uris", "client_type", "grant_types", "authorization_flow",
                           "invalidation_flow", "property_mappings", "sub_mode",
                           "include_claims_in_id_token", "access_code_validity",
                           "access_token_validity", "refresh_token_validity"},
    # sign_assertion and sign_response travel together: authentik rejects a
    # patch that leaves both false while a signing keypair is selected, so a
    # patch that changes one must be able to state both.
    "/providers/saml/": {"acs_url", "audience", "property_mappings", "signing_kp", "sign_assertion",
                         "sign_response", "authorization_flow", "invalidation_flow", "sp_binding"},
    "/core/applications/": {"provider", "meta_description", "meta_publisher", "policy_engine_mode"},
    "/stages/user_login/": {"session_duration", "terminate_other_sessions"},
    # code_length is not persisted on this model in 2026.8 (it reads back null
    # and is derived from the TOTP stage's digits), so it is not managed here.
    "/stages/authenticator/validate/": {"not_configured_action", "configuration_stages",
                                        "last_auth_threshold", "device_classes"},
    "/policies/expression/": {"expression", "name"},
}


def ensure_by_pk(path: str, body: dict, label: str):
    """Create-or-update an object whose identity is its whole configuration."""
    existing = find(path, "name", body["name"])
    if existing:
        patch = {k: v for k, v in body.items() if k in PATCHABLE.get(path, set())}
        if _differs(existing, patch):
            result = call("PATCH", f"{path}{existing['pk']}/", patch)
            updated.append(label)
            return result
        unchanged.append(label)
        return existing
    if DRY_RUN:
        created.append(label + " [dry-run]")
        return {"pk": -1}
    result = call("POST", path, body)
    created.append(label)
    return result


def main() -> int:
    print(f"owner identity bootstrap against {BASE}")

    # ---------------------------------------------------------------- flows --
    flows = get("/flows/instances/?page_size=200")["results"]
    by_slug = {f["slug"]: f for f in flows}
    auth_flow = by_slug.get("default-authentication-flow")
    authz_flow = by_slug.get("default-provider-authorization-implicit-consent")
    inval_flow = by_slug.get("default-invalidation-flow")
    for name, flow in (("authentication", auth_flow), ("authorization", authz_flow), ("invalidation", inval_flow)):
        if not flow:
            raise SystemExit(f"required flow '{name}' is missing; this is not a stock authentik instance")
    print(f"flows: authentication={auth_flow['pk']} authorization={authz_flow['pk']} invalidation={inval_flow['pk']}")

    # ------------------------------------------------------- session lifetime
    logins = get("/stages/user_login/?page_size=200")["results"]
    if not logins:
        raise SystemExit("no User Login stage found; cannot set the authenticated session lifetime")
    for stage in logins:
        ensure_by_pk("/stages/user_login/", {
            "name": stage["name"],
            "session_duration": SESSION_DURATION,
            "terminate_other_sessions": False,
        }, f"user login stage session_duration={SESSION_DURATION}")

    # ------------------------------------------------------------------- MFA --
    # authentik ships its default Authenticator Validation stage with
    # not_configured_action = "skip", which means an owner with no second factor
    # simply is not asked for one. That is the single most important default to
    # change before the old Basic Auth route is retired, so it is set here
    # rather than left to a manual click.
    validations = get("/stages/authenticator/validate/?page_size=50")["results"]
    if not validations:
        raise SystemExit("no Authenticator Validation stage exists; MFA cannot be enforced")
    # Enrolment offers an app-based factor plus printable recovery codes. Those
    # are the two the owner can actually recover with; WebAuthn is deliberately
    # not offered here because a lost security key with no enrolled fallback is
    # a lockout, and recovery is a separate documented path.
    setup_wanted = {
        "default-authenticator-totp-setup": "/stages/authenticator/totp/",
        "default-authenticator-static-setup": "/stages/authenticator/static/",
    }
    configuration_stages = []
    for name, path in setup_wanted.items():
        found = find(path, "name", name)
        if not found:
            raise SystemExit(f"expected enrolment stage is missing: {name}")
        configuration_stages.append(found["pk"])
    for stage in validations:
        ensure_by_pk("/stages/authenticator/validate/", {
            "name": stage["name"],
            "not_configured_action": "configure",
            "configuration_stages": configuration_stages,
            # 0 disables the "trust this device for a while" shortcut, so the
            # second factor is presented on every new sign-in.
            "last_auth_threshold": "seconds=0",
            "device_classes": ["static", "totp"],
        }, "MFA validation stage: enrolment required, no bypass window")

    # ------------------------------------------------------------------ RBAC --
    role = ensure("/rbac/roles/", "name", OWNER_ROLE, {"name": OWNER_ROLE}, "role")
    group = ensure("/core/groups/", "name", OWNER_GROUP, {
        "name": OWNER_GROUP,
        "is_superuser": False,
        "roles": [role["pk"]],
    }, "group")

    # ---------------------------------------------------------- owner identity
    owner = find("/core/users/", "username", OWNER_USERNAME)
    if owner:
        unchanged.append(f"user ({OWNER_USERNAME})")
        if owner["email"] != OWNER_EMAIL:
            owner = call("PATCH", f"/core/users/{owner['pk']}/", {"email": OWNER_EMAIL})
            updated.append(f"user email -> {OWNER_EMAIL}")
    else:
        if DRY_RUN:
            owner = {"pk": -1, "uuid": "dry-run"}
            created.append(f"user ({OWNER_USERNAME}) [dry-run]")
        else:
            owner = call("POST", "/core/users/", {
                "username": OWNER_USERNAME,
                "name": OWNER_NAME,
                "email": OWNER_EMAIL,
                "is_active": True,
                "type": "internal",
                "path": "users",
                "groups": [group["pk"]],
                "attributes": {},
            })
            created.append(f"user ({OWNER_USERNAME})")
            password = os.environ.get("OWNER_IDENTITY_OWNER_PASSWORD")
            if not password:
                raise SystemExit("OWNER_IDENTITY_OWNER_PASSWORD must be set to create the owner identity")
            call("POST", f"/core/users/{owner['pk']}/set_password/", {"password": password})

    if not DRY_RUN:
        member = get(f"/core/groups/{group['pk']}/")
        # The Group serializer returns `users` as bare primary keys, while the
        # Outpost serializer returns provider objects. Normalise both.
        member_pks = [u if isinstance(u, int) else u["pk"] for u in member.get("users", [])]
        if owner["pk"] not in member_pks:
            call("POST", f"/core/groups/{group['pk']}/add_user/", {"pk": owner["pk"]})
            updated.append(f"{OWNER_USERNAME} added to {OWNER_GROUP}")

    # ------------------------------------------------------- least privilege --
    # An application-level policy, so the owner workspace is reachable only by
    # the owner group. akadmin keeps full administrative access to authentik
    # itself but is not silently entitled to the applications.
    access_policy = ensure_by_pk("/policies/expression/", {
        "name": "owner-workspace-members-only",
        "expression": f'return ak_is_group_member(request.user, name="{OWNER_GROUP}")',
    }, "expression policy: owner workspace members only")

    # -------------------------------------------------- embedded outpost host --
    outposts = get("/outposts/instances/?page_size=200")["results"]
    embedded = next((o for o in outposts if o["name"] == "authentik Embedded Outpost"), None)
    if not embedded:
        raise SystemExit("the embedded outpost is missing; authentik was started with it disabled")
    # The embedded outpost needs its own public URL stated explicitly. Left
    # empty it builds the authorize redirect from its listen address, which
    # produces http://localhost/application/o/authorize/... and a browser
    # outside the container cannot follow it. The value lives inside the
    # outpost's JSON `config` object, and authentik validates that object as a
    # whole, so the entire config is sent back with only these two keys changed.
    idp_base = f"https://{IDP_HOST}"
    outpost_config = dict(embedded.get("config") or {})
    if (outpost_config.get("authentik_host") != idp_base
            or outpost_config.get("authentik_host_browser") != idp_base):
        outpost_config["authentik_host"] = idp_base
        outpost_config["authentik_host_browser"] = idp_base
        embedded = call("PATCH", f"/outposts/instances/{embedded['pk']}/", {"config": outpost_config})
        updated.append(f"embedded outpost public URL -> {idp_base}")
    else:
        unchanged.append(f"embedded outpost public URL ({idp_base})")

    # ------------------------------------------- OIDC scopes for the clients --
    scopes = get("/propertymappings/provider/scope/?page_size=200")["results"]
    wanted_scopes = {"openid", "profile", "email"}
    scope_pks = [s["pk"] for s in scopes if s.get("scope_name") in wanted_scopes]
    missing = wanted_scopes - {s.get("scope_name") for s in scopes}
    if missing:
        raise SystemExit(f"default OIDC scope mappings are missing: {sorted(missing)}")

    # ---------------------------------------------------- Frappe OIDC client --
    # Frappe's Social Login Key uses the generic `Custom` provider, whose
    # callback is /api/method/frappe.integrations.oauth2_logins.custom/<name>.
    frappe_body = {
        "name": "Frappe CRM",
        "authorization_flow": authz_flow["pk"],
        "invalidation_flow": inval_flow["pk"],
        "client_type": "confidential",
        # Stated explicitly rather than left to a default. An empty grant set is
        # accepted at creation and then rejects every authorization request, so
        # this is the difference between a working login and a misleading
        # `invalid_request`.
        "grant_types": ["authorization_code", "refresh_token"],
        # Since 2026.8 each entry is an object, not a bare string. `strict`
        # means the URI must equal the value Frappe builds from its own
        # host_name character for character; regex matching is deliberately
        # not used, so a wildcard can never widen the callback.
        "redirect_uris": [{
            "matching_mode": "strict",
            "url": f"{CRM_ORIGIN}/api/method/frappe.integrations.oauth2_logins.custom/authentik",
            "redirect_uri_type": "authorization",
        }],
        "property_mappings": scope_pks,
        "sub_mode": "hashed_user_id",
        "include_claims_in_id_token": True,
        "access_code_validity": "minutes=1",
        "access_token_validity": "minutes=10",
        "refresh_token_validity": "days=1",
    }
    # authentik generates client_id and client_secret; passing null is a 400.
    if os.environ.get("OWNER_IDENTITY_FRAPPE_CLIENT_ID"):
        frappe_body["client_id"] = os.environ["OWNER_IDENTITY_FRAPPE_CLIENT_ID"]
    if os.environ.get("OWNER_IDENTITY_FRAPPE_CLIENT_SECRET"):
        frappe_body["client_secret"] = os.environ["OWNER_IDENTITY_FRAPPE_CLIENT_SECRET"]
    frappe = ensure("/providers/oauth2/", "name", "Frappe CRM", frappe_body, "OIDC client: Frappe CRM")
    if not DRY_RUN:
        # authentik generates the secret; read it back so provision-native can
        # write it into Frappe without a human copying it.
        frappe = get(f"/providers/oauth2/{frappe['pk']}/")

    ensure("/core/applications/", "slug", "frappe-crm", {
        "name": "Frappe CRM",
        "slug": "frappe-crm",
        "provider": frappe["pk"],
        "meta_description": "Owner CRM and Helpdesk (Frappe)",
        "meta_publisher": "Frank",
        "policy_engine_mode": "any",
    }, "application: Frappe CRM")

    # -------------------------------------------------------- Frank (proxy) --
    # The Frank Window itself is gated by forward auth, not by an OIDC client,
    # because Caddy asks the outpost on every request and the outpost session
    # lives in authentik's database.
    proxy = ensure("/providers/proxy/", "name", "Frank Window", {
        "name": "Frank Window",
        "authorization_flow": authz_flow["pk"],
        "invalidation_flow": inval_flow["pk"],
        "external_host": FRANK_ORIGIN,
        "mode": "forward_single",
        "cookie_domain": "",
        "access_token_validity": "hours=12",
    }, "proxy provider: Frank Window")
    ensure("/core/applications/", "slug", "frank-window", {
        "name": "Frank",
        "slug": "frank-window",
        "provider": proxy["pk"],
        "meta_description": "Frank owner workspace",
        "meta_publisher": "Frank",
        "policy_engine_mode": "any",
    }, "application: Frank")

    # ---------------------------------------------- native app proxy clients --
    # Every gated host needs its own application and proxy provider. Without
    # one the embedded outpost has no client for that host and answers 404 with
    # its own HTML instead of redirecting to the authorize endpoint, which looks
    # like a broken Caddy block but is a missing authentik object.
    for label, slug, origin in (
        ("Frappe CRM (forward auth)", "frappe-crm-gate", CRM_ORIGIN),
        ("Mautic (forward auth)", "mautic-gate", MARKETING_ORIGIN),
        ("Webmail (forward auth)", "webmail-gate", WEBMAIL_ORIGIN),
    ):
        provider = ensure("/providers/proxy/", "name", label, {
            "name": label,
            "authorization_flow": authz_flow["pk"],
            "invalidation_flow": inval_flow["pk"],
            "external_host": origin,
            "mode": "forward_single",
            "cookie_domain": "",
            "access_token_validity": "hours=12",
        }, f"proxy provider: {label}")
        ensure("/core/applications/", "slug", slug, {
            "name": slug,
            "slug": slug,
            "provider": provider["pk"],
            "meta_description": f"Owner session gate for {origin}",
            "meta_publisher": "Frank",
            "policy_engine_mode": "any",
        }, f"application: {slug}")

    # ----------------------------------------------------------- SAML signing
    keypairs = get("/crypto/certificatekeypairs/?page_size=200")["results"]
    signing = next((k for k in keypairs if k["name"].startswith("authentik Self-signed")), None) or \
        (keypairs[0] if keypairs else None)
    if not signing:
        raise SystemExit("no certificate keypair exists; authentik bootstrap did not complete")
    print(f"using signing keypair: {signing['name']}")

    # ------------------------------------------- SAML attribute property maps --
    # Mautic's UserMapper reads four attribute names and its user creator
    # refuses to create a user unless all four are present. authentik ships
    # email and username mappings but has NO givenname/surname default, so
    # those two are created here.
    givenname = ensure_by_pk("/propertymappings/provider/saml/", {
        "name": "Frank SAML: givenname",
        "saml_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
        "expression": 'return request.user.name.split(" ", 1)[0] if request.user.name else ""',
    }, "SAML property mapping: givenname")
    surname = ensure_by_pk("/propertymappings/provider/saml/", {
        "name": "Frank SAML: surname",
        "saml_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
        "expression": 'return request.user.name.rsplit(" ", 1)[-1] if request.user.name and " " in request.user.name else (request.user.name or "")',
    }, "SAML property mapping: surname")

    saml_maps = get("/propertymappings/provider/saml/?page_size=200")["results"]
    defaults = {m["name"]: m["pk"] for m in saml_maps}
    needed = [
        "authentik default SAML Mapping: Email",
        "authentik default SAML Mapping: Username",
        "authentik default SAML Mapping: Name",
        "authentik default SAML Mapping: User ID",
    ]
    for name in needed:
        if name not in defaults:
            raise SystemExit(f"expected default SAML mapping is missing: {name}")
    saml_property_mappings = [defaults[n] for n in needed] + [givenname["pk"], surname["pk"]]

    # --------------------------------------------------------- Mautic SAML SP --
    # Mautic derives its SP entityID and ACS URL from its own site_url, which
    # stays https://mail.blockwise.sale so that opt-out links already in sent
    # mail keep working. The values below mirror Mautic's own SP metadata.
    mautic_entity = os.environ.get("OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID", "https://mail.blockwise.sale")
    mautic_acs = os.environ.get(
        "OWNER_IDENTITY_MAUTIC_ACS_URL", "https://mail.blockwise.sale/s/saml/login_check"
    )
    saml = ensure("/providers/saml/", "name", "Mautic", {
        "name": "Mautic",
        "authorization_flow": authz_flow["pk"],
        "invalidation_flow": inval_flow["pk"],
        "acs_url": mautic_acs,
        "audience": mautic_entity,
        "sp_binding": "redirect",
        "signing_kp": signing["pk"],
        "sign_assertion": True,
        "sign_response": False,
        "property_mappings": saml_property_mappings,
    }, "SAML provider: Mautic")
    ensure("/core/applications/", "slug", "mautic", {
        "name": "Mautic",
        "slug": "mautic",
        "provider": saml["pk"],
        "meta_description": "Owner marketing automation (Mautic)",
        "meta_publisher": "Frank",
        "policy_engine_mode": "any",
    }, "application: Mautic")

    # ------------------------------------------- bind apps to the owner group --
    apps = get(_with_full_list("/core/applications/?page_size=200"))["results"]
    app_by_slug = {a["slug"]: a for a in apps}
    # Bind both the native SSO clients and the proxy gates. The proxy gates are
    # the public Caddy forward-auth applications, so leaving either one out
    # would let any otherwise-authenticated identity reach the native edge.
    for slug in (
        "frank-window",
        "frappe-crm",
        "mautic",
        "frappe-crm-gate",
        "mautic-gate",
        "webmail-gate",
    ):
        if slug not in app_by_slug:
            raise SystemExit(f"application {slug} was not created")
        app = app_by_slug[slug]
        bindings = get(f"/policies/bindings/?target={app['pk']}&page_size=50")["results"]
        already = any(b["policy"] == access_policy["pk"] for b in bindings if b.get("policy"))
        if not already and not DRY_RUN:
            call("POST", "/policies/bindings/", {
                "target": app["pk"],
                "policy": access_policy["pk"],
                "order": 0,
                "enabled": True,
                "negate": False,
                "timeout": 30,
                "failure_result": False,
            })
            created.append(f"policy binding: {slug} -> owner group only")
        elif already:
            unchanged.append(f"policy binding: {slug}")

    # ------------------------------------ attach the proxy providers to outpost
    provider_pks = [proxy["pk"]]
    for label in ("Frappe CRM (forward auth)", "Mautic (forward auth)", "Webmail (forward auth)"):
        found = find("/providers/proxy/", "name", label)
        if found:
            provider_pks.append(found["pk"])
    outpost = get(f"/outposts/instances/{embedded['pk']}/")
    current = sorted(p if isinstance(p, int) else p["pk"] for p in outpost.get("providers", []))
    if current != sorted(provider_pks) and not DRY_RUN:
        call("PATCH", f"/outposts/instances/{embedded['pk']}/", {"providers": provider_pks})
        updated.append("embedded outpost providers -> " + ", ".join(str(p) for p in provider_pks))
    elif current == sorted(provider_pks):
        unchanged.append("embedded outpost providers")

    # --------------------------------------------------------------- report --
    print()
    for label in created:
        print(f"  + created   {label}")
    for label in updated:
        print(f"  ~ updated   {label}")
    for label in unchanged:
        print(f"  = unchanged {label}")
    print()
    print(f"created={len(created)} updated={len(updated)} unchanged={len(unchanged)}")

    if not DRY_RUN:
        client_id = frappe.get("client_id", "")
        print()
        print("Frappe Social Login Key values (client_secret is not printed):")
        print(f"  provider name : authentik")
        print(f"  client_id     : {client_id}")
        print(f"  redirect_url  : /api/method/frappe.integrations.oauth2_logins.custom/authentik")
        print(f"  base_url      : https://{IDP_HOST}/application/o/frappe-crm/")
        print(f"  authorize_url : authorize/")
        print(f"  token_url     : token/")
        print(f"  userinfo_url  : userinfo/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
