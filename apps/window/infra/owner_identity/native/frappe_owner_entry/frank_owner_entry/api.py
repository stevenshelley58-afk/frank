"""Fixed native OIDC entry routes for the owner workspace."""
import frappe
from frappe.utils.oauth import get_oauth2_authorize_url

_RETURNS = {
    "crm": "/frank/bridge?app=crm&return=1",
    "support": "/frank/bridge?app=support&return=1",
}

@frappe.whitelist(allow_guest=True)
def enter(app: str):
    """Start the configured supported OIDC provider for one fixed owner panel.

    Caddy's owner session gate protects this otherwise-guest Frappe method. The
    caller cannot select a provider or redirect target, so it cannot become an
    open redirect or general OAuth launcher.
    """
    target = _RETURNS.get(str(app or ""))
    if target is None:
        frappe.throw("Unknown owner application", frappe.ValidationError)
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = get_oauth2_authorize_url("authentik", target)
