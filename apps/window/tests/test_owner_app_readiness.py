"""Focused tests for owner application readiness.

The property under test is honesty: readiness must be decided by an authorized
server check, must distinguish "cannot tell" from "no", and must never report an
application as frameable when its origin cannot actually be rendered.
"""

from __future__ import annotations

import socket
import ssl
import unittest
from unittest import mock

import owner_app_readiness as readiness


class UnknownApplication(unittest.TestCase):
    def test_unknown_app_is_not_reported_as_broken(self):
        payload = readiness.app_readiness("not-an-app")
        self.assertFalse(payload["known"])
        self.assertIsNone(payload["ready"])
        self.assertIsNone(payload["frameable"])
        self.assertEqual(payload["reason"], "unknown_app")

    def test_unknown_app_renders_404(self):
        status, ctype, body = readiness.render_readiness("nope", readiness.app_readiness("nope"))
        self.assertEqual(status, 404)
        self.assertEqual(ctype, "application/json")
        self.assertIn("unknown_app", body)

    def test_known_app_renders_200(self):
        payload = {
            "app": "crm", "known": True, "ready": True, "frameable": True,
            "origin": readiness.OWNER_APPS["crm"]["origin"], "checked_at": 0,
        }
        status, _ctype, body = readiness.render_readiness("crm", payload)
        self.assertEqual(status, 200)
        self.assertIn('"frameable": true', body)


class UnverifiableIsNotAFailure(unittest.TestCase):
    """A time-out or refused connection is unknown, not a definite negative."""

    def test_tls_timeout_is_unknown_not_untrusted(self):
        with mock.patch.object(readiness.socket, "create_connection", side_effect=socket.timeout):
            cert_ok, reason = readiness._certificate_covers("crm", "https://crm.frank.fail", 1.0)
        self.assertIsNone(cert_ok)
        self.assertEqual(reason, "tls_timeout")

    def test_probe_timeout_is_unknown(self):
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=socket.timeout):
            ready, status, reason = readiness._probe_origin("crm", 1.0)
        self.assertIsNone(ready)
        self.assertIsNone(status)
        self.assertEqual(reason, "request_timeout")

    def test_unknown_tls_makes_frameable_unknown_not_false(self):
        with mock.patch.object(readiness, "_certificate_covers", return_value=(None, "tls_timeout")), \
             mock.patch.object(readiness, "_probe_origin", return_value=(True, 200, "answered")):
            payload = readiness.app_readiness("crm")
        self.assertIsNone(payload["frameable"])
        self.assertEqual(payload["reason"], "origin_tls_unknown")


class CertificateDecidesFraming(unittest.TestCase):
    def test_untrusted_certificate_blocks_framing_with_a_real_reason(self):
        with mock.patch.object(readiness, "_certificate_covers", return_value=(False, "tls_error:TLSV1_ALERT_INTERNAL_ERROR")), \
             mock.patch.object(readiness, "_probe_origin", return_value=(True, 200, "answered")):
            payload = readiness.app_readiness("crm")
        # The application may be perfectly healthy, but the browser cannot render
        # an origin with no trusted certificate, so it must not be framed.
        self.assertTrue(payload["ready"])
        self.assertFalse(payload["frameable"])
        self.assertEqual(payload["reason"], "origin_certificate_untrusted")
        self.assertIn("crm.frank.fail", payload["detail"])

    def test_trusted_certificate_and_healthy_origin_is_frameable(self):
        with mock.patch.object(readiness, "_certificate_covers", return_value=(True, "certificate_present")), \
             mock.patch.object(readiness, "_probe_origin", return_value=(True, 200, "answered")):
            payload = readiness.app_readiness("crm")
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["frameable"])
        self.assertEqual(payload["reason"], "allowed")

    def test_trusted_certificate_but_dead_origin_is_not_frameable(self):
        with mock.patch.object(readiness, "_certificate_covers", return_value=(True, "certificate_present")), \
             mock.patch.object(readiness, "_probe_origin", return_value=(False, None, "unreachable:ConnectionRefusedError")):
            payload = readiness.app_readiness("crm")
        self.assertFalse(payload["frameable"])
        self.assertEqual(payload["reason"], "origin_unreachable")


class AuthChallengeIsAHealthyApplication(unittest.TestCase):
    def test_login_redirect_is_ready(self):
        # A 302 to a login page means the application is alive. Whether the owner
        # is signed in is a different question and is not decided here.
        import urllib.error

        error = urllib.error.HTTPError("https://crm.frank.fail/crm/leads", 302, "Found", {}, None)
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=error):
            ready, status, reason = readiness._probe_origin("crm", 1.0)
        self.assertTrue(ready)
        self.assertEqual(status, 302)
        self.assertEqual(reason, "answered_with_status")

    def test_auth_required_is_ready(self):
        import urllib.error

        error = urllib.error.HTTPError("https://crm.frank.fail/crm/leads", 401, "Unauthorized", {}, None)
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=error):
            ready, _status, _reason = readiness._probe_origin("crm", 1.0)
        self.assertTrue(ready)

    def test_server_error_is_not_ready(self):
        import urllib.error

        error = urllib.error.HTTPError("https://crm.frank.fail/crm/leads", 500, "Server Error", {}, None)
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=error):
            ready, status, _reason = readiness._probe_origin("crm", 1.0)
        self.assertFalse(ready)
        self.assertEqual(status, 500)


class OwnerSignInIsNotReadiness(unittest.TestCase):
    """An identity-provider redirect must never be reported as a frameable app."""

    def test_identity_redirect_is_recognised(self):
        self.assertTrue(readiness._identity_redirect("https://auth.frank.fail/application/o/authorize/?client_id=x"))
        self.assertTrue(readiness._identity_redirect("https://crm.frank.fail/outpost.goauthentik.io/start?rd=/"))
        self.assertFalse(readiness._identity_redirect(""))
        self.assertFalse(readiness._identity_redirect("https://crm.frank.fail/crm/leads/view/list"))
        self.assertFalse(readiness._identity_redirect(None))

    def test_a_redirect_to_sign_in_is_not_ready_and_not_frameable(self):
        # The real edge answers an unauthenticated probe with a 302 to the
        # identity provider. That is the edge talking, not the application, and
        # framing it would put the sign-in page inside the panel.
        import urllib.error

        error = urllib.error.HTTPError(
            "https://crm.frank.fail/crm/leads/view/list", 302, "Found",
            {"Location": "https://auth.frank.fail/application/o/authorize/?client_id=x"}, None,
        )
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=error), \
             mock.patch.object(readiness, "_certificate_covers", return_value=(True, "certificate_present")):
            payload = readiness.app_readiness("crm")
        self.assertFalse(payload["ready"])
        self.assertFalse(payload["frameable"])
        self.assertEqual(payload["reason"], "owner_session_required")
        self.assertIn("sign in", payload["detail"])

    def test_an_application_auth_challenge_is_still_ready(self):
        # A 401 from the application itself is a live application. Only a
        # redirect at the identity provider is treated as not yet usable.
        import urllib.error

        error = urllib.error.HTTPError("https://crm.frank.fail/x", 401, "Unauthorized", {}, None)
        with mock.patch.object(readiness.urllib.request, "urlopen", side_effect=error):
            ready, status, reason = readiness._probe_origin("crm", 1.0)
        self.assertTrue(ready)
        self.assertEqual(status, 401)
        self.assertEqual(reason, "answered_with_status")


class RegistryContract(unittest.TestCase):
    def test_every_registered_app_uses_https(self):
        for app_id, app in readiness.OWNER_APPS.items():
            self.assertTrue(app["origin"].startswith("https://"), app_id)

    def test_registry_matches_the_workspace_host_application_ids(self):
        # The host independently refuses any origin that is not its own declared
        # value, so the two registries must agree on the set of applications.
        # The host module lands from the shell lane; until it is integrated this
        # parity cannot be checked, and an unrun parity check must not be
        # reported as a pass.
        import re
        from pathlib import Path

        host_module = Path(__file__).resolve().parent.parent / "web" / "js" / "owner-app-host.js"
        if not host_module.is_file():
            self.skipTest("owner-app-host.js is not integrated yet; parity cannot be checked")
        source = host_module.read_text(encoding="utf-8")
        js_ids = re.findall(r'^\s{4}id: "([a-z]+)",$', source, re.M)
        self.assertTrue(js_ids, "owner-app-host.js declares no application ids; the shape changed")
        self.assertEqual(sorted(js_ids), sorted(readiness.OWNER_APPS))

    def test_approved_frame_ancestor_is_the_frank_origin(self):
        self.assertEqual(readiness.APPROVED_FRAME_ANCESTOR, "https://frank.fail")

    def test_workspace_readiness_covers_every_app_with_a_timestamp(self):
        with mock.patch.object(readiness, "_certificate_covers", return_value=(False, "tls_error:x")), \
             mock.patch.object(readiness, "_probe_origin", return_value=(False, None, "unreachable:x")):
            payload = readiness.workspace_readiness()
        self.assertEqual(sorted(payload["apps"]), sorted(readiness.OWNER_APPS))
        self.assertGreater(payload["checked_at"], 0)
        self.assertEqual(payload["schema"], "schema://frank.owner-app-readiness/v1")


if __name__ == "__main__":
    unittest.main()
