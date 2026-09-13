"""Private shared ingress for owner-mail event receivers."""
from __future__ import annotations

import os
from flask import Flask, Response, request
from owner_mail_events import OwnerMailEventError, OwnerMailEventUnavailable, OwnerMailEventsConfig, process_event
from owner_mail_reply import register_owner_mail_reply


SAFE_REJECTION_CODES = frozenset({
    "signature_invalid", "signature_expired", "payload_rejected", "recipient_rejected",
    "upstream_lookup_rejected", "upstream_lookup_unavailable",
    "native_write_rejected", "native_write_unavailable", "processing_rejected",
})


def safe_rejection_code(error: Exception) -> str:
    code = getattr(error, "safe_code", "processing_rejected")
    return code if code in SAFE_REJECTION_CODES else "processing_rejected"


def create_app(config=os.environ):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    @app.get("/health")
    def health():
        return {"ok": True, "service": "owner-mail-events"}

    @app.post("/api/owner-mail-events/resend")
    def resend():
        raw = request.get_data(cache=False)
        if len(raw) > 64 * 1024:
            return Response(status=413)
        try:
            process_event(raw, request.headers, OwnerMailEventsConfig.from_env(config))
        except OwnerMailEventUnavailable as error:
            app.logger.warning("owner_mail_events_rejected code=%s status=503", safe_rejection_code(error))
            return Response(status=503)
        except OwnerMailEventError as error:
            app.logger.warning("owner_mail_events_rejected code=%s status=400", safe_rejection_code(error))
            return Response(status=400)
        return Response(status=204)

    # Frappe calls this service only over the private host gateway. Its module
    # owns the distinct reply route and exact native HMAC contract.
    register_owner_mail_reply(app, config)
    return app


app = create_app()
