import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../web", import.meta.url));
const PORT = Number(process.env.MINI_OPERATOR_QA_PORT || 9431);
const DEBUG_PORT = PORT + 1;
const CHROME = process.env.CHROME_BIN || "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const OUTPUT = process.env.MINI_OPERATOR_QA_SCREENSHOT || "/srv/frank/tmp/cleanup-20260905/mini-operator-panel.png";
const HOSTILE = '<img src=x onerror="globalThis.pwned=1">';
let mode = 200;
let reads = 0;
let savedStatus = "new";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/qa-mode" && req.method === "POST") {
    mode = Number(url.searchParams.get("status"));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/api/projects") {
    return json(res, 200, { projects: [{ id: "mini-frank", name: "Mini Frank", setup_state: "ready", blurb: "Free guides and optional paid help." }], archived_projects: [] });
  }
  if (url.pathname === "/api/chat") return json(res, 200, { sessions: [] });
  if (url.pathname === "/api/operator/mini/service-requests" && req.method === "GET") {
    reads += 1;
    if (mode !== 200) return json(res, mode, {});
    return json(res, 200, { requests: [{ operator_status: savedStatus, request: { id: "svc_browser", kind: "video_call", note: HOSTILE }, contact: { method: "email", value: HOSTILE } }] });
  }
  if (url.pathname === "/api/operator/mini/service-requests/svc_browser" && req.method === "PATCH") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    return req.on("end", () => {
      savedStatus = JSON.parse(body).status;
      json(res, 200, { service_request: { id: "svc_browser", status: savedStatus } });
    });
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = path.resolve(ROOT, "." + requested);
  if (!target.startsWith(ROOT + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return json(res, 404, { error: "fixture route not found" });
  }
  res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, browser, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await browser.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error("Browser condition timed out: " + expression);
}
async function devtools() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("Chromium DevTools did not start");
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((ok, fail) => {
          const requestId = ++id;
          pending.set(requestId, { ok, fail });
          ws.send(JSON.stringify({ id: requestId, method, params }));
        });
      },
      evaluate(expression) {
        return this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).then((value) => value.result?.result?.value);
      },
      close() { ws.close(); },
    }));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.fail(new Error(message.error.message));
      else callback.ok(message);
    });
    ws.addEventListener("error", reject);
  });
}

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "frank-mini-operator-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
let browser;
try {
  await devtools();
  const page = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/`)}`, { method: "PUT" })).json();
  browser = await connect(page.webSocketDebuggerUrl);
  await waitFor(`document.querySelector('[data-project="mini-frank"]')`, browser);
  await browser.evaluate(`document.querySelector('[data-project="mini-frank"]').click()`);
  await waitFor("document.querySelector('#mini-service-requests')?.innerText.includes('1 service request')", browser);
  const safe = await browser.evaluate(`(() => ({ text: document.querySelector('#mini-service-requests').innerText, injected: document.querySelector('#mini-service-requests img') !== null, secret: document.documentElement.innerHTML.includes('server-secret') }))()`);
  assert.match(safe.text, /refreshes every 30 seconds/);
  assert.match(safe.text, /<img src=x onerror=/);
  assert.equal(safe.injected, false);
  assert.equal(safe.secret, false);

  await browser.evaluate(`(() => { const s=document.querySelector('.mini-operator-select'); s.value='contacted'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor("document.querySelector('.mini-operator-ack')?.innerText.includes('Saved as Contacted')", browser);
  assert.equal(savedStatus, "contacted");

  const before = reads;
  await browser.evaluate("document.querySelector('[data-mini-operator-refresh]').click()");
  for (let attempt = 0; reads === before && attempt < 30; attempt += 1) await wait(50);
  assert.ok(reads > before, "manual refresh did not reach the fixture API");

  await browser.evaluate("fetch('/qa-mode?status=401',{method:'POST'}).then(()=>document.querySelector('[data-mini-operator-refresh]').click())");
  await waitFor("document.querySelector('#mini-service-requests')?.innerText.includes('authentication expired')", browser);
  await browser.evaluate("fetch('/qa-mode?status=503',{method:'POST'}).then(()=>document.querySelector('[data-mini-operator-refresh]').click())");
  await waitFor("document.querySelector('#mini-service-requests')?.innerText.includes('Mini connection')", browser);

  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, Buffer.from(shot.result.data, "base64"));
  console.log(JSON.stringify({ ok: true, reads, savedStatus, screenshot: OUTPUT }));
} finally {
  browser?.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await exited;
  server.close();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await wait(150);
    }
  }
}
