# Cloudflare Routing

Frank Hub uses the remote-managed `frank-hub-vps` Cloudflare Tunnel.

Configure routes in the Cloudflare Zero Trust dashboard:

1. Go to `Networks -> Connectors -> Cloudflare Tunnels`.
2. Select `frank-hub-vps`.
3. Open `Routes/Public Hostnames`.
4. Select `Add route`.
5. Add `hub.frank.fail` with service `http://localhost:3000`.
6. Add `api.frank.fail` with service `http://localhost:8080`.

Do not use `cloudflared tunnel route dns` as the primary setup path for this
remote-managed tunnel.

The web container proxies same-origin dashboard calls:

```text
https://hub.frank.fail/api/* -> http://api:8080/*
```

The direct API hostname is reserved for later/admin/debug access:

```text
https://api.frank.fail -> http://localhost:8080
```
