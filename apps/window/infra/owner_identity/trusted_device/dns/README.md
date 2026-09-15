# Trusted-device resolver

A phone cannot pin `auth.frank.fail` in a hosts file the way the enrolled
laptop does, and the trusted-device verifier only recognises a request that
reaches Caddy over Tailscale. This CoreDNS container listens on the VPS's
Tailscale address only and answers `auth.frank.fail` with that address;
every other `frank.fail` name is forwarded to public DNS unchanged.

Deploy from a clean `/projects/frank` on `main`:

```sh
cd /projects/frank/apps/window/infra/owner_identity/trusted_device/dns
./deploy.sh
```

Then, once, in the Tailscale admin console (DNS, Nameservers, Add nameserver,
Custom): nameserver = the VPS Tailscale address, restrict to domain
`frank.fail`. Tailscale pushes that split-DNS route to every device on the
tailnet that uses Tailscale DNS settings (the default on Android and iOS).
The route only changes where `frank.fail` names are looked up; the public
site, certificates and hostnames are unchanged.

Nothing here grants access. The verifier still requires the device's exact
Tailscale node and owner identity to be listed in
`/srv/frank/secrets/owner-trusted-devices.json`, and an unlisted device on the
tailnet gets the normal owner sign-in.
