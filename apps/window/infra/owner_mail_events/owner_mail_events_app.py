"""Private shared ingress for owner-mail event receivers."""
from __future__ import annotations

import os
from flask import Flask, Response, request
from owner_mail_events import OwnerMailEventError, OwnerMailEventUnavailable, OwnerMailEventsConfig, process_event
from owner_mail_reply import register_owner_mail_reply


def create_app(config=os.environ):
    app = Flask(__name__)

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
        except OwnerMailEventUnavailable:
            return Response(status=503)
        except OwnerMailEventError:
            return Response(status=400)
        return Response(status=204)

    # Frappe calls this service only over the private host gateway. Its module
    # owns the distinct reply route and exact native HMAC contract.
    register_owner_mail_reply(app, config)
    return app


app = create_app()
