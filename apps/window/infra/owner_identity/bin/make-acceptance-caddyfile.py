#!/usr/bin/env python3
"""Derive a non-production acceptance edge from the committed Caddyfile.

The point is fidelity: the acceptance edge serves the *same* site blocks, the
same snippets and the same header policy that the Frank edge will serve in
production. Only three things change:

  * it listens on 9443/9080 instead of 443/80, so it never binds the public
    ports that frank-caddy owns;
  * `local_certs` makes Caddy issue from its own internal CA instead of ACME,
    so no certificate is requested for a name frank-caddy is also serving;
  * nothing else. The container listens on all of its own interfaces, and the
    only thing keeping it off the network is that Compose publishes its ports to
    host 127.0.0.1 exclusively. `default_bind 127.0.0.1` would NOT work: Docker
    forwards published ports to the container's bridge address, not to its
    loopback, so a loopback-bound listener is unreachable through the mapping.

Everything else, including the owner session boundary, the outpost route and
the frame-ancestors policy, is exactly what is proposed for production. A
browser can therefore be pointed at https://frank.fail/ and reach this edge
instead of the public one, with no change to hostnames, ports in URLs, cookies
or OAuth redirect URIs.
"""
from __future__ import annotations

import pathlib
import re
import sys

HEADER = """{
	# Acceptance-only overrides. Everything below this block is byte-identical
	# to the committed apps/window/Caddyfile.
	https_port 9443
	http_port 9080
	local_certs
	# The acceptance edge is not behind Cloudflare, so the edge ranges that the
	# production file trusts are irrelevant here and deliberately omitted.
}
"""


def main() -> int:
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "apps/window/Caddyfile")
    dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/acceptance-Caddyfile")
    text = src.read_text()

    # The production global block carries servers { trusted_proxies ... } for
    # Cloudflare. Replace that one block, keep every site block untouched.
    if not text.startswith("{"):
        raise SystemExit("unexpected Caddyfile shape: no leading global block")
    depth = 0
    end = None
    for i, ch in enumerate(text):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit("unexpected Caddyfile shape: unbalanced global block")

    body = text[end:].lstrip("\n")
    # The listen-only :80 catch-all would take the acceptance HTTP port; keep it
    # but move it out of the way by rewriting to the acceptance HTTP port.
    body = re.sub(r"^:80 \{", ":9080 {", body, flags=re.M)

    dst.write_text(HEADER + "\n" + body)
    print(f"wrote {dst} from {src} ({len(body.splitlines())} site lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
