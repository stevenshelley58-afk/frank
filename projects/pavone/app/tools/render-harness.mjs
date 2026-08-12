#!/usr/bin/env node
/**
 * P0 render harness — Pavone visualizer.
 *
 * Runs every test photo through every shade against the real image model and
 * builds an HTML comparison grid so shade honesty can be judged by eye before
 * any of this ships. This is the gate described in BUILD_PLAN.md §3 (P0).
 *
 *   GEMINI_API_KEY=... node tools/render-harness.mjs [photoDir] [--shades vlt35,vlt20]
 *
 * Outputs tools/harness-out/index.html plus one jpg per (photo × shade).
 * Dev tool only — not part of the shipped app, not part of its dependency story.
 */
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const { SHADES } = await import(join(APP, 'src/shades.mjs'))
const { renderTint, DEFAULT_MODEL } = await import(join(APP, 'src/gemini.mjs'))

const args = process.argv.slice(2)
const photoDir = args.find(a => !a.startsWith('--')) || join(HERE, 'test-photos')
const only = (args.find(a => a.startsWith('--shades=')) || '').split('=')[1]
const outDir = join(HERE, 'harness-out')

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1) }
const model = process.env.GEMINI_MODEL || DEFAULT_MODEL

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const shades = SHADES.filter(s => s.vlt !== 100 && (!only || only.split(',').includes(s.id)))

let files = []
try {
  files = (await readdir(photoDir)).filter(f => MIME[extname(f).toLowerCase()]).sort()
} catch {
  console.error(`No photo directory at ${photoDir}`); process.exit(1)
}
if (!files.length) { console.error(`No images in ${photoDir}`); process.exit(1) }

await mkdir(outDir, { recursive: true })
console.log(`Harness: ${files.length} photo(s) × ${shades.length} shade(s) = ${files.length * shades.length} renders`)
console.log(`Model: ${model}\n`)

// Bounded concurrency so we don't trip rate limits.
const LIMIT = 3
const jobs = []
for (const file of files) for (const shade of shades) jobs.push({ file, shade })

const results = []
let done = 0
async function worker() {
  while (jobs.length) {
    const { file, shade } = jobs.shift()
    const started = process.hrtime.bigint()
    const rec = { file, shade: shade.id, label: shade.label, ok: false }
    try {
      const buf = await readFile(join(photoDir, file))
      const out = await renderTint({
        imageBase64: buf.toString('base64'),
        mime: MIME[extname(file).toLowerCase()],
        shadeId: shade.id,
        apiKey, model,
      })
      const name = `${basename(file, extname(file))}--${shade.id}.jpg`
      await writeFile(join(outDir, name), Buffer.from(out.imageBase64, 'base64'))
      rec.ok = true
      rec.out = name
      rec.bytes = Buffer.from(out.imageBase64, 'base64').length
    } catch (err) {
      rec.error = err.message
    }
    rec.ms = Number((process.hrtime.bigint() - started) / 1000000n)
    results.push(rec)
    done++
    console.log(`[${String(done).padStart(3)}/${done + jobs.length}] ${rec.ok ? 'ok  ' : 'FAIL'} ${file} ${shade.label} ${rec.ms}ms${rec.error ? ' — ' + rec.error : ''}`)
  }
}
await Promise.all(Array.from({ length: LIMIT }, worker))

// Copy originals in so the grid is self-contained.
for (const file of files) {
  await writeFile(join(outDir, `orig--${file}`), await readFile(join(photoDir, file)))
}

const byFile = new Map()
for (const r of results) {
  if (!byFile.has(r.file)) byFile.set(r.file, [])
  byFile.get(r.file).push(r)
}

const rows = [...byFile.entries()].map(([file, recs]) => {
  const cells = shades.map(s => {
    const r = recs.find(x => x.shade === s.id)
    return r?.ok
      ? `<figure><img src="${r.out}" alt="${file} ${s.label}"><figcaption>${s.label}<span>${r.ms}ms</span></figcaption></figure>`
      : `<figure class="fail"><div class="x">render failed</div><figcaption>${s.label}<span>${r?.error || 'no result'}</span></figcaption></figure>`
  }).join('')
  return `<section><h2>${file}</h2><div class="grid">
    <figure class="orig"><img src="orig--${file}" alt="${file} original"><figcaption>ORIGINAL<span>no film</span></figcaption></figure>
    ${cells}</div></section>`
}).join('\n')

const okCount = results.filter(r => r.ok).length
const avgMs = results.length ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length) : 0

await writeFile(join(outDir, 'index.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Pavone P0 render harness</title><style>
body{background:#0b100e;color:#e8efec;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:28px}
h1{font-size:22px;margin:0 0 4px} .meta{color:#93a49e;font-size:13px;margin-bottom:24px}
.meta b{color:#3fb397}
section{margin-bottom:34px} h2{font-size:14px;color:#d8c08a;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
figure{margin:0;background:#121917;border:1px solid #22302b;border-radius:10px;overflow:hidden}
figure.orig{border-color:#3fb397}
figure.fail{min-height:150px;display:flex;flex-direction:column;justify-content:center}
.x{color:#e07a5f;text-align:center;padding:26px 8px;font-size:13px}
img{width:100%;display:block;aspect-ratio:4/3;object-fit:cover}
figcaption{padding:8px 10px;font-size:12.5px;font-weight:600;display:flex;justify-content:space-between;gap:8px}
figcaption span{color:#93a49e;font-weight:400;font-size:11px;text-align:right}
.check{background:#121917;border:1px solid #22302b;border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13.5px;color:#93a49e}
.check b{color:#e8efec;display:block;margin-bottom:6px}
</style></head><body>
<h1>P0 render harness — shade honesty check</h1>
<div class="meta">model <b>${model}</b> · ${okCount}/${results.length} renders succeeded · avg <b>${avgMs}ms</b></div>
<div class="check"><b>What to look for before this passes the gate</b>
Each row must step visibly darker left→right, and the step must be honest (35% is a clear smoke, not a blackout).
Paint colour, wheels, badges, number plate, background and lighting must be unchanged from the original.
Only the side and rear glass should differ. Any row that fails these is a prompt bug, not a model limitation.</div>
${rows}
</body></html>`)

await writeFile(join(outDir, 'results.json'), JSON.stringify({ model, results }, null, 2))
console.log(`\n${okCount}/${results.length} succeeded, avg ${avgMs}ms`)
console.log(`Grid: ${join(outDir, 'index.html')}`)
