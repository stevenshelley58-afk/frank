"""Configure Frappe's supported OpenID Connect login for the owner CRM.

Piped into `bench --site <site> console`, so bench has already initialised the
site and opened the database connection. Frappe's Social Login Key with the
`Custom` provider is the supported generic-OIDC path; the callback is
/api/method/frappe.integrations.oauth2_logins.custom/<provider name>.

Nothing here is a proxy trick: after this runs, Frappe itself performs the
authorization-code exchange, calls the IdP's userinfo endpoint, matches the
returned identity to an existing User row and issues its own sid session.

`sign_ups` is set to Deny, so an identity that does not already exist as a
Frappe user is refused instead of being silently created.
"""
import json
import os

import frappe
from frappe.installer import update_site_config

PROVIDER = os.environ.get("FRAPPE_PROVIDER_NAME", "authentik")
HOST_NAME = os.environ["FRAPPE_HOST_NAME"]

config = frappe.get_site_config()
if config.get("host_name") != HOST_NAME:
    update_site_config("host_name", HOST_NAME)
    print(f"~ site host_name -> {HOST_NAME}")
else:
    print(f"= site host_name ({HOST_NAME})")

wanted = {
    "enable_social_login": 1,
    "social_login_provider": "Custom",
    "provider_name": PROVIDER,
    "client_id": os.environ["FRAPPE_CLIENT_ID"],
    "client_secret": os.environ["FRAPPE_CLIENT_SECRET"],
    # base_url is only used to render the login button; the endpoints below are
    # absolute. authentik serves authorization, token and userinfo from the
    # SHARED /application/o/... paths and identifies the client by client_id;
    # only discovery, jwks and end-session are per application slug.
    # /application/o/<slug>/authorize/ does not exist and returns 404, which is
    # why relative endpoint paths must not be used with custom_base_url.
    "base_url": os.environ["FRAPPE_BASE_URL"],
    "custom_base_url": 0,
    "authorize_url": os.environ["FRAPPE_AUTHORIZE_URL"],
    "access_token_url": os.environ["FRAPPE_TOKEN_URL"],
    "api_endpoint": os.environ["FRAPPE_USERINFO_URL"],
    "redirect_url": f"/api/method/frappe.integrations.oauth2_logins.custom/{PROVIDER}",
    "user_id_property": "sub",
    # Frappe builds the authorize URL through rauth, which does not add
    # response_type for this provider. authentik answers an authorize request
    # with no response_type using error=unsupported_response_type ("does not
    # support obtaining an authorization code using this method"), so the value
    # is supplied explicitly here. Verified by probing the authorize endpoint
    # with and without the parameter.
    "auth_url_data": json.dumps({"response_type": "code", "scope": "openid email profile"}),
    # The owner identity is provisioned by bin/bootstrap.py, never by signup.
    "sign_ups": "Deny",
}

if frappe.db.exists("Social Login Key", PROVIDER):
    doc = frappe.get_doc("Social Login Key", PROVIDER)
    changed = []
    for field, value in wanted.items():
        if doc.get(field) != value:
            changed.append(field)
            doc.set(field, value)
    if changed:
        doc.save(ignore_permissions=True)
        print("~ updated Social Login Key: " + ", ".join(sorted(changed)))
    else:
        print("= Social Login Key unchanged")
else:
    doc = frappe.get_doc({"doctype": "Social Login Key", "provider_name": PROVIDER, **wanted})
    doc.insert(ignore_permissions=True)
    print("+ created Social Login Key")

frappe.db.commit()

doc = frappe.get_doc("Social Login Key", PROVIDER)
owner = frappe.db.get_value("User", "owner@blockwise.sale", ["name", "enabled", "user_type"], as_dict=True)
print(json.dumps({
    "provider": doc.name,
    "enable_social_login": doc.enable_social_login,
    "social_login_provider": doc.social_login_provider,
    "sign_ups": doc.sign_ups,
    "base_url": doc.base_url,
    "custom_base_url": doc.custom_base_url,
    "authorize_url": doc.authorize_url,
    "access_token_url": doc.access_token_url,
    "api_endpoint": doc.api_endpoint,
    "user_id_property": doc.user_id_property,
    "login_url": f"{frappe.utils.get_url()}/api/method/frappe.integrations.oauth2_logins.custom/{PROVIDER}",
    "callback_url": frappe.utils.get_url(doc.redirect_url),
    "client_secret_stored": bool(doc.get_password("client_secret", raise_exception=False)),
    "owner_user": owner,
}, indent=2))
