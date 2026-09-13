#!/usr/bin/env python3
"""Check or create only the native routing mailboxes, without fetching messages."""
import argparse
import imaplib
import json
import os
import ssl


def ensure_folder(connection, create=False, name="Support"):
    if name not in {"Support", "Notifications"}:
        raise RuntimeError("unsupported_folder")
    quoted = '"' + name + '"'
    status, _ = connection.select(quoted, readonly=True)
    if status == "OK":
        return "unchanged"
    if not create:
        raise RuntimeError("routing_folder_missing")
    status, _ = connection.create(quoted)
    if status != "OK":
        raise RuntimeError("routing_folder_create_failed")
    status, _ = connection.select(quoted, readonly=True)
    if status != "OK":
        raise RuntimeError("routing_folder_readback_failed")
    return "created"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true")
    args = parser.parse_args()
    username = os.environ.get("PURELYMAIL_USERNAME", "")
    password = os.environ.get("PURELYMAIL_PASSWORD", "")
    if username != "blockwise@purelymail.com" or not password:
        raise RuntimeError("mailbox_credential_unavailable")
    with imaplib.IMAP4_SSL("imap.purelymail.com", 993, ssl_context=ssl.create_default_context(), timeout=20) as connection:
        connection.login(username, password)
        results = {name.lower(): ensure_folder(connection, args.create, name) for name in ("Support", "Notifications")}
    print(json.dumps({"routing_folders": results, "mail_fetched": False, "mail_moved": False}))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, imaplib.IMAP4.error):
        print('{"error":"routing_mailbox_check_failed"}')
        raise SystemExit(2)
