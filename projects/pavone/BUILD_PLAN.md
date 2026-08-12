# Pavone Visualizer — Frank Build Plan

**Client:** Pavone Window Tinting (pavoneauto.com), Unit 5/9 Clay St, West Ipswich QLD. Automotive / residential / commercial tint. 1800 TINT IT.
**Objective:** Lift quote→booking conversion by replacing the stock-photo simulator at `/tint-preview` with a photorealistic **"see it on your car"** renderer, wired into the existing quote wizard.
**Frank surfaces:** this folder (durable workspace) · room `pavone` · mini-Frank `pavone-frank` · service dir `/srv/pavone` on the VPS · preview lane `preview.frank.fail/pavone-visualizer-v*`.
**Origin:** full research plan (site review, competitor scan, model pricing) lives in the Claude project "Pavone" (`claude/visualizer-build-plan.md`, 9 Aug 2026). This doc is the Frank-native operational version.

---

## 1. Product in one paragraph

Customer uploads a photo of their own car (phone camera roll). They pick a shade from the chips the site already uses — 70 / 50 / 35 / 20 / 5% VLT — each carrying a QLD legality badge (windscreen: top 10% band only; front sides ≥35% VLT; behind driver ≥20%; goods vehicles exempt behind driver; ≤10% reflectance — confirm current TMR wording before production). An image-edit model returns the same photo with only the glass darkened, photorealistically, in 5–15s. Before/after drag slider, same pattern as the current page. Under the render: "Email me this + my quote" (name, phone, email → lead with render attached, straight into Pavone's quote pipeline) and "Book now". Downloads/shares are watermarked "Visualised by Pavone · pavoneauto.com". Three free renders per visitor per day, then contact-gate. Wraps come later as a demand test (§6).

## 2. Frank-native architecture

**RULE 0 applies: no localhost, no Vercel.** The original plan's Vercel + Supabase stack is replaced with the VPS:

| Piece | Frank way |
|---|---|
| Front-end | Static page (vanilla or small bundle), served from preview lane during build; production behind Caddy on the VPS (`see.pavoneauto.com` or embedded at `pavoneauto.com/tint-preview`) |
| API | Small Fastify service at `/srv/pavone` — `POST /api/render`, `POST /api/lead`, `GET /api/health`. Same Node 22 + pnpm conventions as the monorepo |
| Model call | Gemini 2.5 Flash Image ("Nano Banana", $0.039 USD/img standard — verified against official pricing docs Aug 2026). Server-side only. Upgrade path: Gemini 3.1 Flash Image $0.067/1K if glass-edge fidelity needs it. Route through Frank's model adapter layer once `adapters/models` lands; direct SDK call is acceptable inside `/srv/pavone` until then (it's a client service, not a FRANK core module — §17.2 SDK fence doesn't bind it, but keep the call in one file so the swap is trivial) |
| Data | Postgres on the VPS: `pavone_leads`, `pavone_renders`, `pavone_events`. Uploaded photos + renders on VPS disk with a 30-day retention sweep (cron), EXIF stripped on ingest |
| Secrets | Gemini key + SMTP creds from OpenBao — nothing in the repo or compose files |
| Leads out | Email to info@pavoneauto.com with the render attached (the shop already works from its inbox), plus the Postgres row. Console/dashboard later |
| Anti-abuse | Cloudflare Turnstile on upload, 3 renders/day per visitor, image-size caps. Worst-case runaway ≈ cents/day |
| Previews | Public + static — never put the API key or real lead data in the preview lane |

## 3. Build loop (preview-first)

**P0 — prove the render (budget: 10 USD API spend / ~1 day).**
Harness: ~20 real car photos (utes, SUVs, sedans, dark/light paint, driveway light) × 5 shades through Nano Banana with a locked instruction ("apply automotive window film at N% VLT to side and rear windows; front sides 35% where the legal-combo preset is chosen; preserve paint, wheels, plates, background, reflections exactly"). Output is itself a preview: deploy the comparison grid to `preview.frank.fail/pavone-render-harness-v1/` and review shade honesty (35 vs 20 vs 5 must be visibly, truthfully different). Checkpoint: prompt v1 locked + model tier chosen. Evidence: the grid URL + a pass/fail note per photo. Keep the harness for regression whenever prompt/model changes.

**P1 — MVP (budget: ~1–2 weeks part-time).**
Skeleton is already in `preview/` — deploy it minute-one (`preview/README.md` has the command), then iterate `--update`. Wire: upload → `/api/render` → compare slider → lead capture → email with render. Fallback path: if the render fails or times out, degrade to the CSS-darken placeholder (already in the skeleton) and still capture the lead. Checkpoint: a stranger can go URL → own-car render → quote request without help. Evidence: preview URL + one end-to-end lead landing in the inbox with render attached.

**P2 — funnel wiring.**
Swap the pavoneauto.com `/tint-preview` simulator for the app (or link out to `see.pavoneauto.com`), add a render step to the site's 6-step quote wizard after vehicle type, QR codes for the counter / shop window / ute, follow-up email at +3 days for renders with no quote. Events (`render_started`, `render_done`, `lead`, `booked`) into `pavone_events` so the funnel is measurable against the current baseline of quote-form submissions.

**P3 — wraps demand test + in-shop mode.**
Colour/finish rail (Avery SW900 as the benchmark catalog; KPMF / TeckWrap / Inozetek fill-ins) behind a "Wraps — see yours first" tab that counts clicks and renders. Pavone doesn't sell wraps today — this is a demand experiment; real interest → add the service or sell the lead to a Brisbane wrap shop. In-shop tablet mode: staff photograph the car in the bay, show 35 vs 20 side by side, close the Premium Ceramic upsell.

**Reviewer rule:** per the run-contract convention, whoever builds a phase, a different model family reviews the evidence before promote-to-production.

## 4. Prompts, honesty, and legality

The render must not oversell. Ship with the site's own disclaimer ("Simulation only — actual appearance varies by film brand, glass type, and lighting"), keep the sample-viewing CTA, and let the harness gate any change. Legality: badges on 20/5% chips ("rear only" / "show, off-road only"), a one-tap "darkest legal QLD combo" preset (35 front / 20 rear), staff confirm at quote time.

## 5. Costs

Nano Banana $0.039/render → 1,000 renders ≈ $39 USD (~A$60): one Entry install ($330) covers ~8 months of realistic volume. VPS already paid for. Turnstile free. Retention sweep keeps disk flat. Hard monthly API cap via provider budget + the per-visitor gate.

## 6. Flow candidates (later, `flows/`)

`pavone-lead-followup` — pipeline: render_done → no lead in 3 days → follow-up email with the render re-attached → reply-branch to booking link. Build against `packages/pipeline-graph` schema when P2 lands; folder-drop per `flows/README.md`.

## 7. KPIs

Baseline first (current weekly quote submissions). Then: tool opens → photo uploaded → render done → quote requested → booked. The project lives or dies on **render→quote rate**; renders per shade also tell Pavone which films to stock and which creative to run. 30-day review: beat the old page's visit→quote rate or iterate before buying traffic.
