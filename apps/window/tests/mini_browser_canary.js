import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE_URL = (process.env.FRANK_BROWSER_URL || "http://127.0.0.1:8765/frank/").replace(/\/$/, "");
const PORT = Number(process.env.FRANK_BROWSER_PORT || 9333);
const CHROME = process.env.CHROME_BIN || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = path.join(os.tmpdir(), `frank-mini-browser-${process.pid}`);
const WINDOW_SIZE = process.argv[2] || "1440,900";
const SCREENSHOT = process.argv[3] || "";
const EXERCISE_SUBMIT = process.env.FRANK_BROWSER_EXERCISE_SUBMIT === "1";
const [WIDTH, HEIGHT] = WINDOW_SIZE.split(",").map(Number);

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForDevTools() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Chrome DevTools did not start");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((resolveResult, rejectResult) => {
          const id = nextId++;
          pending.set(id, { resolve: resolveResult, reject: rejectResult });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      evaluate(expression) { return this.send("Runtime.evaluate", { expression, returnByValue: true }).then((result) => result.result?.value); },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, `--window-size=${WINDOW_SIZE}`, "about:blank",
  ], { stdio: "ignore" });
  let browser;
  try {
    await waitForDevTools();
    const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: "PUT" })).json();
    browser = await connect(page.webSocketDebuggerUrl);
    await browser.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 768 });
    await wait(800);
    const result = await browser.evaluate(`(() => {
      const rect = (selector) => {
        const item = document.querySelector(selector)?.getBoundingClientRect();
        return item ? { left: item.left, right: item.right, width: item.width, top: item.top, bottom: item.bottom } : null;
      };
      const input = document.querySelector("#message");
      const publicResources = [...document.querySelectorAll("link[href], script[src]")]
        .map((item) => item.href || item.src)
        .filter(Boolean);
      const loadedResources = performance.getEntriesByType("resource").map((item) => item.name);
      input.value = "A quick test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const sendEnabled = !document.querySelector(".send-button")?.disabled;
      const sendAction = document.querySelector(".send-button")?.dataset.action || "";
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canonicalPath: location.pathname,
        publicResources,
        hasLegacyPublicPath: [...publicResources, ...loadedResources].some((value) => {
          try { return new URL(value, location.origin).pathname.startsWith("/mini"); }
          catch { return false; }
        }),
        bodyWidth: document.body.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        welcome: rect(".welcome"),
        heading: rect(".welcome h1"),
        composer: rect(".composer"),
        sendEnabled,
        sendAction,
        hasLegacyCopy: /mini frank|private link access|how private access works|before i build/i.test(document.body.innerText),
      };
    })()`);
    if (EXERCISE_SUBMIT) {
      await browser.evaluate(`(() => {
        const input = document.querySelector("#message");
        input.value = "Create a simple booking page for my customers.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#composer").requestSubmit();
      })()`);
      await wait(900);
      const accepted = await browser.evaluate(`(() => ({
        statusCard: Boolean(document.querySelector(".status-card")),
        bodyText: document.body.innerText,
        hasGuideQuestion: /before i build|what would a good result|what destination/i.test(document.body.innerText),
      }))()`);
      result.directSubmit = {
        statusCard: accepted.statusCard,
        hasGuideQuestion: accepted.hasGuideQuestion,
        hasWorkingCopy: /working on it/i.test(accepted.bodyText),
      };
    }
    if (SCREENSHOT) {
      const capture = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(SCREENSHOT, Buffer.from(capture.data, "base64"));
    }
    console.log(JSON.stringify(result));
    if (result.canonicalPath !== "/frank/" || result.hasLegacyPublicPath || result.scrollWidth > result.viewport.width || result.hasLegacyCopy || result.heading.right > result.viewport.width || result.composer.right > result.viewport.width || !result.sendEnabled || result.sendAction !== "send-message" || (EXERCISE_SUBMIT && (!result.directSubmit.statusCard || result.directSubmit.hasGuideQuestion || !result.directSubmit.hasWorkingCopy))) process.exitCode = 1;
  } finally {
    try { browser?.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
