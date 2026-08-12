# Pavone Window Tinting Visualizer

A zero-dependency Node.js app that lets customers visualize window tint on their car photos using Gemini's image generation API.

## Features

- Upload a car photo
- Select from 6 QLD-legal tint shades
- AI-generated preview with drag-to-compare slider
- Lead capture with optional email and phone
- Admin dashboard to view leads and renders
- Graceful fallback to CSS shading if API fails

## Architecture

**Zero npm dependencies** — uses only Node.js builtins:
- `node:http` for the web server
- `node:fs` for file storage
- `node:crypto` for UUIDs
- `node:url` for parsing
- Global `fetch` (Node 22+)

No build step, no bundler, no TypeScript. Pure ES modules.

The app is self-contained and deliberately outside the Frank pnpm workspace so it cannot affect `pnpm run verify`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8787` | Server port |
| `GEMINI_API_KEY` | Yes | — | API key for Gemini image generation |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-image` | Image-edit model. See 'Model choice' below before changing. |
| `ADMIN_PASSWORD` | Yes | — | HTTP Basic auth password for `/admin` |
| `DATA_DIR` | No | `<app>/data` | Where renders and leads are written. Docker sets `/app/data`. |
| `RENDER_LIMIT_PER_DAY` | No | `3` | Free renders per visitor IP per UTC day |

Copy `.env.example` to `.env` and fill in the required values.

## Local Development

```bash
# Node 22 or later. There is no npm install step — there are no dependencies.
cd projects/pavone/app

# Copy and edit .env
cp .env.example .env
# Add your GEMINI_API_KEY and ADMIN_PASSWORD

# Start the server
npm start
# or: node server.mjs
```

Then visit `http://localhost:8787` in your browser.

## Deployment to VPS

### Prerequisites
- Docker installed on the VPS
- The app copied to `/srv/pavone` (or another directory)
- `.env` file with secrets populated at `/srv/pavone/.env`
- Caddy reverse proxy already running on the VPS

### Steps

1. Copy the app to the VPS:
   ```bash
   scp -r projects/pavone/app/* root@vps:/srv/pavone/
   ```

2. Create `.env` on the VPS with your secrets:
   ```bash
   ssh user@vps
   cd /srv/pavone
   cp .env.example .env
   # Edit .env with your GEMINI_API_KEY and ADMIN_PASSWORD
   ```

3. Run the deployment script:
   ```bash
   chmod +x /srv/pavone/deploy.sh
   /srv/pavone/deploy.sh /srv/pavone
   ```

4. Add the reverse proxy to your Caddyfile:
   ```
   see.pavoneauto.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```
   Then reload Caddy:
   ```bash
   caddy reload
   ```

The app will now be live at `https://see.pavoneauto.com`.

## Project Structure

```
projects/pavone/app/
├── server.mjs              # HTTP server + API routes
├── src/
│   ├── shades.mjs          # Tint shade definitions
│   ├── gemini.mjs          # Gemini image generation
│   └── store.mjs           # File + lead storage, rate limiting
├── public/
│   ├── index.html          # Single-page app
│   ├── app.js              # Client logic
│   └── styles.css          # Branding + responsive layout
├── tools/
│   └── render-harness.mjs  # P0 gate: photos x shades -> HTML comparison grid
├── data/                   # Renders, leads, temp files (git-ignored)
├── package.json
├── .env.example
├── .gitignore
├── Dockerfile
├── .dockerignore           # keeps .env + data/ OUT of the image layer
├── deploy.sh
├── Caddyfile.snippet
└── README.md               # This file
```

## API Routes

### `GET /api/health`
Health check. Returns:
```json
{
  "ok": true,
  "model": "gemini-2.5-flash-image",
  "hasKey": true,
  "version": "1.0.0"
}
```

### `POST /api/render`
Generate a tinted preview. Request:
```json
{
  "imageBase64": "...",
  "mime": "image/jpeg",
  "shadeId": "vlt35"
}
```
Response on success (200):
```json
{
  "ok": true,
  "renderId": "uuid-here",
  "imageBase64": "...",
  "mime": "image/jpeg"
}
```
Responses on failure:
- `429` (rate limited): `{ "ok": false, "error": "...", "fallback": true }`
- `502` (model failed): `{ "ok": false, "error": "...", "fallback": true }`
- `413` (payload too large): `413` status
- `400` (unknown shade): `{ "error": "Unknown shade" }`

### `POST /api/lead`
Capture a lead. Request:
```json
{
  "name": "John Doe",
  "phone": "0400000000",
  "email": "john@example.com",
  "vehicle": "Toyota Camry 2020",
  "shadeId": "vlt35",
  "renderId": "uuid-here"
}
```
Response (200):
```json
{
  "ok": true,
  "leadId": "uuid-here"
}
```

### `GET /r/<renderId>.jpg`
Download a rendered image.

### `GET /api/shades`
The authoritative shade catalog (id, label, VLT, privacy, QLD legality, badge).
The client hydrates from this at boot so a legality badge on screen can never
drift from the rule the server enforces. The inline array in `app.js` is a
fallback for a failed fetch only.

### `GET /api/selftest`
Admin-authed. Spends **one real render** to prove the key can actually generate
images, and returns a plain-English reason if it cannot.

`hasKey: true` in `/api/health` only means a key is *set* — a key whose project
has zero image quota is indistinguishable there. `deploy.sh` calls this
automatically after every deploy so the failure surfaces at deploy time rather
than via a customer who only ever sees the fallback preview.

Common result:
```json
{ "ok": false, "reason": "This project has ZERO image-generation quota. Enable billing on the Google Cloud project behind this API key." }
```
Image generation on the Gemini API is **not included in the free tier** — the
project behind the key needs billing enabled. Once it is, no redeploy is needed:
`docker restart pavone-visualizer`.

### `GET /admin`
Admin dashboard (HTTP Basic auth). Shows a table of all leads with render thumbnails.

### Static Assets
`GET /` → `index.html`
`GET /<path>` → files in `/public` with correct MIME types

## Model choice — measured, not assumed

`tools/render-harness.mjs` renders every test photo at every shade and builds an
HTML comparison grid. It exists because the obvious cheap default silently fails.

| model | 70%→5% glass luminance gap | behaviour |
|---|---|---|
| `gemini-2.5-flash-image` | ~3 points | regenerates the whole scene; shades indistinguishable |
| `gemini-3.1-flash-image` | 33–57 points | edits the glass only; clean monotonic ladder |

Two things made the difference, both measured:

1. **Image part before text part.** With text first the model reads the request as
   "generate a picture like this" and reimagines the scene. Image first it reads
   as "edit this".
2. **Perceptual shade descriptions, not VLT numbers.** "35% VLT" means nothing to
   an image model. "You can make out the shapes of the seats but not their detail"
   produces a reliable, monotonic ladder.

Cost is ~$0.067/render at 1K (about A$100 per 1,000 renders) — still trivial next
to one $430 install. Re-run the harness before changing the model or the prompts.

## Rate limiting

`RENDER_LIMIT_PER_DAY` (default 3) renders per client IP per UTC day, returning `429` when exceeded.

**Only successful renders consume quota.** A customer whose render fails is never
locked out having seen nothing — the server peeks at the limit before calling the
model and consumes it only after a render is saved.

The counter is in-memory, so it resets on restart. That is deliberate for now: it
costs cents at worst, and a persistent counter is not worth the complexity until
volume justifies it.

## Automatic Cleanup

Old renders and leads are pruned on boot and every 6 hours. Files older than 30 days are deleted.

## Security notes

- All lead fields are HTML-escaped before reaching `/admin` — lead input is
  unauthenticated, so treating it as untrusted is not optional.
- Lead fields are length-capped and stripped of control characters before they
  are appended to `leads.jsonl`.
- Upstream model errors are logged server-side but never returned to the caller;
  the client gets a generic message plus `fallback: true`.
- `.env` is both git-ignored and docker-ignored. On the Frank VPS the key should
  come from OpenBao rather than living as a file.
- Photos are resized and re-encoded client-side, which strips EXIF/GPS before
  anything is uploaded.

## Disclaimer

Footer displays: "Simulation only - actual appearance varies by film brand, glass type, and lighting."

## License

Internal use only.
