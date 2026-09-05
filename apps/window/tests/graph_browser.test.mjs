import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((item) => item && existsSync(item));

async function runChrome(args, options = {}) {
  const profile = await mkdtemp(resolve(tmpdir(), "frank-graph-chrome-profile-"));
  try {
    return await execute(chrome, [`--user-data-dir=${profile}`, ...args], options);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

function mime(path) {
  return ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".gif": "image/gif" })[extname(path)] || "application/octet-stream";
}

async function server(servedRoot) {
  const instance = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^[/\\]+/, "");
      const path = resolve(servedRoot, relative);
      const base = resolve(servedRoot);
      if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error("outside root");
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": mime(path), "Cache-Control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen));
  return instance;
}

async function chromeDom(url) {
  const { stdout } = await runChrome([
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--virtual-time-budget=3000", "--dump-dom", url,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

function pngPixels(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported screenshot PNG color type ${colorType}`);
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[input++];
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[input++];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}

test("production graph build emits runtime assets and renderer licenses", async () => {
  const output = resolve(root, "web/graph");
  const [javascript, css, license, g6License, louvainLicense] = await Promise.all([
    readFile(resolve(output, "graph-workbench.bundle.js"), "utf8"),
    readFile(resolve(output, "graph-workbench.bundle.css"), "utf8"),
    readFile(resolve(output, "maxgraph-APACHE-2.0.txt"), "utf8"),
    readFile(resolve(output, "antv-g6-MIT.txt"), "utf8"),
    readFile(resolve(output, "graphology-communities-louvain-MIT.txt"), "utf8"),
  ]);
  assert.ok(javascript.length > 100_000);
  assert.match(css, /\.graph-workbench/);
  assert.match(css, /height:\s*min\(62vh,\s*640px\)/);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(g6License, /MIT License/);
  assert.match(louvainLicense, /MIT License/);
  assert.equal(existsSync(resolve(output, "isolated-harness.html")), false);
  assert.doesNotMatch(javascript, /fixture-tool/);
  assert.doesNotMatch(css, /fixture-tool/);
});

test("isolated maxGraph harness has a nonzero, nonblank canvas and clears stale cells", { skip: !chrome }, async () => {
  const productionRoot = resolve(root, "web/graph");
  const productionHarness = resolve(productionRoot, "isolated-harness.html");
  assert.equal(existsSync(productionHarness), false);
  const directory = await mkdtemp(resolve(tmpdir(), "frank-graph-browser-"));
  const testRoot = resolve(directory, "graph");
  let http = null;
  try {
    await mkdir(testRoot, { recursive: true });
    await Promise.all([
      copyFile(resolve(root, "graph/isolated-harness.html"), resolve(testRoot, "isolated-harness.html")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.js"), resolve(testRoot, "graph-workbench.bundle.js")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.css"), resolve(testRoot, "graph-workbench.bundle.css")),
      copyFile(resolve(productionRoot, "maxgraph-APACHE-2.0.txt"), resolve(testRoot, "maxgraph-APACHE-2.0.txt")),
      cp(resolve(productionRoot, "assets"), resolve(testRoot, "assets"), { recursive: true }),
    ]);
    http = await server(testRoot);
    const port = http.address().port;
    const url = `http://127.0.0.1:${port}/isolated-harness.html`;
    const readyDom = await chromeDom(url);
    assert.match(readyDom, /data-graph-state="ready"/);
    assert.match(readyDom, /class="graph-canvas"[^>]*tabindex="0"/i);
    assert.match(readyDom, /aria-describedby="graph-instructions-\d+"/);
    assert.match(readyDom, /Focus the graph and press Enter or Space/);
    const width = Number(readyDom.match(/data-canvas-width="(\d+)"/)?.[1]);
    const height = Number(readyDom.match(/data-canvas-height="(\d+)"/)?.[1]);
    assert.ok(width >= 300 && height >= 280, `canvas was only ${width}x${height}`);
    assert.match(readyDom, /<svg[^>]*>/);

    const screenshot = resolve(directory, "graph.png");
    await runChrome([
      "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
      "--virtual-time-budget=3000", "--window-size=1200,800", `--screenshot=${screenshot}`, url,
    ]);
    const image = pngPixels(await readFile(screenshot));
    assert.equal(image.width, 1200);
    assert.equal(image.height, 800);
    const colors = new Set();
    for (let y = 180; y < 680; y += 12) {
      for (let x = 30; x < 1170; x += 12) {
        const offset = (y * image.width + x) * image.channels;
        colors.add(image.pixels.subarray(offset, offset + 3).toString("hex"));
      }
    }
    assert.ok(colors.size >= 3, `canvas region had only ${colors.size} sampled colors`);

    const failedDom = await chromeDom(`${url}?failure=after-ready`);
    assert.match(failedDom, /data-graph-state="unavailable"/);
    assert.match(failedDom, /data-pending-cleared="yes"/);
    const canvasMarkup = failedDom.match(/<div class="graph-canvas"[\s\S]*?<p class="graph-meta"/)?.[0] || "";
    assert.doesNotMatch(canvasMarkup, />prepare</);
    assert.doesNotMatch(canvasMarkup, />publish</);

    const raceDom = await chromeDom(`${url}?race=1`);
    assert.match(raceDom, /data-graph-state="ready"/);
    const raceCanvas = raceDom.match(/<div class="graph-canvas"[\s\S]*?<p class="graph-meta"/)?.[0] || "";
    assert.match(raceCanvas, />latest</);
    assert.doesNotMatch(raceCanvas, />stale</);
    assert.match(raceDom, new RegExp(`sha256:${"c".repeat(11)}`));

    for (const mode of [
      "revision", "unknown-root", "node-incomplete", "html", "control",
      "nonfinite", "duplicate-node", "bad-reference", "duplicate-edge", "group-cycle",
    ]) {
      const invalidDom = await chromeDom(`${url}?invalid=${mode}`);
      assert.match(invalidDom, /data-graph-state="unavailable"/, `${mode} payload was accepted`);
      assert.doesNotMatch(invalidDom, /data-graph-state="ready"/, `${mode} payload rendered`);
    }
  } finally {
    if (http) await new Promise((resolveClose) => http.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
    assert.equal(existsSync(productionHarness), false);
  }
});

test("isolated G6 project atlas renders collapsed knowledge areas and inspector", { skip: !chrome }, async () => {
  const productionRoot = resolve(root, "web/graph");
  const directory = await mkdtemp(resolve(tmpdir(), "frank-atlas-browser-"));
  const testRoot = resolve(directory, "graph");
  let http = null;
  try {
    await mkdir(testRoot, { recursive: true });
    await Promise.all([
      copyFile(resolve(root, "graph/isolated-harness.html"), resolve(testRoot, "isolated-harness.html")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.js"), resolve(testRoot, "graph-workbench.bundle.js")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.css"), resolve(testRoot, "graph-workbench.bundle.css")),
      cp(resolve(productionRoot, "assets"), resolve(testRoot, "assets"), { recursive: true }),
    ]);
    http = await server(testRoot);
    const url = `http://127.0.0.1:${http.address().port}/isolated-harness.html?kind=project&large=1`;
    const dom = await chromeDom(url);
    assert.match(dom, /data-graph-state="ready"/);
    assert.match(dom, /data-graph-renderer="g6"/);
    assert.match(dom, /class="graph-workbench graph-project-atlas"/);
    assert.match(dom, /class="graph-renderer-host graph-atlas-host" data-active="true"/);
    assert.match(dom, /Fixture project atlas/);
    assert.match(dom, /Project atlas/);
    assert.match(dom, /knowledge areas/);
    assert.match(dom, /Double-click a knowledge area/);
    assert.match(dom, /<canvas[^>]*>/);
    const expanded = await chromeDom(`${url}&expand=1`);
    assert.match(expanded, /data-atlas-expanded="true"/);
    assert.match(expanded, /data-atlas-selected="[^"]+"/);
    assert.match(expanded, /Direct relationships|Hindsight has retained|project knowledge graph/);
  } finally {
    if (http) await new Promise((resolveClose) => http.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  }
});
test("renderer lifecycle can switch Sigma, maxGraph, and Sigma without stale hosts", { skip: !chrome }, async () => {
  const productionRoot = resolve(root, "web/graph");
  const directory = await mkdtemp(resolve(tmpdir(), "frank-graph-cycle-"));
  const testRoot = resolve(directory, "graph");
  let http = null;
  try {
    await mkdir(testRoot, { recursive: true });
    await Promise.all([
      copyFile(resolve(root, "graph/isolated-harness.html"), resolve(testRoot, "isolated-harness.html")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.js"), resolve(testRoot, "graph-workbench.bundle.js")),
      copyFile(resolve(productionRoot, "graph-workbench.bundle.css"), resolve(testRoot, "graph-workbench.bundle.css")),
    ]);
    http = await server(testRoot);
    const dom = await chromeDom(`http://127.0.0.1:${http.address().port}/isolated-harness.html?cycle=1`);
    assert.match(dom, /data-graph-state="ready"/);
    assert.match(dom, /data-renderer-sequence="sigma,maxgraph,sigma"/);
    assert.match(dom, /data-graph-renderer="sigma"/);
    assert.doesNotMatch(dom, /data-graph-renderer="maxgraph"/);
    assert.match(dom, /class="graph-renderer-host graph-sigma-host"/);
    assert.match(dom, /class="graph-renderer-host graph-max-host"/);
  } finally {
    if (http) await new Promise((resolveClose) => http.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  }
});
// End of isolated browser harness coverage.
// Browser tests intentionally stop at the shared Tool graph boundary.
